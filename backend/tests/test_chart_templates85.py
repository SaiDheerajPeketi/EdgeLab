from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.sql.dml import Update

from app.api import routes
from app.models import AppStorageItem
from test_chart_settings import api, assert_raw, preset, seed


PATH = "/api/settings/chart/templates"


def test_save_normalizes_name_and_preserves_raw_metadata_unknown_settings_and_other_templates(api):
    original = [preset("Other", custom={"untouched": True}),
                preset("  My   chart ", textSize=12, futureSetting={"keep": [1, 2]}, wickUpColor="#112233")]
    seed(api, original, "Other")
    status, result = api("POST", PATH, {"action": "save", "name": "\tMy chart\n", "settings": {"textSize": 18, "gridMode": "none"}})
    assert status == 200
    saved = result["presets"]["value"]
    assert saved[0]["name"] == "My chart"
    assert saved[0]["settings"] == {**original[1]["settings"], "textSize": 18, "gridMode": "none"}
    assert saved[0]["futureMetadata"] == original[1]["futureMetadata"]
    assert saved[0]["updatedAt"] != "legacy-time"
    assert saved[1:] == original[:1]
    assert result["active"]["value"] == "My chart"
    assert_raw(api, saved, "My chart")


def test_create_save_and_activate_return_acknowledged_bundle_without_changing_other_templates(api):
    original = [preset(f"Template {i}", custom=i) for i in range(32)]
    seed(api, original, "Template 0")
    status, created = api("POST", PATH, {"action": "save", "name": "New", "settings": {"showWicks": False, "footprintMode": "delta"}})
    assert status == 200
    saved = created["presets"]["value"]
    assert len(saved) == 33
    assert saved[1:] == original
    assert saved[0]["settings"] == {"showWicks": False, "footprintMode": "delta"}
    status, activated = api("POST", PATH, {"action": "activate", "name": "Template 31"})
    assert status == 200
    assert activated["presets"]["value"] == saved
    assert_raw(api, saved, "Template 31")


def test_missing_activation_never_creates_dangling_active_template(api):
    original = [preset("Original", textSize=12)]
    seed(api, original, "Original")
    assert api("POST", PATH, {"action": "activate", "name": "Missing"})[0] == 404
    assert_raw(api, original, "Original")


def test_delete_is_idempotent_and_changes_activation_only_when_deleting_active_template(api):
    original = [preset("First", textSize=12), preset("Second", textSize=14), preset("Third", textSize=16)]
    seed(api, original, "Second")
    status, deleted = api("POST", PATH, {"action": "delete", "name": "Third"})
    assert status == 200
    assert deleted["active"]["value"] == "Second"
    stored = api("GET", "/api/settings/chart")[1]
    status, again = api("POST", PATH, {"action": "delete", "name": "Third"})
    assert status == 200 and again == stored
    status, fallback = api("POST", PATH, {"action": "delete", "name": "Second"})
    assert status == 200
    assert_raw(api, original[:1], "First")
    assert fallback["active"]["value"] == "First"
    assert api("POST", PATH, {"action": "delete", "name": "First"})[1]["active"]["value"] is None
    assert_raw(api, [], None)


def test_missing_delete_preserves_absent_rows(api):
    assert api("POST", PATH, {"action": "delete", "name": "Missing"})[0] == 200
    assert_raw(api, None, None)


@pytest.mark.parametrize("active", ["missing", "  Other  "])
@pytest.mark.parametrize("name", ["Target", "Missing"])
def test_inactive_or_missing_delete_preserves_legacy_raw_activation(api, active, name):
    original = [preset("Other"), preset("Target")]
    seed(api, original, active)
    status, result = api("POST", PATH, {"action": "delete", "name": name})
    assert status == 200
    expected = original[:1] if name == "Target" else original
    assert result["presets"]["value"] == expected
    assert result["active"]["value"] == active
    assert_raw(api, expected, active)


@pytest.mark.parametrize("body", [
    {"action": "save", "name": ""}, {"action": "save", "name": " \t\n ", "settings": {}},
    {"action": "save", "name": 7, "settings": {}}, {"action": "save", "name": True, "settings": {}},
    {"action": "save", "name": "Valid"}, {"action": "save", "name": "Valid", "settings": None},
    {"action": "save", "name": "Valid", "settings": []},
    {"action": "activate", "name": "Valid", "settings": {}},
    {"action": "delete", "name": "Valid", "settings": None},
    {"action": "other", "name": "Valid"}, {"action": "save", "name": "Valid", "settings": {}, "owner": 2},
])
def test_strict_command_validation_never_changes_storage(api, body):
    original = [preset("Valid", textSize=12)]
    seed(api, original, "Valid")
    assert api("POST", PATH, body)[0] == 422
    assert_raw(api, original, "Valid")


