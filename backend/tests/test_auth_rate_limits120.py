"""Independent quota/window/concurrency and Redis transport contract checks."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from threading import Barrier
from types import SimpleNamespace
import json
import shutil
import subprocess

import pytest

from app.services import auth_rate_limits as limits


def test_fixed_window_exact_budget_expiry_and_denials_do_not_extend_it():
    clock = [20.0]
    limiter = limits.GoogleExchangeLimiter(clock=lambda: clock[0], limit=3, window_seconds=60)
    assert [limiter.consume().allowed for _ in range(3)] == [True] * 3
    assert limiter.consume().retry_after_seconds == 60
    clock[0] = 79.01
    for _ in range(20):
        denied = limiter.consume()
        assert not denied.allowed and denied.retry_after_seconds == 1
    clock[0] = 80.0
    assert [limiter.consume().allowed for _ in range(4)] == [True, True, True, False]


def test_parallel_consumers_cannot_exceed_one_global_budget():
    limiter = limits.GoogleExchangeLimiter(limit=7, clock=lambda: 10)
    barrier = Barrier(32)
    def consume(_):
        barrier.wait(timeout=5)
        return limiter.consume().allowed
    with ThreadPoolExecutor(max_workers=32) as pool:
        outcomes = list(pool.map(consume, range(32)))
    assert sum(outcomes) == 7


def test_nonblocking_concurrent_slots_release_after_success_exception_and_quota_failure():
    limiter = limits.GoogleExchangeLimiter(limit=100, max_concurrent=8)
    with ExitStack() as stack:
        for _ in range(8):
            stack.enter_context(limiter.admit())
        with pytest.raises(limits.AuthRateLimitExceeded) as error:
            with limiter.admit():
                pytest.fail("A ninth in-flight exchange was admitted")
        assert error.value.retry_after_seconds == 1
    with pytest.raises(RuntimeError):
        with limiter.admit():
            raise RuntimeError("provider error")
    with limiter.admit():
        pass
    clock = [1.0]
    exhausted = limits.GoogleExchangeLimiter(limit=1, max_concurrent=1, window_seconds=2,
                                             clock=lambda: clock[0])
    with exhausted.admit():
        pass
    for _ in range(2):
        with pytest.raises(limits.AuthRateLimitExceeded):
            with exhausted.admit():
                pytest.fail("Exhausted quota admitted")
    clock[0] = 3.0
    with exhausted.admit():
        pass


@pytest.mark.parametrize("name", ["limit", "window_seconds", "max_concurrent"])
@pytest.mark.parametrize("value", [0, -1, 1.5, True, None])
def test_invalid_configuration_cannot_disable_google_protection(name, value):
    with pytest.raises(ValueError):
        limits.GoogleExchangeLimiter(**{name: value})


class RedisWire:
    def __init__(self, replies): self.replies, self.calls = iter(replies), []
    def eval(self, *args):
        self.calls.append(args)
        reply = next(self.replies)
        if isinstance(reply, Exception):
            raise reply
        return reply
    def incr(self, *args): pytest.fail("Counter and expiry must not use separate Redis round trips")
    def expire(self, *args): pytest.fail("Expiry must be atomic with admission")


def test_redis_admission_is_one_atomic_fixed_key_call_and_uses_remaining_ttl():
    wire = RedisWire([[1, 60000], [0, 1251], [0, 1]])
    limiter = limits.GoogleExchangeLimiter(client=wire, limit=5)
    assert limiter.consume().allowed
    assert limiter.consume().retry_after_seconds == 2
    assert limiter.consume().retry_after_seconds == 1
    assert len(wire.calls) == 3
    for script, count, key, limit, ttl in wire.calls:
        assert count == 1 and key == "rate-limit:auth:google-exchange:global:v1"
        assert limit == 5 and ttl == 60000
        assert "redis.call('SET'" in script and "'PX'" in script
        assert "redis.call('PTTL'" in script and "redis.call('PEXPIRE'" in script
        assert "INVALID_AUTH_QUOTA" in script
        # Existing quota retains its count when missing expiry is repaired.
        assert "redis.call('INCR'" in script and "redis.call('DEL'" not in script


@pytest.mark.parametrize("reply", [None, {}, [], [1], [2, 60000], [True, 60000], [1, True],
                                    [1, 0], [1, -1], [0, 60001], [0, "400"], ["1", 60000],
                                    RuntimeError("transport unavailable")])
def test_invalid_redis_protocol_or_runtime_fault_fails_closed_and_releases_slot(reply):
    wire = RedisWire([reply, [1, 60000]])
    limiter = limits.GoogleExchangeLimiter(client=wire, max_concurrent=1)
    with pytest.raises(limits.AuthRateLimiterUnavailable):
        with limiter.admit():
            pytest.fail("Unverified Redis quota admitted")
    with limiter.admit():
        pass
    assert len(wire.calls) == 2


def test_only_unconfigured_redis_uses_bounded_process_budget(monkeypatch):
    monkeypatch.setattr(limits, "redis", None)
    limiter = limits.build_google_exchange_limiter("")
    assert sum(limiter.consume().allowed for _ in range(2000)) == limits.GOOGLE_EXCHANGE_LIMIT
    configured = limits.build_google_exchange_limiter("redis://owned.example/0")
    for _ in range(3):
        with pytest.raises(limits.AuthRateLimiterUnavailable):
            configured.consume()


def test_configured_redis_creation_and_later_fault_never_fall_back_to_memory(monkeypatch):
    calls = []
    def broken(url, **kwargs):
        calls.append((url, kwargs))
        raise OSError("connection unavailable")
    monkeypatch.setattr(limits, "redis", SimpleNamespace(from_url=broken))
    limiter = limits.build_google_exchange_limiter("redis://owned.example/0")
    with pytest.raises(limits.AuthRateLimiterUnavailable):
        limiter.consume()
    assert calls == [("redis://owned.example/0", {"decode_responses": True,
                     "socket_connect_timeout": 0.25, "socket_timeout": 0.25})]
    wire = RedisWire([OSError("network unavailable")])
    monkeypatch.setattr(limits, "redis", SimpleNamespace(from_url=lambda *a, **kw: wire))
    with pytest.raises(limits.AuthRateLimiterUnavailable):
        limits.build_google_exchange_limiter("redis://owned.example/0").consume()


LUA = shutil.which("lua")


def run_quota_lua(*, count=None, ttl=-2, expiry_result=1, limits_sequence=(None,)):
    """Execute unchanged production Lua; fixture implements Redis command effects only."""
    initial = "nil" if count is None else json.dumps(str(count))
    setup = "local state={count=" + initial + ",ttl=" + str(ttl) + "}\n"
    setup += "local expiry_result=" + str(expiry_result) + "\n"
    fixture = r"""
