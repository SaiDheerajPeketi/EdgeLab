"""Legacy recovery through the real HTTP app, JWT verifier and isolated database.

Only Google/provider network I/O and test database/configuration are fixtures.
Recovery must retain the owner while granting no subscription by itself.
"""
from dataclasses import replace
from datetime import date, timedelta

import pytest
from sqlalchemy import select, text

from app import models
from app.services import billing
from test_billing_routes import (
    context as billing_context,
    checkout,
    customer,
    snapshot,
    status,
)
from test_public_access import public as public_access_context, exchange


@pytest.fixture
def recovery(public_access_context):
    return public_access_context


def seed_legacy(c, provider="email", email="legacy@gmail.com"):
    """Keep one historical JWT and issue another through actual manual beta HTTP."""
    with c.factory() as db:
        user = db.get(models.BetaUser, c.owners[0])
        user.email = email
        user.provider = "email"
        user.google_subject = None
        db.commit()
    c.set_settings(deployment_mode="beta")
    manual = c.client.post("/api/auth/beta/access", json_body={
        "email": email,
        "name": "Legacy account",
    })
    assert manual.status_code == 200
    old_headers = [c.headers[0], {
        "Authorization": "Bearer " + manual.json()["session"]["token"],
    }]
    c.set_settings(deployment_mode="production")
    with c.factory() as db:
        user = db.get(models.BetaUser, c.owners[0])
        user.provider = provider
        user.status = "APPROVED"
        user.beta_position = 17
        note = models.JournalDailyNote(
            user_id=user.id,
            account_scope_key="all",
            note_date=date(2026, 10, 7),
            body="Private journal decision before account recovery.",
        )
        db.add(note)
        db.commit()
    return old_headers


def persisted_account(c):
    with c.factory() as db:
        user = db.get(models.BetaUser, c.owners[0])
        note = db.scalar(select(models.JournalDailyNote).where(
            models.JournalDailyNote.user_id == user.id,
        ))
        storage = db.scalar(select(models.AppStorageItem).where(
            models.AppStorageItem.user_id == user.id,
        ))
        sessions = db.scalars(select(models.BetaSession.id).where(
            models.BetaSession.user_id == user.id,
        ).order_by(models.BetaSession.id)).all()
        return {
            "id": user.id,
            "email": user.email,
            "provider": user.provider,
            "subject": user.google_subject,
            "status": user.status,
            "rank": user.beta_position,
            "created_at": user.created_at,
            "note": (note.id, note.note_date, note.body) if note else None,
            "storage": storage.value,
            "sessions": sessions,
        }


def fresh_headers(response):
    assert response.status_code == 200
    return {"Authorization": "Bearer " + response.json()["session"]["token"]}


def recover(c, email="legacy@gmail.com", **claims):
    return exchange(c, email=email, sub="recovered-stable-google-subject",
                    name="Verified Google owner", **claims)


@pytest.mark.parametrize("provider", ["email", "google"])
@pytest.mark.parametrize("email,claims", [
    ("legacy@gmail.com", {}),
    ("legacy@workspace.example", {"hd": "workspace.example"}),
    ("legacy@alias.example", {"hd": "Workspace.EXAMPLE"}),
])
def test_authoritative_recovery_preserves_owner_data_and_revokes_all_manual_jwts(
    recovery, provider, email, claims,
):
    c = recovery
    old_headers = seed_legacy(c, provider, email)
    before = persisted_account(c)
    assert len(before["sessions"]) == 2
    for headers in old_headers:
        assert c.client.get("/api/auth/session", headers=headers).status_code == 401
    response = recover(c, email, **claims)
    headers = fresh_headers(response)
    user = response.json()["session"]["user"]
    assert user["id"] == before["id"]
    assert user["provider"] == "google"
    assert user["approved"] is True
    assert user["beta_position"] == 17
    assert user["workspace_access"] is False
    assert user["access_expires_at"] is None
    assert user["plan"] == "none"
    after = persisted_account(c)
    for key in ("id", "email", "status", "rank", "created_at", "note", "storage"):
        assert after[key] == before[key]
    assert after["provider"] == "google"
    assert after["subject"] == "recovered-stable-google-subject"
    assert len(after["sessions"]) == 1
    assert set(after["sessions"]).isdisjoint(before["sessions"])
    assert c.client.get("/api/auth/session", headers=headers).status_code == 200
    assert c.client.get("/api/app-storage/preferences/workspace", headers=headers).status_code == 403
    assert c.client.get("/api/app-data/export", headers=headers).status_code == 403
    for old in old_headers:
        for path in ("/api/auth/session", "/api/billing/status", "/api/app-data/export"):
            assert c.client.get(path, headers=old).status_code == 401
    # Revocation is scoped to the recovered owner, not other verified accounts.
    assert c.client.get("/api/auth/session", headers=c.headers[1]).status_code == 200
    with c.factory() as db:
        assert len(db.scalars(select(models.BetaUser)).all()) == 3
        assert db.get(models.BetaSession, c.sessions[1]) is not None
        assert db.get(models.BetaSession, c.sessions[2]) is not None
    assert len(c.oauth_calls) == 2


