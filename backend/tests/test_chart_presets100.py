import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from threading import Barrier, local
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from pydantic import ValidationError
from sqlalchemy import create_engine, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.sql.dml import Update

from app.api import routes
from app.db import Base
from app.models import AppStorageItem, BetaUser
from app.services import chart_presets
from app.schemas import DrawingPresetWrite, FibPresetWrite
from test_chart_settings import api


PATH = "/api/settings/chart/presets"
DATE = "2026-10-08T10:12:13.456+05:30"


def drawing(identifier="draw-one", name="My drawing", **changes):
    return {"id": identifier, "name": name, "tool": "rectangle", "color": "#32d3ee", "label": "Entry",
            "updatedAt": DATE, "fillOpacity": 0.16, "labelBackgroundOpacity": 0.92, "lineStyle": "dashed", "lineWidth": 2,
            **changes}


def fib(identifier="fib-one", name="My Fib", **changes):
    return {"id": identifier, "name": name, "updatedAt": DATE, "extendLeft": False, "extendRight": True,
            "levels": [{"id": "zero", "value": -2, "color": "#22C55e", "backgroundOpacity": 0.24, "label": "Zero",
                        "lineStyle": "dotted", "visible": False},
                       {"id": "one", "value": 4.236, "color": "#FFFFFF"}], **changes}


def storage_path(kind):
    return f"/api/app-storage/edgelab/{chart_presets.PRESET_KEYS[kind]}"


def seed_presets(api, kind, value, owner=0):
    # Legacy/malformed values are seeded directly; their blind PUT is now refused.
    key = chart_presets.PRESET_KEYS[kind]
    row = api.db.scalar(select(AppStorageItem).where(AppStorageItem.user_id == api.owner_ids[owner],
                                                   AppStorageItem.namespace == "edgelab", AppStorageItem.key == key))
    if row is None:
        api.db.add(AppStorageItem(user_id=api.owner_ids[owner], namespace="edgelab", key=key, value=value))
    else:
        row.value = value
        row.updated_at = datetime.now(timezone.utc)
    api.db.commit()


def saved(api, kind, owner=0):
    status, result = api("GET", storage_path(kind), owner=owner)
    assert status == 200
    return result


def assert_acknowledged(api, kind, result):
    reread = saved(api, kind)
    assert {key: value for key, value in reread.items() if key != "updated_at"} == {key: value for key, value in result.items() if key != "updated_at"}
    # SQLite drops timezone metadata on its timestamp column; JSON preset timestamps stay exact.
    def instant(value):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    assert instant(reread["updated_at"]) == instant(result["updated_at"])


@pytest.mark.parametrize("kind,make", [("drawing", drawing), ("fib", fib)])
def test_save_preserves_exact_payload_and_other_presets(api, kind, make):
    original = [make("first", "First"), make("second", "Second")]
    seed_presets(api, kind, original)
    incoming = make("third", " Third ", updatedAt="2026-10-08T04:42:13.456Z")
    status, result = api("POST", PATH, {"kind": kind, "action": "save", "preset": incoming})
    assert status == 200
    assert result["namespace"] == "edgelab" and result["key"] == chart_presets.PRESET_KEYS[kind]
    assert result["value"] == [incoming, *original]
    assert_acknowledged(api, kind, result)
    assert saved(api, "fib" if kind == "drawing" else "drawing")["value"] is None


@pytest.mark.parametrize("kind,make", [("drawing", drawing), ("fib", fib)])
def test_latest_state_merges_stale_tab_commands_and_name_or_id_replacements(api, kind, make):
    first = make("first", " First ")
    second = make("second", "Second")
    assert api("POST", PATH, {"kind": kind, "action": "save", "preset": first})[0] == 200
    assert api("POST", PATH, {"kind": kind, "action": "save", "preset": second})[1]["value"] == [second, first]
    replacement = make("new-first", "\ufeffFIRST\t")
    assert api("POST", PATH, {"kind": kind, "action": "save", "preset": replacement})[1]["value"] == [replacement, second]
    renamed = make("new-first", "Renamed")
    assert api("POST", PATH, {"kind": kind, "action": "save", "preset": renamed})[1]["value"] == [renamed, second]
    assert api("POST", PATH, {"kind": kind, "action": "delete", "id": "second"})[1]["value"] == [renamed]
    before = saved(api, kind)
    assert api("POST", PATH, {"kind": kind, "action": "delete", "id": "second"}) == (200, before)
    assert api("POST", PATH, {"kind": kind, "action": "delete", "id": "new-first"})[1]["value"] == []


