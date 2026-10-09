"""Billing admission boundaries; Redis command seam executes unchanged Lua."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from threading import Barrier, Event
from types import SimpleNamespace
import json
import shutil
import subprocess

import pytest

from app.services import billing_rate_limits as limits


def admit(limiter, owner=1, family="status"):
    with limiter.admit(owner, family):
        pass


def test_default_status_action_and_global_policies_are_independent_and_actions_shared():
    limiter = limits.BillingAdmissionLimiter(clock=lambda: 10)
    for _ in range(30):
        admit(limiter, 1, "status")
    for _ in range(6):
        admit(limiter, 1, "actions")
    for family in ("status", "actions"):
        with pytest.raises(limits.BillingRateLimitExceeded) as denied:
            admit(limiter, 1, family)
        assert denied.value.retry_after_seconds == 60
    # A blocked owner consumed no additional global budget.
    assert limiter._global_count == 36
    admit(limiter, 2, "actions")
    assert limiter._global_count == 37


def test_denied_owner_never_consumes_global_and_denied_global_never_creates_owner():
    limiter = limits.BillingAdmissionLimiter(global_limit=3, status_limit=1, action_limit=1,
                                             clock=lambda: 20)
    admit(limiter, 1)
    for _ in range(20):
        with pytest.raises(limits.BillingRateLimitExceeded):
            admit(limiter, 1)
    assert limiter._global_count == 1
    admit(limiter, 2); admit(limiter, 3)
    for owner in range(4, 100):
        with pytest.raises(limits.BillingRateLimitExceeded):
            admit(limiter, owner)
    assert limiter._global_count == 3
    assert len(limiter._owner_quotas) == 3
    assert limiter._owner_in_flight == {} and limiter._in_flight == 0


def test_windows_keep_original_expiry_and_retry_waits_for_both_exhausted_quotas():
    clock = [10.0]
    limiter = limits.BillingAdmissionLimiter(global_limit=2, status_limit=1, window_seconds=60,
                                             clock=lambda: clock[0])
    admit(limiter, 1)
    clock[0] = 50
    admit(limiter, 2)
    clock[0] = 69.01
    with pytest.raises(limits.BillingRateLimitExceeded) as denied:
        admit(limiter, 2)
    assert denied.value.retry_after_seconds == 41  # owner's later window, not global's 1s
    assert limiter._global_reset_at == 70
    assert limiter._owner_quotas[(2, "status")][1] == 110
    clock[0] = 70
    admit(limiter, 3)
    assert (1, "status") not in limiter._owner_quotas
    clock[0] = 110
    admit(limiter, 2)



def test_expired_global_window_starts_only_with_an_admitted_owner():
    clock = [0.0]
    limiter = limits.BillingAdmissionLimiter(global_limit=2, status_limit=1,
                                             window_seconds=10, clock=lambda: clock[0])
    admit(limiter, 1)
    clock[0] = 9
    admit(limiter, 2)
    clock[0] = 11
    for _ in range(3):
        with pytest.raises(limits.BillingRateLimitExceeded) as denied:
            admit(limiter, 2)
        assert denied.value.retry_after_seconds == 8
    # Like an absent Redis global key, this expired counter is not rewritten
    # by the still-exhausted owner's request. Expired owner rows are pruned.
    assert (limiter._global_count, limiter._global_reset_at) == (2, 10)
    assert set(limiter._owner_quotas) == {(2, "status")}
    clock[0] = 12
    admit(limiter, 3)
    clock[0] = 21
    admit(limiter, 4)
    with pytest.raises(limits.BillingRateLimitExceeded) as denied:
        admit(limiter, 5)
    assert denied.value.retry_after_seconds == 1
    clock[0] = 22
    admit(limiter, 5)
    assert limiter._global_count == 1 and limiter._global_reset_at == 32
    assert limiter._in_flight == 0 and limiter._owner_in_flight == {}


def test_owner_map_prunes_expired_entries_each_consumption_and_is_bounded_across_windows():
    clock = [1.0]
    limiter = limits.BillingAdmissionLimiter(global_limit=3, max_owner_entries=4,
                                             window_seconds=10, clock=lambda: clock[0])
    admit(limiter, 1)
    clock[0] = 9
    admit(limiter, 2); admit(limiter, 3)
    clock[0] = 11
    admit(limiter, 4); admit(limiter, 5)
    assert len(limiter._owner_quotas) == 4
    before = limiter._global_count
    with pytest.raises(limits.BillingRateLimitExceeded) as denied:
        admit(limiter, 6)
    assert denied.value.retry_after_seconds == 8
    assert limiter._global_count == before
    clock[0] = 19
    admit(limiter, 6)
    assert len(limiter._owner_quotas) == 3
    for i in range(20, 100):
        clock[0] += 10
        admit(limiter, i)
        assert len(limiter._owner_quotas) <= 4


def test_true_parallel_admissions_never_exceed_atomic_global_quota():
    limiter = limits.BillingAdmissionLimiter(global_limit=7, max_concurrent=32,
                                             clock=lambda: 10)
    barrier = Barrier(32)
    def attempt(index):
        barrier.wait(timeout=5)
        try:
            admit(limiter, index + 1)
            return True
        except limits.BillingRateLimitExceeded:
            return False
    with ThreadPoolExecutor(max_workers=32) as pool:
        results = list(pool.map(attempt, range(32)))
    assert sum(results) == 7 and limiter._global_count == 7
    assert limiter._owner_in_flight == {} and limiter._in_flight == 0


def test_true_parallel_local_slots_are_global_and_per_owner_and_release_without_quota_consumption():
    limiter = limits.BillingAdmissionLimiter(global_limit=1000)
    ready, release = Barrier(9), Event()
    def hold(index):
        with limiter.admit(index // 2 + 1, "actions"):
            ready.wait(timeout=5)
            assert release.wait(timeout=5)
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(hold, i) for i in range(8)]
        try:
            ready.wait(timeout=5)
            assert limiter._in_flight == 8 and len(limiter._owner_in_flight) == 4
            for owner in (1, 9):
                with pytest.raises(limits.BillingRateLimitExceeded) as denied:
                    admit(limiter, owner)
                assert denied.value.retry_after_seconds == 1
            assert limiter._global_count == 8
        finally:
            release.set()
        for future in futures:
            future.result(timeout=5)
    assert limiter._in_flight == 0 and limiter._owner_in_flight == {}
    # Owner slots are shared across the status and action families, independent of quota.
    with ExitStack() as stack:
        stack.enter_context(limiter.admit(10, "status"))
        stack.enter_context(limiter.admit(10, "actions"))
        with pytest.raises(limits.BillingRateLimitExceeded):
            admit(limiter, 10, "status")
    with pytest.raises(RuntimeError):
        with limiter.admit(11, "status"):
            raise RuntimeError("provider failure")
    admit(limiter, 11)
    assert limiter._owner_in_flight == {} and limiter._in_flight == 0


@pytest.mark.parametrize("name", ["global_limit", "status_limit", "action_limit", "window_seconds",
                                  "max_concurrent", "owner_max_concurrent"])
@pytest.mark.parametrize("value", [0, -1, True, 1.5, None, 2**53])
def test_invalid_configuration_fails_before_any_unbounded_state(name, value):
    with pytest.raises(ValueError):
        limits.BillingAdmissionLimiter(**{name: value})


@pytest.mark.parametrize("value", [0, -1, True, 1.5, 7])
def test_owner_capacity_cannot_exceed_twice_global_budget(value):
    with pytest.raises(ValueError):
        limits.BillingAdmissionLimiter(global_limit=3, max_owner_entries=value)


@pytest.mark.parametrize("owner,family", [(True, "status"), (0, "status"), (-1, "actions"),
    ("1", "status"), (1.5, "status"), (2**63, "status"), (1, "checkout"), (1, None), (1, [])])
def test_only_verified_numeric_owner_ids_and_fixed_families_can_create_keys(owner, family):
    limiter = limits.BillingAdmissionLimiter()
    with pytest.raises(ValueError):
        admit(limiter, owner, family)
    assert limiter._owner_quotas == {} and limiter._owner_in_flight == {}


class RedisWire:
    def __init__(self, replies):
        self.replies, self.calls = iter(replies), []
    def eval(self, *args):
        self.calls.append(args)
        reply = next(self.replies)
        if isinstance(reply, Exception):
            raise reply
        return reply
    def ping(self):
        pytest.fail("Billing Redis initialization must be lazy")


def test_redis_uses_one_atomic_two_key_call_shared_hash_tag_and_remaining_ttl():
    wire = RedisWire([[1, 60000], [0, 1251], [0, 1]])
    limiter = limits.BillingAdmissionLimiter(client=wire)
    admit(limiter, 7, "status")
    for family, retry in (("actions", 2), ("actions", 1)):
        with pytest.raises(limits.BillingRateLimitExceeded) as denied:
            admit(limiter, 7, family)
        assert denied.value.retry_after_seconds == retry
    for call, family, owner_limit in zip(wire.calls, ("status", "actions", "actions"), (30, 6, 6)):
        script, count, global_key, owner_key, global_limit, limit, window_ms = call
        assert script == limits.BILLING_ADMISSION_SCRIPT and count == 2
        assert global_key == "rate-limit:{billing}:global:v1"
        assert owner_key == f"rate-limit:{{billing}}:owner:7:{family}:v1"
        assert (global_limit, limit, window_ms) == (600, owner_limit, 60000)
    assert limiter._owner_in_flight == {} and limiter._owner_quotas == {}


@pytest.mark.parametrize("reply", [None, {}, [], [1], [2, 60000], [True, 60000], [1, True],
    [1, 0], [1, -1], [0, 60001], [0, "400"], ["1", 60000], RuntimeError("Redis unavailable")])
def test_runtime_redis_errors_and_malformed_replies_fail_closed_without_memory_or_slot_leaks(reply):
    wire = RedisWire([reply, [1, 60000]])
    limiter = limits.BillingAdmissionLimiter(client=wire, max_concurrent=1)
    with pytest.raises(limits.BillingRateLimiterUnavailable):
        admit(limiter)
    assert limiter._owner_quotas == {} and limiter._global_count == 0
    assert limiter._owner_in_flight == {} and limiter._in_flight == 0
    admit(limiter)
    assert len(wire.calls) == 2


def test_configured_redis_never_falls_back_and_construction_is_lazy_with_bounded_timeouts(monkeypatch):
    calls = []
    wire = RedisWire([[1, 60000], OSError("network unavailable")])
    def create(url, **kwargs):
        calls.append((url, kwargs))
        return wire
    monkeypatch.setattr(limits, "redis", SimpleNamespace(from_url=create))
    limiter = limits.build_billing_admission_limiter("redis://owned.example/0")
    assert wire.calls == []
    assert calls == [("redis://owned.example/0", {"decode_responses": True,
        "socket_connect_timeout": .25, "socket_timeout": .25})]
    admit(limiter)
    with pytest.raises(limits.BillingRateLimiterUnavailable):
        admit(limiter)
    monkeypatch.setattr(limits, "redis", None)
    configured = limits.build_billing_admission_limiter("redis://owned.example/0")
    with pytest.raises(limits.BillingRateLimiterUnavailable):
        admit(configured)
    def broken(*args, **kwargs):
        raise ValueError("invalid Redis configuration")
    monkeypatch.setattr(limits, "redis", SimpleNamespace(from_url=broken))
    with pytest.raises(limits.BillingRateLimiterUnavailable):
        admit(limits.build_billing_admission_limiter("bad://configured"))
    memory = limits.build_billing_admission_limiter("")
    for _ in range(30):
        admit(memory)
    with pytest.raises(limits.BillingRateLimitExceeded):
        admit(memory)


LUA = shutil.which("lua")


def run_lua(states=None, operations=None, expiry_result=1):
    """Run actual production Lua; fixture supplies independent Redis command state."""
    rows = states or {}
    setup = "local state={}\n"
    for key, (count, ttl) in rows.items():
        raw = "false" if count is None else json.dumps(str(count))
        setup += f"state[{json.dumps(key)}]={{count={raw},ttl={ttl}}}\n"
    setup += "local expiry_result=" + str(expiry_result) + "\n"
    fixture = r"""
