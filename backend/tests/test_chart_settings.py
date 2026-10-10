import asyncio
import json
from dataclasses import replace
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from sqlalchemy import create_engine, event, update
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.exc import IntegrityError
from sqlalchemy.sql.dml import Update

from app import auth
from app.api import routes
from app.services import app_data_operations
from app.auth import AuthenticatedUser
from app.db import Base
from app.models import AppStorageItem, BetaUser

CHART_PATH = "/api/settings/chart"
PRESETS_PATH = "/api/app-storage/edgelab/chart-settings-presets.v1"
ACTIVE_PATH = "/api/app-storage/edgelab/active-chart-settings-preset.v1"
PREFERENCES_PATH = "/api/settings/preferences"
PREFERENCES_STORAGE = "/api/app-storage/edgelab/settings-center.v1"

@pytest.fixture
def api(monkeypatch):
    # These storage semantics tests exercise two approved free beta accounts.
    beta_settings = replace(routes.settings, deployment_mode="beta", beta_seats_total=2)
    for module in (auth, routes, app_data_operations):
        monkeypatch.setattr(module, "settings", beta_settings)
    monkeypatch.setattr(routes, "enforce_rate_limit", lambda *_args: None)
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as db:
        owners = []
        for index in range(2):
            user = BetaUser(email=f"settings-{index}@edgelab.local", name=f"Owner {index}", provider="google", status="APPROVED")
            db.add(user)
            db.commit()
            now = datetime.now(timezone.utc)
            owners.append(AuthenticatedUser(id=user.id, email=user.email, name=user.name, provider="google", approved=True,
                                            beta_position=1, session_id=f"settings-{index}", session_created_at=now, session_expires_at=now))
        app = FastAPI()
        app.include_router(routes.router, prefix="/api")
        app.dependency_overrides[routes.get_db] = lambda: db

        def request(method, path, body=None, owner=0):
            app.dependency_overrides[routes.require_auth] = lambda: owners[owner]

            async def perform():
                messages = []
                payload = json.dumps(body).encode() if body is not None else b""

                async def receive():
                    return {"type": "http.request", "body": payload, "more_body": False}

                async def send(message):
                    messages.append(message)

                await app({"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method,
                           "scheme": "http", "path": path, "raw_path": path.encode(), "query_string": b"", "root_path": "",
                           "headers": [(b"content-type", b"application/json")], "server": ("test", 80), "client": ("test", 1234)}, receive, send)
                status = next(item["status"] for item in messages if item["type"] == "http.response.start")
                response = b"".join(item.get("body", b"") for item in messages if item["type"] == "http.response.body")
                return status, json.loads(response)

            return asyncio.run(perform())

        request.db = db
        request.owner_ids = [owner.id for owner in owners]
        yield request
    engine.dispose()



def preset(name, **settings):
    return {"name": name, "settings": settings, "updatedAt": "legacy-time", "futureMetadata": {"keep": [1, 2]}}


def seed(api, presets, active):
    assert api("PUT", PRESETS_PATH, {"value": presets})[0] == 200
    assert api("PUT", ACTIVE_PATH, {"value": active})[0] == 200


def assert_raw(api, presets, active):
    assert api("GET", PRESETS_PATH)[1]["value"] == presets
    assert api("GET", ACTIVE_PATH)[1]["value"] == active