def test_drawing_normalized_name_replacement_is_tool_scoped_and_uses_lower_not_casefold(api):
    original = [drawing("one", " A   B "), drawing("other-tool", "a b", tool="horizontal"), drawing("sharp", "Straße")]
    seed_presets(api, "drawing", original)
    incoming = drawing("new", "\ufeffa\tB")
    assert api("POST", PATH, {"kind": "drawing", "action": "save", "preset": incoming})[1]["value"] == [incoming, *original[1:]]
    other = drawing("different", "STRASSE")
    result = api("POST", PATH, {"kind": "drawing", "action": "save", "preset": other})[1]["value"]
    assert result == [other, incoming, *original[1:]]


@pytest.mark.parametrize("kind", ["drawing", "fib"])
def test_missing_delete_acknowledges_empty_storage_and_legacy_put_cannot_clobber_commands(api, kind):
    before = saved(api, kind)
    assert before["value"] is None and before["updated_at"] is None
    status, result = api("POST", PATH, {"kind": kind, "action": "delete", "id": "absent"})
    assert status == 200 and result["value"] == [] and result["updated_at"]
    assert_acknowledged(api, kind, result)
    before = saved(api, kind)
    assert api("POST", PATH, {"kind": kind, "action": "delete", "id": "absent"}) == (200, before)
    assert api("PUT", storage_path(kind), {"value": []})[0] == 409
    assert saved(api, kind) == before
    assert api("PUT", f"/api/app-storage/another/{chart_presets.PRESET_KEYS[kind]}", {"value": []})[0] == 200
    make = drawing if kind == "drawing" else fib
    assert api("POST", PATH, {"kind": kind, "action": "save", "preset": make()})[0] == 200
    acknowledged = saved(api, kind)
    assert api("PUT", storage_path(kind), {"value": []})[0] == 409
    assert saved(api, kind) == acknowledged


@pytest.mark.parametrize("body", [
    {}, {"kind": "other", "action": "delete", "id": "x"}, {"kind": "fib", "action": "other", "id": "x"},
    {"kind": "drawing", "action": "save"}, {"kind": "drawing", "action": "save", "preset": None},
    {"kind": "drawing", "action": "save", "preset": drawing(), "id": None},
    {"kind": "fib", "action": "delete"}, {"kind": "fib", "action": "delete", "id": " "},
    {"kind": "fib", "action": "delete", "id": "\ufeff"},
    {"kind": "fib", "action": "delete", "id": 7}, {"kind": "fib", "action": "delete", "id": "x", "preset": None},
    {"kind": "drawing", "action": "save", "preset": drawing(), "owner": 2},
    {"kind": "drawing", "action": "save", "preset": fib()},
])
def test_strict_command_validation_does_not_change_storage(api, body):
    original = [drawing()]
    seed_presets(api, "drawing", original)
    before = saved(api, "drawing")
    assert api("POST", PATH, body)[0] == 422
    assert saved(api, "drawing") == before