@pytest.mark.parametrize("email", [
    "legacy@thirdparty.example",
    "legacy@googlemail.com",
    "legacy@gmail.com.attacker.example",
])
@pytest.mark.parametrize("provider", ["email", "google"])
def test_verified_third_party_email_without_hd_cannot_recover_legacy_owner(
    recovery, email, provider,
):
    c = recovery
    seed_legacy(c, provider, email)
    before = persisted_account(c)
    response = recover(c, email)
    assert response.status_code == 409
    assert "mailbox ownership" in response.json()["detail"]
    assert persisted_account(c) == before


@pytest.mark.parametrize("hd", [
    None, "", False, 1, [], {}, "example", ".example.test", "example..test",
    "-example.test", "example-.test", "example.test.", " example.test",
    "example.test ", "exämple.test", "x" * 64 + ".test",
    ".".join(["x" * 63] * 4),
])
def test_invalid_hosted_domain_cannot_authorize_existing_account_recovery(recovery, hd):
    c = recovery
    email = "legacy@thirdparty.example"
    seed_legacy(c, email=email)
    before = persisted_account(c)
    response = recover(c, email, hd=hd)
    assert response.status_code == 409
    assert persisted_account(c) == before


def test_browser_supplied_hosted_domain_does_not_replace_provider_evidence(recovery):
    c = recovery
    email = "legacy@thirdparty.example"
    seed_legacy(c, email=email)
    before = persisted_account(c)
    c.claims.update(email=email, sub="browser-claimed-subject")
    response = c.client.post("/api/auth/google/exchange", json_body={
        "code": "real-code-fixture",
        "redirect_uri": c.settings.google_redirect_uri,
        "hd": "workspace.example",
        "email_verified": True,
        "email": email,
        "workspace_access": True,
    })
    assert response.status_code == 409
    assert len(c.oauth_calls) == 2
    assert persisted_account(c) == before


@pytest.mark.parametrize("claim,value", [
    ("email_verified", False),
    ("email_verified", "true"),
    ("sub", None),
    ("sub", "subject with spaces"),
])
def test_authoritative_mailbox_is_insufficient_without_verified_stable_identity(
    recovery, claim, value,
):
    c = recovery
    seed_legacy(c)
    before = persisted_account(c)
    c.claims.update(email="legacy@gmail.com", hd="workspace.example")
    response = exchange(c, **{claim: value})
    assert response.status_code == 502
    assert persisted_account(c) == before


@pytest.mark.parametrize("provider", ["email", "google"])
def test_authoritative_email_never_replaces_an_existing_subject_binding(recovery, provider):
    c = recovery
    seed_legacy(c, provider)
    with c.factory() as db:
        db.get(models.BetaUser, c.owners[0]).google_subject = "different-bound-subject"
        db.commit()
    before = persisted_account(c)
    assert recover(c).status_code == 409
    assert persisted_account(c) == before


def test_recovery_does_not_accept_unknown_legacy_provider(recovery):
    c = recovery
    seed_legacy(c, "saml")
    before = persisted_account(c)
    assert recover(c).status_code == 409
    assert persisted_account(c) == before