def test_get_returns_missing_keys_and_reads_existing_raw_bundle_in_one_query(api):
    status, empty = api("GET", CHART_PATH)
    assert status == 200
    for field, key in [("presets", "chart-settings-presets.v1"), ("active", "active-chart-settings-preset.v1")]:
        assert empty[field] == {"namespace": "edgelab", "key": key, "value": None, "updated_at": None}
    original = [preset("Legacy", textSize=99, futureSetting={"deep": [3]})]
    seed(api, original, "Legacy")
    statements = []
    def record(_connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT") and "app_storage" in statement:
            statements.append(statement)
    event.listen(api.db.bind, "before_cursor_execute", record)
    try:
        status, bundle = api("GET", CHART_PATH)
    finally:
        event.remove(api.db.bind, "before_cursor_execute", record)
    assert status == 200
    assert bundle["presets"]["value"] == original
    assert bundle["active"]["value"] == "Legacy"
    assert len(statements) == 1
    assert_raw(api, original, "Legacy")


def test_existing_default_partial_patch_preserves_all_presets_metadata_and_hidden_fields(api):
    original = [preset(f"Preset {index}", textSize=11, custom={"index": index}) for index in range(30)]
    original[17] = preset("Settings default", textSize=12, gridMode="both", timeZone="Asia/Tokyo",
                          wickUpColor="#123456", borderUpColor="#654321", candleUpColor="#abcdef",
                          bodyUpColor="#abcdef", futureSetting={"nested": [True]})
    seed(api, original, "Preset 2")
    status, result = api("PATCH", CHART_PATH, {"textSize": 18, "candleUpColor": "#00FFaa"})
    assert status == 200
    saved = result["presets"]["value"]
    assert len(saved) == 30
    assert [item["name"] for item in saved] == [item["name"] for item in original]
    for index, item in enumerate(saved):
        if index != 17:
            assert item == original[index]
    expected_settings = {**original[17]["settings"], "textSize": 18, "candleUpColor": "#00FFaa", "bodyUpColor": "#00FFaa"}
    assert saved[17]["settings"] == expected_settings
    assert saved[17]["futureMetadata"] == original[17]["futureMetadata"]
    assert saved[17]["updatedAt"] != "legacy-time"
    assert result["active"]["value"] == "Settings default"
    assert_raw(api, saved, "Settings default")


@pytest.mark.parametrize("active, source_index", [("Selected", 1), ("missing-name", 0), (None, 0)])
def test_new_default_clones_active_or_first_raw_settings_and_inserts_without_truncation(api, active, source_index):
    original = [preset("First", textSize=13, watermarkText="first", unknown={"keep": [1]}),
                preset("Selected", textSize=16, watermarkText="selected", wickDownColor="#112233", borderDownColor="#445566")]
    original.extend(preset(f"Extra {index}", textSize=12) for index in range(28))
    seed(api, original, active)
    status, bundle = api("PATCH", CHART_PATH, {"gridMode": "vertical", "candleDownColor": "#aabbcc"})
    assert status == 200
    saved = bundle["presets"]["value"]
    assert len(saved) == 31
    assert saved[1:] == original
    assert saved[0]["name"] == "Settings default"
    assert saved[0]["settings"] == {**original[source_index]["settings"], "gridMode": "vertical", "candleDownColor": "#aabbcc", "bodyDownColor": "#aabbcc"}
    assert bundle["active"]["value"] == "Settings default"


def test_new_storage_accepts_all_nine_fields_and_integer_boundaries(api):
    patch = {"timeHoursFormat": "12-hour", "dateFormat": "yyyy-MM-dd", "textSize": 10, "gridMode": "none",
             "backgroundColor": "#112233", "textColor": "#445566", "gridColor": "#778899",
             "candleUpColor": "#aabbcc", "candleDownColor": "#ddeeff"}
    status, bundle = api("PATCH", CHART_PATH, patch)
    assert status == 200
    settings = bundle["presets"]["value"][0]["settings"]
    assert all(settings[key] == value for key, value in patch.items())
    assert settings["bodyUpColor"] == patch["candleUpColor"]
    assert settings["bodyDownColor"] == patch["candleDownColor"]
    assert api("PATCH", CHART_PATH, {"textSize": 18, "timeHoursFormat": "24-hour", "dateFormat": "MMM dd yyyy"})[0] == 200
    assert api("PATCH", CHART_PATH, {"dateFormat": "dd MMM yy", "gridMode": "horizontal"})[0] == 200


@pytest.mark.parametrize("patch", [
    {"textSize": 9}, {"textSize": 19}, {"textSize": 12.0}, {"textSize": "12"}, {"textSize": True}, {"textSize": None},
    {"timeHoursFormat": "12"}, {"timeHoursFormat": None}, {"dateFormat": "dd/MM/yyyy"}, {"gridMode": "diagonal"},
    {"backgroundColor": "#abc"}, {"textColor": "red"}, {"gridColor": "#abcdef00"},
    {"candleUpColor": "#gggggg"}, {"candleDownColor": None}, {"wickUpColor": "#112233"},
    {"timeZone": "UTC"}, {"presets": []},
])
def test_invalid_chart_patch_never_changes_either_storage_row(api, patch):
    original = [preset("Original", textSize=12)]
    seed(api, original, "Original")
    assert api("PATCH", CHART_PATH, patch)[0] == 422
    assert_raw(api, original, "Original")


@pytest.mark.parametrize("presets, active", [
    ({"legacy": []}, "Original"), ("recoverable legacy", "Original"), ([None], "Original"),
    ([preset("Original", textSize=12), "bad entry"], "Original"),
    ([{"name": "Original", "settings": []}], "Original"),
    ([{"name": "Original", "settings": None}], "Original"),
    ([{"name": "Original"}], "Original"),
    ([preset("Original", textSize=12)], {"name": "Original"}),
    ([preset("Original", textSize=12)], 7),
])
def test_malformed_raw_chart_state_is_rejected_without_destructive_repair(api, presets, active):
    seed(api, presets, active)
    assert api("PATCH", CHART_PATH, {"textSize": 14})[0] == 409
    assert_raw(api, presets, active)


def test_chart_routes_require_auth_and_keep_owner_storage_isolated(api):
    for method in ["GET", "PATCH"]:
        route = next(route for route in routes.router.routes if route.path == "/settings/chart" and method in route.methods)
        assert any(dependency.call is routes.require_auth for dependency in route.dependant.dependencies)
    assert api("PATCH", CHART_PATH, {"textSize": 11})[0] == 200
    assert api("GET", CHART_PATH, owner=1)[1]["presets"]["value"] is None
    assert api("PATCH", CHART_PATH, {"textSize": 17}, owner=1)[0] == 200
    assert api("GET", CHART_PATH)[1]["presets"]["value"][0]["settings"]["textSize"] == 11
    assert api("GET", CHART_PATH, owner=1)[1]["presets"]["value"][0]["settings"]["textSize"] == 17


def test_stale_second_row_exhausts_three_attempts_and_rolls_back_first_row(api, monkeypatch):
    original = [preset("Settings default", textSize=12)]
    seed(api, original, "Settings default")
    execute = api.db.execute
    writes = []
    def stale_second(statement, *args, **kwargs):
        if isinstance(statement, Update) and statement.table.name == "app_storage":
            writes.append(statement)
            if len(writes) % 2 == 0:
                return SimpleNamespace(rowcount=0)
        return execute(statement, *args, **kwargs)
    monkeypatch.setattr(api.db, "execute", stale_second)
    assert api("PATCH", CHART_PATH, {"textSize": 15})[0] == 409
    assert len(writes) == 6
    assert_raw(api, original, "Settings default")


def test_stale_first_row_retries_against_latest_committed_state(api, monkeypatch):
    original = [preset("Settings default", textSize=12, unknown="keep")]
    seed(api, original, "Settings default")
    execute = api.db.execute
    writes = []
    def stale_once(statement, *args, **kwargs):
        if isinstance(statement, Update) and statement.table.name == "app_storage":
            writes.append(statement)
            if len(writes) == 1:
                concurrent = [preset("Settings default", textSize=12, unknown="concurrent value", addedByOtherWriter={"keep": True})]
                execute(update(AppStorageItem).where(
                    AppStorageItem.user_id == api.owner_ids[0], AppStorageItem.namespace == "edgelab",
                    AppStorageItem.key == "chart-settings-presets.v1",
                ).values(value=concurrent, updated_at=datetime(2030, 1, 1, tzinfo=timezone.utc)).execution_options(synchronize_session=False))
                api.db.commit()
                return SimpleNamespace(rowcount=0)
        return execute(statement, *args, **kwargs)
    monkeypatch.setattr(api.db, "execute", stale_once)
    status, bundle = api("PATCH", CHART_PATH, {"textSize": 15})
    assert status == 200
    assert len(writes) == 3
    assert bundle["presets"]["value"][0]["settings"] == {"textSize": 15, "unknown": "concurrent value", "addedByOtherWriter": {"keep": True}}
    assert_raw(api, bundle["presets"]["value"], "Settings default")


def test_preferences_defaults_apply_only_on_creation_and_partial_patch_keeps_unknown_fields(api):
    status, created = api("PATCH", PREFERENCES_PATH, {"density": "compact"})
    assert status == 200
    assert created["value"] == {"appTheme": "dark", "density": "compact", "includeDiagnosticsByDefault": True}
    original = {"density": "compact", "includeDiagnosticsByDefault": False, "future": {"keep": [1]}}
    assert api("PUT", PREFERENCES_STORAGE, {"value": original})[0] == 200
    status, saved = api("PATCH", PREFERENCES_PATH, {"density": "comfortable"})
    assert status == 200
    assert saved["value"] == {**original, "density": "comfortable"}
    assert api("PATCH", PREFERENCES_PATH, {"includeDiagnosticsByDefault": True})[1]["value"] == {**original, "density": "comfortable", "includeDiagnosticsByDefault": True}
    # Existing partial blobs retain their exact unpatched shape.
    assert api("PUT", PREFERENCES_STORAGE, {"value": {"future": 1}})[0] == 200
    assert api("PATCH", PREFERENCES_PATH, {"density": "compact"})[1]["value"] == {"future": 1, "density": "compact"}


@pytest.mark.parametrize("patch", [{"density": "dense"}, {"density": None}, {"includeDiagnosticsByDefault": "false"},
                                  {"includeDiagnosticsByDefault": 0}, {"includeDiagnosticsByDefault": None}, {"future": 1}])
def test_preferences_strict_validation_preserves_existing_state(api, patch):
    original = {"density": "compact", "includeDiagnosticsByDefault": False}
    assert api("PUT", PREFERENCES_STORAGE, {"value": original})[0] == 200
    assert api("PATCH", PREFERENCES_PATH, patch)[0] == 422
    assert api("GET", PREFERENCES_STORAGE)[1]["value"] == original


@pytest.mark.parametrize("original", [[], "legacy", 42])
def test_preferences_reject_nonobject_raw_state(api, original):
    assert api("PUT", PREFERENCES_STORAGE, {"value": original})[0] == 200
    assert api("PATCH", PREFERENCES_PATH, {"density": "compact"})[0] == 409
    assert api("GET", PREFERENCES_STORAGE)[1]["value"] == original


def test_preferences_require_auth_and_keep_owner_storage_isolated(api):
    route = next(route for route in routes.router.routes if route.path == "/settings/preferences" and "PATCH" in route.methods)
    assert any(dependency.call is routes.require_auth for dependency in route.dependant.dependencies)
    first = api("PATCH", PREFERENCES_PATH, {"includeDiagnosticsByDefault": False})[1]
    assert api("GET", PREFERENCES_STORAGE, owner=1)[1]["value"] is None
    assert api("PATCH", PREFERENCES_PATH, {"density": "compact"}, owner=1)[0] == 200
    assert api("GET", PREFERENCES_STORAGE)[1]["value"] == first["value"]


def test_second_row_integrity_conflict_rolls_back_the_entire_chart_patch(api, monkeypatch):
    original = [preset("Settings default", textSize=12)]
    seed(api, original, "Settings default")
    execute = api.db.execute
    writes = []
    def fail_second(statement, *args, **kwargs):
        if isinstance(statement, Update) and statement.table.name == "app_storage":
            writes.append(statement)
            if len(writes) % 2 == 0:
                raise IntegrityError("injected second-row conflict", {}, Exception("conflicting concurrent write"))
        return execute(statement, *args, **kwargs)
    monkeypatch.setattr(api.db, "execute", fail_second)
    assert api("PATCH", CHART_PATH, {"textSize": 15})[0] == 409
    assert len(writes) == 6
    assert_raw(api, original, "Settings default")


def test_conflicting_initial_insert_does_not_leave_either_chart_row(api, monkeypatch):
    attempts = []
    original_commit = api.db.commit
    def conflict_commit():
        # Inject only the tested chart insert conflict, not the prior access
        # policy's independent beta enrollment transaction.
        if not any(isinstance(row, AppStorageItem) for row in api.db.new):
            return original_commit()
        api.db.flush()
        attempts.append(True)
        raise IntegrityError("injected active-row insert conflict", {}, Exception("concurrent initial insert"))
    monkeypatch.setattr(api.db, "commit", conflict_commit)
    assert api("PATCH", CHART_PATH, {"textSize": 14})[0] == 409
    assert len(attempts) == 3
    assert_raw(api, None, None)


@pytest.mark.parametrize("theme", ["dark", "light", "system"])
def test_app_theme_saves_per_owner_and_preserves_other_preferences(api, theme):
    original = {"density": "compact", "includeDiagnosticsByDefault": False, "future": {"keep": [1]}}
    assert api("PUT", PREFERENCES_STORAGE, {"value": original})[0] == 200
    status, result = api("PATCH", PREFERENCES_PATH, {"appTheme": theme})
    assert status == 200
    assert result["value"] == {**original, "appTheme": theme}
    assert api("GET", PREFERENCES_STORAGE)[1]["value"] == result["value"]
    assert api("GET", PREFERENCES_STORAGE, owner=1)[1]["value"] is None
    assert api("PATCH", PREFERENCES_PATH, {"density": "comfortable"}, owner=1)[1]["value"]["appTheme"] == "dark"
    assert api("GET", PREFERENCES_STORAGE)[1]["value"] == result["value"]


@pytest.mark.parametrize("theme", ["auto", "LIGHT", "", None, 1, True, {"theme": "dark"}])
def test_app_theme_rejects_invalid_values_without_changing_saved_preferences(api, theme):
    original = {"appTheme": "system", "density": "compact", "includeDiagnosticsByDefault": False}
    assert api("PUT", PREFERENCES_STORAGE, {"value": original})[0] == 200
    assert api("PATCH", PREFERENCES_PATH, {"appTheme": theme})[0] == 422
    assert api("GET", PREFERENCES_STORAGE)[1]["value"] == original