local trace={}
redis={}
function redis.call(command,key,...)
    table.insert(trace,command..':'..key)
    local row=state[key]
    local args={...}
    if command=='GET' then return row and row.count or false end
    if command=='PTTL' then return row and row.ttl or -2 end
    if command=='SET' then
        assert(args[2]=='PX' and tonumber(args[3])==60000)
        state[key]={count=tostring(args[1]),ttl=tonumber(args[3])};return 'OK'
    end
    if command=='PEXPIRE' then
        assert(tonumber(args[1])==60000)
        if expiry_result==1 and row then row.ttl=tonumber(args[1]);return 1 end
        return 0
    end
    if command=='INCR' then
        assert(row,'INCR must not recreate an expired counter')
        local n=assert(tonumber(row.count),'invalid Redis integer')+1
        row.count=tostring(n);return n
    end
    error('Unexpected Redis command '..command)
end
function redis.error_reply(message) return {err=message} end
local function quota()
"""
    report = r"""
end
local function invoke(owner,limit)
    KEYS={'global',owner};ARGV={'3',tostring(limit),'60000'}
    local before=#trace
    local reply=quota()
    if reply.err then print('ERROR '..reply.err)
    else print('REPLY '..reply[1]..' '..reply[2]) end
    for _,key in ipairs(KEYS) do
        local row=state[key]
        print('STATE '..key..' '..tostring(row and row.count or false)..' '..tostring(row and row.ttl or -2))
    end
    local commands={}
    for i=before+1,#trace do table.insert(commands,trace[i]) end
    print('TRACE '..table.concat(commands,','))
