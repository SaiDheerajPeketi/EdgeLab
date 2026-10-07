import asyncio
import json
from copy import deepcopy
from dataclasses import replace
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import auth
from app.api import routes
from app.services import app_data_operations
from app.auth import AuthenticatedUser
from app.db import Base
from app.models import BetaUser


DEFAULTS = {
    "default_broker": "Manual",
    "default_currency": "USD",
    "default_entry_type": "TAKEN",
    "require_account_for_taken_trades": True,
}
STORAGE_PATH = "/api/app-storage/edgelab/live-journal.v1"


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

        yield request
    engine.dispose()


def test_partial_settings_patch_preserves_the_current_blob_and_unknown_settings(api):
    original = {
        "schemaVersion": 7, "trades": [{"id": "legacy-private", "note": "keep me"}],
        "accounts": [{"name": "Desk"}], "future": {"nested": [1, {"ok": True}]},
        "settings": {**DEFAULTS, "future_setting": {"mode": "preserve"}, "default_timezone": "Europe/Berlin"},
    }
    untouched = deepcopy(original)
    assert api("PUT", STORAGE_PATH, {"value": original})[0] == 200
    status, saved = api("PATCH", "/api/journal/settings", {"default_currency": "EUR"})
    assert status == 200
    expected = {**original, "settings": {**original["settings"], "default_currency": "EUR"}}
    assert saved["namespace"] == "edgelab"
    assert saved["key"] == "live-journal.v1"
    assert saved["updated_at"] is not None
    assert saved["value"] == expected
    assert api("GET", STORAGE_PATH)[1]["value"] == expected
    assert original == untouched
    # A later patch merges against the current committed value, rather than a cached snapshot.
    status, later = api("PATCH", "/api/journal/settings", {"default_entry_type": "MISSED", "require_account_for_taken_trades": False})
    assert status == 200
    assert later["value"]["settings"] == {**expected["settings"], "default_entry_type": "MISSED", "require_account_for_taken_trades": False}


def test_missing_settings_use_defaults_and_blank_broker_normalizes_without_cross_owner_writes(api):
    assert api("GET", STORAGE_PATH)[1]["value"] is None
    status, created = api("PATCH", "/api/journal/settings", {"default_broker": "  "})
    assert status == 200
    assert created["value"]["settings"] == DEFAULTS
    assert api("GET", STORAGE_PATH, owner=1)[1]["value"] is None
    status, other = api("PATCH", "/api/journal/settings", {"default_broker": "Other desk", "default_currency": "GBP"}, owner=1)
    assert status == 200
    assert other["value"]["settings"] == {**DEFAULTS, "default_broker": "Other desk", "default_currency": "GBP"}
    assert api("GET", STORAGE_PATH)[1]["value"] == created["value"]


@pytest.mark.parametrize("patch", [
    {"default_broker": "x" * 81}, {"default_broker": None}, {"default_broker": 4},
    {"default_currency": "usd"}, {"default_currency": "US"}, {"default_currency": "US1"}, {"default_currency": " US"},
    {"default_entry_type": "taken"}, {"default_entry_type": "OTHER"}, {"default_entry_type": None},
    {"require_account_for_taken_trades": "false"}, {"require_account_for_taken_trades": 1},
    {"require_account_for_taken_trades": None}, {"trades": []},
])
def test_invalid_settings_do_not_write_storage(api, patch):
    original = {"settings": DEFAULTS, "private": {"marker": "untouched"}}
    assert api("PUT", STORAGE_PATH, {"value": original})[0] == 200
    assert api("PATCH", "/api/journal/settings", patch)[0] == 422
    assert api("GET", STORAGE_PATH)[1]["value"] == original


def test_settings_endpoint_requires_auth_and_accepts_the_broker_boundary(api):
    route = next(route for route in routes.router.routes if route.path == "/journal/settings" and "PATCH" in route.methods)
    assert any(dependency.call is routes.require_auth for dependency in route.dependant.dependencies)
    status, result = api("PATCH", "/api/journal/settings", {"default_broker": "x" * 80})
    assert status == 200
    assert result["value"]["settings"]["default_broker"] == "x" * 80


def test_note_template_storage_keeps_multiline_whitespace_and_owner_isolation(api):
    path = "/api/app-storage/edgelab/notebook-template.v1"
    template = "  Before: {entry}\nAfter: {exit}  \n\n"
    assert api("PUT", path, {"value": template})[1]["value"] == template
    assert api("GET", path)[1]["value"] == template
    assert api("GET", path, owner=1)[1]["value"] is None
    assert api("PUT", path, {"value": "Other owner\n"}, owner=1)[0] == 200
    assert api("GET", path)[1]["value"] == template


@pytest.mark.parametrize("original", [[{"recoverable": "legacy"}], "recoverable legacy value", {"settings": [], "trades": [{"id": "keep"}]}])
def test_corrupted_journal_storage_rejects_settings_patch_without_destroying_data(api, original):
    assert api("PUT", STORAGE_PATH, {"value": original})[0] == 200
    assert api("PATCH", "/api/journal/settings", {"default_currency": "EUR"})[0] == 409
    assert api("GET", STORAGE_PATH)[1]["value"] == original
