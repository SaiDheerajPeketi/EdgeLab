"""Enrollment snapshots use the authority established under the real enrollment lock."""
import asyncio
from dataclasses import replace
import json
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app import models
from app.config import settings as default_settings
from app.db import Base
from app.main import app
from app.services import access_policy
from test_public_access import public, billing_context, workspace, paid


def seed_position(c):
    c.set_settings(deployment_mode="beta", beta_seats_total=1)
    with c.factory() as db:
        assert access_policy.access_snapshot(db, c.owners[0], c.settings)["workspace_access"]
        db.commit()
        assert db.get(models.BetaUser, c.owners[0]).beta_position == 1


def revoke_at_lock(factory, owner, monkeypatch):
    original = access_policy.lock_enrollment
    fired = []
    def lock(db):
        if not fired:
            with factory() as observer:
                user = observer.get(models.BetaUser, owner)
                assert (user.status, user.beta_position) == ("APPROVED", 1)
                user.status, user.beta_position = "REVOKED", None
                observer.commit()
            fired.append(True)
        return original(db)
    monkeypatch.setattr(access_policy, "lock_enrollment", lock)
    return fired


def test_snapshot_revocation_before_enrollment_lock_is_authoritative(public, monkeypatch):
    c = public
    seed_position(c)
    fired = revoke_at_lock(c.factory, c.owners[0], monkeypatch)
    with c.factory() as db:
        result = access_policy.access_snapshot(db, c.owners[0], c.settings)
        db.commit()
    assert fired == [True]
    assert result["workspace_access"] is False, result
    assert result["plan"] == "none"
    assert c.provider.calls == []


def test_protected_storage_does_not_publish_revoked_owner_data(public, monkeypatch):
    c = public
    seed_position(c)
    fired = revoke_at_lock(c.factory, c.owners[0], monkeypatch)
    response = workspace(c)
    assert fired == [True]
    assert response.status_code == 403, response.body
    assert response.json()["detail"] == "Approved beta account required"
    assert b"private_owner" not in response.body
    assert c.provider.calls == []


def test_snapshot_race_uses_independent_file_database_connections(tmp_path, monkeypatch):
    engine = create_engine("sqlite:///" + str(tmp_path / "access.sqlite"))
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    settings = replace(default_settings, deployment_mode="beta", beta_seats_total=1)
    try:
        with factory() as db:
            user = models.BetaUser(email="positioned@example.test", name="Positioned",
                                  provider="google", status="APPROVED")
            db.add(user)
            db.flush()
            owner = user.id
            assert access_policy.access_snapshot(db, owner, settings)["workspace_access"]
            db.commit()
        original = access_policy.lock_enrollment
        fired = []
        def lock(db):
            if not fired:
                active_connection = db.connection().connection.driver_connection
                with factory() as observer:
                    assert observer.connection().connection.driver_connection is not active_connection
                    user = observer.get(models.BetaUser, owner)
                    assert (user.status, user.beta_position) == ("APPROVED", 1)
                    user.status, user.beta_position = "REVOKED", None
                    observer.commit()
                fired.append(True)
            return original(db)
        monkeypatch.setattr(access_policy, "lock_enrollment", lock)
        with factory() as db:
            result = access_policy.access_snapshot(db, owner, settings)
            db.commit()
        assert fired == [True]
        assert result["workspace_access"] is False, result
        with factory() as db:
            assert db.get(models.BetaUser, owner).status == "REVOKED"
    finally:
        engine.dispose()


def test_receipted_write_revocation_leaves_reserved_operation_and_storage_unchanged(public, monkeypatch):
    c = public
    seed_position(c)
    operation = str(uuid4())
    path = "/app-storage/preferences/workspace"
    reserved = c.client.post(f"/api/app-data/operations/{operation}/reserve",
        headers=c.headers[0], json_body={"method": "PUT", "path": path})
    assert reserved.status_code == 200, reserved.body
    fired = revoke_at_lock(c.factory, c.owners[0], monkeypatch)
    response = c.client.request("PUT", "/api" + path,
        headers={**c.headers[0], "X-EdgeLab-Operation-Id": operation},
        json_body={"value": {"unauthorized": True}})
    assert fired == [True]
    assert response.status_code == 403, response.body
    with c.factory() as db:
        row = db.scalar(select(models.AppDataOperation).where(
            models.AppDataOperation.operation_id == operation))
        assert row.status == "reserved" and row.http_status is None
        item = db.scalar(select(models.AppStorageItem).where(
            models.AppStorageItem.user_id == c.owners[0],
            models.AppStorageItem.namespace == "preferences",
            models.AppStorageItem.key == "workspace"))
        assert item.value == {"private_owner": 0}
    assert c.provider.calls == []