@pytest.mark.parametrize("field,value", [
    ("id", ""), ("id", "x" * 129), ("name", "\ufeff"), ("name", "x" * 49), ("label", "x" * 65),
    ("tool", "fib"), ("tool", "text"), ("color", "red"), ("color", "#ff"), ("rewardColor", "url(x)"),
    ("riskColor", None), ("lineWidth", 0.5), ("lineWidth", 7), ("lineWidth", "2"), ("lineWidth", True),
    ("fillOpacity", -0.01), ("fillOpacity", 0.61), ("labelBackgroundOpacity", 1.01),
    ("lineStyle", "dashdot"), ("updatedAt", "invalid"), ("updatedAt", "2026-10-08"), ("extra", 1),
])
def test_invalid_drawing_shapes_are_rejected_before_write(api, field, value):
    assert api("POST", PATH, {"kind": "drawing", "action": "save", "preset": drawing(**{field: value})})[0] == 422
    assert saved(api, "drawing")["value"] is None


@pytest.mark.parametrize("field,value", [
    ("extendLeft", 1), ("extendRight", "true"), ("levels", []), ("levels", [fib()["levels"][0]] * 65),
    ("levels", [fib()["levels"][0]] * 2), ("levels", [{"id": "one", "value": 0, "color": "#ffffff", "extra": 1}]),
    ("levels", [{"id": "one", "value": -2.01, "color": "#ffffff"}]),
    ("levels", [{"id": "one", "value": 4.237, "color": "#ffffff"}]),
    ("levels", [{"id": "one", "value": True, "color": "#ffffff"}]),
    ("levels", [{"id": "one", "value": "1", "color": "#ffffff"}]),
    ("levels", [{"id": "one", "value": 1, "color": "#ffffff", "visible": 1}]),
    ("levels", [{"id": "one", "value": 1, "color": "#ffffff", "backgroundOpacity": 0.241}]),
    ("levels", [{"id": "one", "value": 1, "color": "#ffffff", "label": "x" * 25}]),
    ("levels", [{"id": "one", "value": 1, "color": "#ffffff", "lineStyle": None}]),
])
def test_invalid_fib_shapes_are_rejected_before_write(api, field, value):
    assert api("POST", PATH, {"kind": "fib", "action": "save", "preset": fib(**{field: value})})[0] == 422
    assert saved(api, "fib")["value"] is None


@pytest.mark.parametrize("kind,make", [("drawing", drawing), ("fib", fib)])
@pytest.mark.parametrize("action", ["save", "delete"])
@pytest.mark.parametrize("malformed", ["object", "entry", "extra", "duplicate-id", "duplicate-name", "over-limit"])
def test_malformed_stored_state_is_not_silently_repaired_or_lost(api, kind, make, action, malformed):
    original = {"object": {"not": "list"}, "entry": [None], "extra": [make(extra=True)],
                "duplicate-id": [make(), make(name="Other")],
                "duplicate-name": [make(), make("other", " MY   " + ("drawing" if kind == "drawing" else "fib"))],
                "over-limit": [make(f"id-{i}", f"Name {i}") for i in range(chart_presets.PRESET_LIMITS[kind] + 1)]}[malformed]
    seed_presets(api, kind, original)
    before = saved(api, kind)
    body = {"kind": kind, "action": action, **({"preset": make()} if action == "save" else {"id": "absent"})}
    assert api("POST", PATH, body)[0] == 409
    assert saved(api, kind) == before


@pytest.mark.parametrize("kind,make", [("drawing", drawing), ("fib", fib)])
def test_capacity_never_discards_other_presets_but_allows_replacement(api, kind, make):
    original = [make(f"id-{i}", f"Name {i}") for i in range(chart_presets.PRESET_LIMITS[kind])]
    seed_presets(api, kind, original)
    before = saved(api, kind)
    assert api("POST", PATH, {"kind": kind, "action": "save", "preset": make("new", "New")})[0] == 409
    assert saved(api, kind) == before
    incoming = make("new", "name 0")
    assert api("POST", PATH, {"kind": kind, "action": "save", "preset": incoming})[1]["value"] == [incoming, *original[1:]]