def test_known_subject_and_email_collision_never_merge_accounts(recovery):
    c = recovery
    seed_legacy(c)
    before = persisted_account(c)
    # Both authoritative claims are genuine provider I/O; subject and email
    # identify different existing owners, so neither side may win a merge.
    response = exchange(c, email="legacy@gmail.com", sub="verified-owner-1")
    assert response.status_code == 409
    assert persisted_account(c) == before
    assert c.client.get("/api/auth/session", headers=c.headers[1]).status_code == 200
    with c.factory() as db:
        assert db.get(models.BetaUser, c.owners[1]).email == "billing-1@example.test"
        assert len(db.scalars(select(models.BetaUser)).all()) == 3


def test_new_third_party_google_identity_and_bound_subject_return_need_no_hd(recovery):
    c = recovery
    first = exchange(c, email="new@thirdparty.example", sub="new-third-party-subject")
    headers = fresh_headers(first)
    user_id = first.json()["session"]["user"]["id"]
    assert user_id not in c.owners
    assert first.json()["session"]["user"]["workspace_access"] is False
    second = exchange(c, email="changed@thirdparty.example", sub="new-third-party-subject")
    assert second.status_code == 200
    assert second.json()["session"]["user"]["id"] == user_id
    assert c.client.get("/api/auth/session", headers=headers).status_code == 200
    with c.factory() as db:
        assert len(db.scalars(select(models.BetaUser)).all()) == 4
        assert db.get(models.BetaUser, user_id).email == "changed@thirdparty.example"


@pytest.mark.parametrize("proof", ["active", "canceled", "test", "stale"])
def test_recovered_identity_still_requires_current_live_paid_policy(recovery, proof):
    c = recovery
    seed_legacy(c)
    c.headers[0] = fresh_headers(recover(c))
    assert c.client.get("/api/app-data/export", headers=c.headers[0]).status_code == 403
    if proof == "test":
        c.config = replace(c.config, mode="test", secret_key="sk_test_routefixture")
        c.set_settings(stripe_mode="test", stripe_secret_key=c.config.secret_key)
    assert checkout(c).status_code == 200
    identifier = customer(c)
    c.provider.snapshots[identifier] = snapshot(c, identifier,
        state="canceled" if proof == "canceled" else "active")
    result = status(c)
    assert result.status_code == 200
    if proof == "stale":
        with c.factory() as db:
            row = db.scalar(select(models.BillingCustomer).where(
                models.BillingCustomer.user_id == c.owners[0],
            ))
            row.verified_at = models.utcnow() - timedelta(seconds=301)
            db.commit()
        c.provider.failure = billing.BillingError(503, "Provider unavailable")
        assert status(c).status_code == 503
    allowed = proof == "active"
    session = c.client.get("/api/auth/session", headers=c.headers[0])
    assert session.status_code == 200
    assert session.json()["user"]["workspace_access"] is allowed
    assert session.json()["user"]["plan"] == ("pro" if allowed else "none")
    workspace = c.client.get("/api/app-storage/preferences/workspace", headers=c.headers[0])
    exported = c.client.get("/api/app-data/export", headers=c.headers[0])
    assert workspace.status_code == (200 if allowed else 403)
    assert exported.status_code == (200 if allowed else 403)
    if allowed:
        assert workspace.json()["value"] == {"private_owner": 0}
        notes = exported.json()["tables"]["journal_daily_notes"]
        assert len(notes) == 1
        assert notes[0]["body"] == "Private journal decision before account recovery."


def test_failed_session_insert_rolls_back_binding_and_old_session_revocation(recovery):
    c = recovery
    seed_legacy(c)
    before = persisted_account(c)
    with c.factory() as db:
        # Reject the real database write, without replacing session issuance,
        # the JWT verifier or the HTTP endpoint with a mock.
        db.execute(text(f"""CREATE TRIGGER reject_recovery_session
            BEFORE INSERT ON beta_sessions WHEN NEW.user_id = {c.owners[0]}
            BEGIN SELECT RAISE(ABORT, 'session write failure fixture'); END"""))
        db.commit()
    response = recover(c)
    assert response.status_code == 409
    assert persisted_account(c) == before
    with c.factory() as db:
        assert len(db.scalars(select(models.BetaUser)).all()) == 3