@pytest.mark.parametrize("original, active", [
    ({"not": "a list"}, "Valid"), ([None], "Valid"), ([{"name": " ", "settings": {}}], None),
    ([{"name": "Valid", "settings": []}], "Valid"), ([preset("Valid"), preset("  Valid ")], "Valid"),
    ([preset("Valid")], {"name": "Valid"}),
])
@pytest.mark.parametrize("action", ["save", "delete", "activate"])
def test_malformed_or_duplicate_raw_state_requires_recovery_for_every_command(api, original, active, action):
    seed(api, original, active)
    body = {"action": action, "name": "Valid"}
    if action == "save":
        body["settings"] = {"textSize": 18}
    assert api("POST", PATH, body)[0] == 409
    assert_raw(api, original, active)


def test_commands_require_auth_and_use_only_current_owner(api):
    route = next(route for route in routes.router.routes if route.path == "/settings/chart/templates" and "POST" in route.methods)
    assert any(dependency.call is routes.require_auth for dependency in route.dependant.dependencies)
    assert api("POST", PATH, {"action": "save", "name": "Mine", "settings": {"textSize": 11}})[0] == 200
    assert api("POST", PATH, {"action": "activate", "name": "Mine"}, owner=1)[0] == 404
    assert api("POST", PATH, {"action": "delete", "name": "Mine"}, owner=1)[0] == 200
    assert api("POST", PATH, {"action": "save", "name": "Mine", "settings": {"textSize": 17}}, owner=1)[0] == 200
    assert api("GET", "/api/settings/chart")[1]["presets"]["value"][0]["settings"] == {"textSize": 11}


@pytest.mark.parametrize("conflict", ["stale", "integrity"])
@pytest.mark.parametrize("action", ["save", "delete", "activate"])
def test_second_row_conflict_rolls_back_entire_command_and_fails_after_three_attempts(api, monkeypatch, conflict, action):
    original = [preset("First", textSize=12), preset("Target", textSize=14)]
    seed(api, original, "First")
    execute = api.db.execute
    writes = []

    def fail_second(statement, *args, **kwargs):
        if isinstance(statement, Update) and statement.table.name == "app_storage":
            writes.append(statement)
            if len(writes) % 2 == 0:
                if conflict == "integrity":
                    raise IntegrityError("second-row conflict", {}, Exception("concurrent write"))
                return SimpleNamespace(rowcount=0)
        return execute(statement, *args, **kwargs)

    monkeypatch.setattr(api.db, "execute", fail_second)
    body = {"action": action, "name": "Target"}
    if action == "save":
        body["settings"] = {"textSize": 18}
    assert api("POST", PATH, body)[0] == 409
    assert len(writes) == 6
    assert_raw(api, original, "First")


def test_retry_merges_latest_template_state_and_retains_concurrently_added_template(api, monkeypatch):
    seed(api, [preset("Target", textSize=12, future="old")], "Target")
    execute = api.db.execute
    writes = []
    concurrent = [preset("Added", future="new"), preset("Target", textSize=12, future="concurrent")]

    def conflict_once(statement, *args, **kwargs):
        if isinstance(statement, Update) and statement.table.name == "app_storage":
            writes.append(statement)
            if len(writes) == 1:
                execute(update(AppStorageItem).where(
                    AppStorageItem.user_id == api.owner_ids[0], AppStorageItem.namespace == "edgelab",
                    AppStorageItem.key == "chart-settings-presets.v1",
                ).values(value=concurrent, updated_at=datetime(2030, 1, 1, tzinfo=timezone.utc)).execution_options(synchronize_session=False))
                api.db.commit()
                return SimpleNamespace(rowcount=0)
        return execute(statement, *args, **kwargs)

    monkeypatch.setattr(api.db, "execute", conflict_once)
    status, result = api("POST", PATH, {"action": "save", "name": "Target", "settings": {"textSize": 18}})
    assert status == 200 and len(writes) == 3
    assert result["presets"]["value"][0]["settings"] == {"textSize": 18, "future": "concurrent"}
    assert result["presets"]["value"][1] == concurrent[0]
    assert_raw(api, result["presets"]["value"], "Target")


def test_initial_insert_conflict_leaves_neither_storage_row(api, monkeypatch):
    commit = api.db.commit
    attempts = []

    def conflict_commit():
        if not any(isinstance(row, AppStorageItem) for row in api.db.new):
            return commit()
        api.db.flush()
        attempts.append(True)
        raise IntegrityError("initial insert conflict", {}, Exception("concurrent write"))

    monkeypatch.setattr(api.db, "commit", conflict_commit)
    assert api("POST", PATH, {"action": "save", "name": "New", "settings": {}})[0] == 409
    assert len(attempts) == 3
    assert_raw(api, None, None)