def test_route_requires_real_auth_and_commands_are_owner_isolated(api):
    async def unauthenticated():
        app = FastAPI()
        app.include_router(routes.router, prefix="/api")
        app.dependency_overrides[routes.get_db] = lambda: api.db
        messages = []
        async def receive():
            return {"type": "http.request", "body": json.dumps({"kind": "drawing", "action": "save", "preset": drawing()}).encode(), "more_body": False}
        async def send(message):
            messages.append(message)
        await app({"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST", "scheme": "http",
                   "path": PATH, "raw_path": PATH.encode(), "query_string": b"", "root_path": "", "headers": [(b"content-type", b"application/json")],
                   "server": ("test", 80), "client": ("test", 1234)}, receive, send)
        return next(item["status"] for item in messages if item["type"] == "http.response.start")
    assert asyncio.run(unauthenticated()) == 401
    for owner in [0, 1]:
        assert api("POST", PATH, {"kind": "drawing", "action": "save", "preset": drawing(label=f"Owner {owner}")}, owner=owner)[0] == 200
    assert api("POST", PATH, {"kind": "drawing", "action": "delete", "id": "draw-one"}, owner=1)[0] == 200
    assert saved(api, "drawing", owner=0)["value"] == [drawing(label="Owner 0")]
    assert saved(api, "drawing", owner=1)["value"] == []


@pytest.mark.parametrize("conflict", ["stale", "integrity"])
def test_failed_cas_retries_are_bounded_and_leave_raw_state_unchanged(api, monkeypatch, conflict):
    seed_presets(api, "drawing", [drawing()])
    before = saved(api, "drawing")
    execute = api.db.execute
    attempts = []
    def reject(statement, *args, **kwargs):
        if isinstance(statement, Update) and statement.table.name == "app_storage":
            attempts.append(True)
            if conflict == "integrity":
                raise IntegrityError("conflict", {}, Exception("concurrent write"))
            return SimpleNamespace(rowcount=0)
        return execute(statement, *args, **kwargs)
    monkeypatch.setattr(api.db, "execute", reject)
    assert api("POST", PATH, {"kind": "drawing", "action": "save", "preset": drawing(label="Changed")})[0] == 409
    assert len(attempts) == 3
    assert saved(api, "drawing") == before


@pytest.mark.parametrize("action", ["save", "delete"])
def test_cas_retry_merges_actual_concurrently_committed_preset(api, monkeypatch, action):
    seed_presets(api, "drawing", [drawing()])
    execute = api.db.execute
    concurrent = [drawing("newer", "Newer"), drawing()]
    writes = []
    def conflict_once(statement, *args, **kwargs):
        if isinstance(statement, Update) and statement.table.name == "app_storage":
            writes.append(True)
            if len(writes) == 1:
                execute(update(AppStorageItem).where(AppStorageItem.user_id == api.owner_ids[0], AppStorageItem.key == "drawing-presets.v1")
                        .values(value=concurrent, updated_at=datetime(2030, 1, 1, tzinfo=timezone.utc)).execution_options(synchronize_session=False))
                api.db.commit()
                return SimpleNamespace(rowcount=0)
        return execute(statement, *args, **kwargs)
    monkeypatch.setattr(api.db, "execute", conflict_once)
    changed = drawing(label="Changed")
    body = {"kind": "drawing", "action": action, **({"preset": changed} if action == "save" else {"id": "draw-one"})}
    status, result = api("POST", PATH, body)
    assert status == 200 and len(writes) == 2
    assert result["value"] == ([changed, concurrent[0]] if action == "save" else concurrent[:1])
    assert_acknowledged(api, "drawing", result)


@pytest.mark.parametrize("action", ["save", "delete"])
def test_initial_insert_conflict_rolls_back_and_never_leaves_an_empty_row(api, monkeypatch, action):
    commit = api.db.commit
    attempts = []
    def reject_insert():
        if any(isinstance(row, AppStorageItem) for row in api.db.new):
            api.db.flush()
            attempts.append(True)
            raise IntegrityError("insert conflict", {}, Exception("concurrent write"))
        return commit()
    monkeypatch.setattr(api.db, "commit", reject_insert)
    body = {"kind": "fib", "action": action, **({"preset": fib()} if action == "save" else {"id": "absent"})}
    assert api("POST", PATH, body)[0] == 409
    assert len(attempts) == 3 and saved(api, "fib")["value"] is None


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -float("inf")])
def test_model_boundaries_reject_nonfinite_values(value):
    with pytest.raises(ValidationError):
        DrawingPresetWrite.model_validate(drawing(lineWidth=value))
    candidate = fib()
    candidate["levels"][0]["value"] = value
    with pytest.raises(ValidationError):
        FibPresetWrite.model_validate(candidate)