end
"""
    commands = "\n".join(f"invoke({json.dumps(owner)},{limit})" for owner, limit in (operations or [("owner1", 2)]))
    result = subprocess.run([LUA, "-"], input=setup+fixture+limits.BILLING_ADMISSION_SCRIPT+report+commands,
                            text=True, capture_output=True, timeout=5, check=True)
    assert result.stderr == ""
    lines = result.stdout.splitlines()
    assert len(lines) == 4 * len(operations or [("owner1", 2)])
    return [lines[index:index+4] for index in range(0, len(lines), 4)]


@pytest.mark.skipif(LUA is None, reason="Optional Lua interpreter is not installed")
def test_actual_lua_owner_denial_consumes_neither_quota_and_new_owner_uses_remaining_global():
    result = run_lua(operations=[("owner1", 1), ("owner1", 1), ("owner2", 1), ("owner3", 1), ("owner4", 1)])
    assert result[0][:3] == ["REPLY 1 60000", "STATE global 1 60000", "STATE owner1 1 60000"]
    assert result[1] == ["REPLY 0 60000", "STATE global 1 60000", "STATE owner1 1 60000",
                         "TRACE GET:global,PTTL:global,GET:owner1,PTTL:owner1"]
    assert result[2][:3] == ["REPLY 1 60000", "STATE global 2 60000", "STATE owner2 1 60000"]
    assert result[3][:3] == ["REPLY 1 60000", "STATE global 3 60000", "STATE owner3 1 60000"]
    assert result[4][:3] == ["REPLY 0 60000", "STATE global 3 60000", "STATE owner4 false -2"]


@pytest.mark.skipif(LUA is None, reason="Optional Lua interpreter is not installed")
def test_actual_lua_keeps_existing_expiry_and_waits_for_all_exhausted_windows():
    result = run_lua({"global": (1, 1234), "owner1": (1, 30000)})
    assert result[0][:3] == ["REPLY 1 1234", "STATE global 2 1234", "STATE owner1 2 30000"]
    result = run_lua({"global": (3, 1234), "owner1": (2, 30000)})
    assert result[0][:3] == ["REPLY 0 30000", "STATE global 3 1234", "STATE owner1 2 30000"]
    assert "PEXPIRE" not in result[0][3] and "INCR" not in result[0][3]


@pytest.mark.skipif(LUA is None, reason="Optional Lua interpreter is not installed")
def test_actual_lua_missing_ttl_repairs_count_without_reset_and_failed_repair_consumes_nothing():
    result = run_lua({"global": (1, -1), "owner1": (1, -1)})
    assert result[0][:3] == ["REPLY 1 60000", "STATE global 2 60000", "STATE owner1 2 60000"]
    result = run_lua({"global": (1, -1), "owner1": (1, -1)}, expiry_result=0)
    assert result[0][:3] == ["ERROR INVALID_BILLING_QUOTA_EXPIRY", "STATE global 1 -1", "STATE owner1 1 -1"]
    assert "INCR" not in result[0][3] and "SET:" not in result[0][3]
    denied = run_lua({"global": (1, 12000), "owner1": (2, -1)})
    assert denied[0][:3] == ["REPLY 0 60000", "STATE global 1 12000", "STATE owner1 2 60000"]


@pytest.mark.skipif(LUA is None, reason="Optional Lua interpreter is not installed")
def test_actual_lua_expired_key_is_fresh_and_zero_ttl_denial_never_extends_expiry():
    assert run_lua({"global": (3, -2), "owner1": (2, -2)})[0][:3] == [
        "REPLY 1 60000", "STATE global 1 60000", "STATE owner1 1 60000"]
    result = run_lua({"global": (1, 0), "owner1": (1, 500)})
    assert result[0][:3] == ["REPLY 0 1", "STATE global 1 0", "STATE owner1 1 500"]
    assert "PEXPIRE" not in result[0][3] and "INCR" not in result[0][3]


@pytest.mark.skipif(LUA is None, reason="Optional Lua interpreter is not installed")
@pytest.mark.parametrize("counter", ["garbage", "1.5", "-1", "01", "1e0", "9007199254740992"])
@pytest.mark.parametrize("key", ["global", "owner1"])
def test_actual_lua_validates_both_counters_before_any_write(counter, key):
    state = {"global": (1, -1), "owner1": (1, 30000)}
    state[key] = (counter, 30000)
    result = run_lua(state)[0]
    assert result[0] == "ERROR INVALID_BILLING_QUOTA"
    assert "PEXPIRE" not in result[3] and "INCR" not in result[3] and "SET:" not in result[3]