local trace={}
KEYS={'rate-limit:auth:google-exchange:global:v1'}
ARGV={'2','60000'}
redis={}
function redis.call(command,key,...)
    assert(key==KEYS[1], 'unexpected quota key')
    table.insert(trace,command)
    local args={...}
    if command=='GET' then return state.count or false end
    if command=='PTTL' then return state.ttl end
    if command=='SET' then
        assert(args[2]=='PX' and tonumber(args[3])==60000)
        state.count=tostring(args[1]);state.ttl=tonumber(args[3]);return 'OK'
    end
    if command=='PEXPIRE' then
        assert(tonumber(args[1])==60000)
        if expiry_result==1 then state.ttl=tonumber(args[1]) end
        return expiry_result
    end
    if command=='INCR' then
        local n=assert(tonumber(state.count),'invalid Redis integer')+1
        state.count=tostring(n);return n
    end
    error('Unexpected Redis command '..command)
end
function redis.error_reply(message) return {err=message} end
local function quota()
"""
    report = r"""
end
local function report()
    local before=#trace
    local reply=quota()
    if reply.err then print('ERROR '..reply.err)
    else print('REPLY '..reply[1]..' '..reply[2]) end
    print('STATE '..tostring(state.count)..' '..state.ttl)
    local commands={}
    for i=before+1,#trace do table.insert(commands,trace[i]) end
    print('TRACE '..table.concat(commands,','))
end
"""
    commands = "\n".join(("" if next_ttl is None else "state.ttl="+str(next_ttl)+"\n") + "report()"
                         for next_ttl in limits_sequence)
    result = subprocess.run([LUA, "-"], input=setup+fixture+limits.GOOGLE_EXCHANGE_SCRIPT+report+commands,
                            text=True, capture_output=True, timeout=5, check=True)
    assert result.stderr == ""
    lines = result.stdout.splitlines()
    assert len(lines) == 3 * len(limits_sequence)
    return [lines[i:i+3] for i in range(0, len(lines), 3)]


@pytest.mark.skipif(LUA is None, reason="Optional Lua interpreter is not installed")
def test_actual_lua_fresh_quota_saturates_without_incrementing_or_sliding_denied_expiry():
    assert run_quota_lua(limits_sequence=(None, 40000, 1200, 100)) == [
        ["REPLY 1 60000", "STATE 1 60000", "TRACE GET,PTTL,SET"],
        ["REPLY 1 40000", "STATE 2 40000", "TRACE GET,PTTL,INCR"],
        ["REPLY 0 1200", "STATE 2 1200", "TRACE GET,PTTL"],
        ["REPLY 0 100", "STATE 2 100", "TRACE GET,PTTL"],
    ]


@pytest.mark.skipif(LUA is None, reason="Optional Lua interpreter is not installed")
@pytest.mark.parametrize("retained,allowed,final,commands", [
    (1, 1, 2, "GET,PTTL,PEXPIRE,INCR"), (2, 0, 2, "GET,PTTL,PEXPIRE")])
def test_actual_lua_repairs_missing_expiry_without_resetting_retained_budget(retained, allowed, final, commands):
    assert run_quota_lua(count=retained, ttl=-1) == [
        [f"REPLY {allowed} 60000", f"STATE {final} 60000", "TRACE "+commands]]


@pytest.mark.skipif(LUA is None, reason="Optional Lua interpreter is not installed")
def test_actual_lua_expired_key_resets_instead_of_preserving_stale_retained_count():
    assert run_quota_lua(count=2, ttl=-2) == [
        ["REPLY 1 60000", "STATE 1 60000", "TRACE GET,PTTL,SET"]]


@pytest.mark.skipif(LUA is None, reason="Optional Lua interpreter is not installed")
def test_actual_lua_failed_expiry_repair_never_increments_or_admits():
    assert run_quota_lua(count=1, ttl=-1, expiry_result=0) == [
        ["ERROR INVALID_AUTH_QUOTA_EXPIRY", "STATE 1 -1", "TRACE GET,PTTL,PEXPIRE"]]


@pytest.mark.skipif(LUA is None, reason="Optional Lua interpreter is not installed")
@pytest.mark.parametrize("corrupt", ["garbage", "1.5", "-1"])
def test_actual_lua_corrupt_retained_count_fails_without_any_redis_write(corrupt):
    assert run_quota_lua(count=corrupt, ttl=30000) == [
        ["ERROR INVALID_AUTH_QUOTA", f"STATE {corrupt} 30000", "TRACE GET,PTTL"]]