def test_dataset_socket_revoked_at_initial_lock_closes_without_publishing(public, monkeypatch):
    c = public
    seed_position(c)
    fired = revoke_at_lock(c.factory, c.owners[0], monkeypatch)
    token = c.headers[0]["Authorization"].removeprefix("Bearer ")
    messages, reads = [], []
    async def receive():
        reads.append(True)
        if len(reads) == 1:
            return {"type": "websocket.connect"}
        if len(reads) == 2:
            return {"type": "websocket.receive", "text": json.dumps({"authToken": token})}
        await asyncio.Event().wait()
    async def send(message):
        messages.append(message)
    scope = {"type": "websocket", "asgi": {"version": "3.0", "spec_version": "2.4"},
        "scheme": "wss", "path": "/api/datasets/stream", "raw_path": b"/api/datasets/stream",
        "root_path": "", "query_string": b"", "headers": [], "subprotocols": [],
        "server": ("testserver", 443), "client": ("127.0.0.1", 12345)}
    async def run():
        await asyncio.wait_for(app(scope, receive, send), timeout=2)
    asyncio.run(run())
    assert fired == [True]
    assert messages == [
        {"type": "websocket.accept", "subprotocol": None, "headers": []},
        {"type": "websocket.close", "code": 4401, "reason": ""},
    ]
    assert c.provider.calls == []


@pytest.mark.parametrize("owner,allowed", [(0, True), (1, False), (2, False)],
                         ids=["approved-in-cap", "approved-beyond-cap", "waitlisted"])
def test_authoritative_beta_approval_and_capacity_remain_enforced(public, owner, allowed):
    c = public
    seed_position(c)
    with c.factory() as db:
        result = access_policy.access_snapshot(db, c.owners[owner], c.settings)
        db.commit()
    assert result["workspace_access"] is allowed
    assert result["plan"] == ("beta" if allowed else "none")
    assert workspace(c, owner).status_code == (200 if allowed else 403)
    assert c.provider.calls == []


def test_beta_vacancy_still_auto_enrolls_waitlisted_identity(public):
    c = public
    c.set_settings(deployment_mode="beta", beta_seats_total=3)
    response = workspace(c, 2)
    assert response.status_code == 200, response.body
    with c.factory() as db:
        user = db.get(models.BetaUser, c.owners[2])
        assert (user.status, user.beta_position) == ("APPROVED", 3)
    assert c.provider.calls == []


def test_production_legacy_approval_does_not_enroll_or_grant_unpaid_access(public, monkeypatch):
    c = public
    def unexpected_lock(db):
        pytest.fail("Production access must not mutate beta enrollment.")
    monkeypatch.setattr(access_policy, "lock_enrollment", unexpected_lock)
    assert workspace(c).status_code == 403
    assert c.client.get("/api/app-data/export", headers=c.headers[0]).status_code == 403
    with c.factory() as db:
        user = db.get(models.BetaUser, c.owners[0])
        assert (user.status, user.beta_position) == ("APPROVED", None)
    assert c.provider.calls == []


def test_paid_only_beta_does_not_auto_enroll_or_treat_approval_as_payment(public, monkeypatch):
    c = public
    c.set_settings(deployment_mode="beta", beta_seats_total=3)
    def unexpected_lock(db):
        pytest.fail("Paid-only access must not acquire enrollment authority.")
    monkeypatch.setattr(access_policy, "lock_enrollment", unexpected_lock)
    for owner in (0, 2):
        with c.factory() as db:
            result = access_policy.access_snapshot(db, c.owners[owner], c.settings, paid_only=True)
            db.commit()
        assert result["workspace_access"] is False and result["plan"] == "none"
        response = c.client.get("/api/app-data/export", headers=c.headers[owner])
        assert response.status_code == 403
        assert response.json()["detail"] == "Data export requires an active subscription"
    with c.factory() as db:
        assert db.get(models.BetaUser, c.owners[2]).status == "WAITLISTED"
    assert c.provider.calls == []


@pytest.mark.parametrize("mode", ["production", "beta"])
def test_fresh_live_paid_export_remains_independent_of_beta_approval(public, monkeypatch, mode):
    c = public
    paid(c, 2)
    c.set_settings(deployment_mode=mode)
    with c.factory() as db:
        user = db.get(models.BetaUser, c.owners[2])
        user.status, user.beta_position = "REVOKED", None
        db.commit()
    def unexpected_lock(db):
        pytest.fail("Paid-only export must not consult beta enrollment.")
    monkeypatch.setattr(access_policy, "lock_enrollment", unexpected_lock)
    response = c.client.get("/api/app-data/export", headers=c.headers[2])
    assert response.status_code == 200, response.body
    assert [row["value"] for row in response.json()["tables"]["app_storage"]] == [{"private_owner": 2}]
    assert c.client.get("/api/app-data/export", headers=c.headers[0]).status_code == 403


def test_test_mode_subscription_cannot_grant_beta_paid_only_export(public):
    c = public
    paid(c)
    c.set_settings(deployment_mode="beta", stripe_mode="test", stripe_secret_key="sk_test_fixture")
    response = c.client.get("/api/app-data/export", headers=c.headers[0])
    assert response.status_code == 403
    assert response.json()["detail"] == "Data export requires an active subscription"