def test_full_fib_level_bound_and_drawing_numeric_edges_are_accepted_exactly(api):
    candidate = fib(levels=[{"id": str(index), "value": index / 64, "color": "#FFFFFF"} for index in range(64)])
    assert api("POST", PATH, {"kind": "fib", "action": "save", "preset": candidate})[1]["value"] == [candidate]
    candidate = drawing(fillOpacity=0, lineWidth=6, labelBackgroundOpacity=1, rewardColor="#ABCDEF", riskColor="#123456")
    assert api("POST", PATH, {"kind": "drawing", "action": "save", "preset": candidate})[1]["value"] == [candidate]


@pytest.mark.parametrize("kind", ["drawing", "fib"])
def test_delete_legacy_null_value_commits_an_empty_acknowledged_list(api, kind):
    seed_presets(api, kind, None)
    status, result = api("POST", PATH, {"kind": kind, "action": "delete", "id": "absent"})
    assert status == 200 and result["value"] == [] and result["updated_at"]
    assert_acknowledged(api, kind, result)


@pytest.mark.parametrize("color", ["#aBc", "#12ab34CD"])
def test_imported_short_and_alpha_hex_colors_are_preserved_in_all_preset_fields(api, color):
    imported_drawing = drawing("legacy", "Legacy", color=color, rewardColor=color, riskColor=color)
    imported_fib = fib("legacy", "Legacy", levels=[{"id": "one", "value": 1, "color": color}])
    for kind, imported, make in [("drawing", imported_drawing, drawing), ("fib", imported_fib, fib)]:
        seed_presets(api, kind, [imported])
        incoming = make("new", "New")
        status, result = api("POST", PATH, {"kind": kind, "action": "save", "preset": incoming})
        assert status == 200 and result["value"] == [incoming, imported]
        status, result = api("POST", PATH, {"kind": kind, "action": "save", "preset": imported})
        assert status == 200 and result["value"] == [imported, incoming]
        assert_acknowledged(api, kind, result)


def test_two_real_sessions_merge_concurrent_saves_instead_of_last_writer_loss(api, monkeypatch, tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'preset-cas.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)
    with sessions() as db:
        owner = BetaUser(email="concurrent-presets@edgelab.local", name="Concurrent", provider="google", status="APPROVED")
        db.add(owner)
        db.commit()
        owner_id = owner.id
        db.add(AppStorageItem(user_id=owner_id, namespace="edgelab", key="drawing-presets.v1", value=[drawing()]))
        db.commit()
    barrier = Barrier(2)
    thread_state = local()
    read_rows = chart_presets.settings._rows
    def held_read(*args):
        result = read_rows(*args)
        if not getattr(thread_state, "read", False):
            thread_state.read = True
            barrier.wait(timeout=5)
        return result
    monkeypatch.setattr(chart_presets.settings, "_rows", held_read)
    def save_one(identifier):
        with sessions() as db:
            return chart_presets.operate_chart_preset(db, owner_id, "drawing", "save", drawing(identifier, identifier), None)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(save_one, ["tab-a", "tab-b"]))
        assert all(result.value[0]["id"] in {"tab-a", "tab-b"} for result in results)
        with sessions() as db:
            value = db.scalar(select(AppStorageItem).where(AppStorageItem.user_id == owner_id)).value
            assert {item["id"] for item in value} == {"draw-one", "tab-a", "tab-b"}
    finally:
        engine.dispose()
