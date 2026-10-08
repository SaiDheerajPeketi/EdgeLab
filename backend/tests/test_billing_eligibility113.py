"""Checkout enrollment regressions: real ASGI routes/JWT/database, provider I/O only faked."""
from dataclasses import replace
from types import SimpleNamespace

import pytest
from sqlalchemy import event, select

from app import auth, models
from app.services import access_policy, billing
from test_billing_routes import context, checkout, status


@pytest.fixture(params=["live", "test"])
def eligibility(context, request, monkeypatch):
    context.config = replace(context.config, mode=request.param,
                             secret_key="sk_" + request.param + "_eligibilityfixture")
    context.source_settings = SimpleNamespace(
        deployment_mode="beta", beta_seats_total=1,
        jwt_secret="billing-route-jwt", api_token="static-api-key",
    )
    monkeypatch.setattr(auth, "settings", context.source_settings)
    monkeypatch.setattr(billing, "settings", context.source_settings)
    return context


DENIAL = "Beta workspace approval is required before purchasing Pro. Check your access in Account."


def assert_denied(response):
    assert response.status_code == 403, response.body
    assert response.json() == {"detail": DENIAL, "error": {"code": 403, "message": DENIAL}}


def access(context, owner):
    with context.factory() as db:
        result = access_policy.access_snapshot(db, context.owners[owner],
                                              context.source_settings, refresh=False)
        db.commit()
        return result


def billing_rows(context):
    with context.factory() as db:
        return [(row.user_id, row.stripe_customer_id, row.pending_nonce,
                 row.checkout_session_id) for row in db.scalars(select(models.BillingCustomer))]


@pytest.mark.parametrize("owner", [2, 1], ids=["waitlisted", "approved-outside-cap"])
def test_beta_ineligible_checkout_is_denied_before_provider_or_billing_writes(eligibility, owner):
    assert access(eligibility, owner)["workspace_access"] is False
    with eligibility.factory() as db:
        user = db.get(models.BetaUser, eligibility.owners[owner])
        assert user.status == ("WAITLISTED" if owner == 2 else "APPROVED")
        if owner == 1:
            assert user.beta_position == 2
    before = billing_rows(eligibility)
    response = checkout(eligibility, owner)
    assert_denied(response)
    assert eligibility.provider.calls == []
    assert billing_rows(eligibility) == before == []


def test_approved_in_cap_beta_identity_can_purchase(eligibility):
    assert access(eligibility, 0)["workspace_access"] is True
    response = checkout(eligibility, 0, cadence="annual")
    assert response.status_code == 200, response.body
    assert response.json()["url"].startswith("https://checkout.stripe.com/")
    creates = [call for call in eligibility.provider.calls if call[0] == "checkout"]
    assert len(creates) == 1
    assert creates[0][1]["client_reference_id"] == str(eligibility.owners[0])
    assert creates[0][1]["line_items"] == [{"price": eligibility.config.annual_price_id, "quantity": 1}]
    assert str(eligibility.owners[0]) in creates[0][2]


def test_authoritative_beta_policy_can_enroll_waitlisted_user_when_a_seat_exists(eligibility):
    eligibility.source_settings.beta_seats_total = 3
    with eligibility.factory() as db:
        assert db.get(models.BetaUser, eligibility.owners[2]).status == "WAITLISTED"
    response = checkout(eligibility, 2)
    assert response.status_code == 200, response.body
    assert access(eligibility, 2)["workspace_access"] is True
    with eligibility.factory() as db:
        user = db.get(models.BetaUser, eligibility.owners[2])
        assert (user.status, user.beta_position) == ("APPROVED", 3)


def test_verified_production_waitlisted_identity_can_purchase_without_paid_workspace_access(eligibility):
    eligibility.source_settings.deployment_mode = "production"
    with eligibility.factory() as db:
        assert db.get(models.BetaUser, eligibility.owners[2]).status == "WAITLISTED"
    response = checkout(eligibility, 2)
    assert response.status_code == 200, response.body
    assert len([call for call in eligibility.provider.calls if call[0] == "checkout"]) == 1
    assert status(eligibility, 2).json()["workspace_access"] is False
    with eligibility.factory() as db:
        assert db.get(models.BetaUser, eligibility.owners[2]).status == "WAITLISTED"


@pytest.mark.parametrize("owner", [2, 1], ids=["waitlisted", "approved-outside-cap"])
def test_ineligible_beta_accounts_keep_status_portal_and_existing_checkout_management(eligibility, owner):
    assert access(eligibility, owner)["workspace_access"] is False
    customer_id = f"cus_{eligibility.config.mode}_existing"
    session_id = f"cs_{eligibility.config.mode}_existing"
    with eligibility.factory() as db:
        db.add(models.BillingCustomer(
            user_id=eligibility.owners[owner], livemode=eligibility.config.livemode,
            stripe_customer_id=customer_id, pending_nonce="previous_nonce",
            pending_cadence="monthly", pending_price_id=eligibility.config.monthly_price_id,
            pending_since=models.utcnow(), checkout_session_id=session_id,
        ))
        db.commit()
    eligibility.provider.checkouts[session_id] = {
        "id": session_id, "customer": customer_id, "livemode": eligibility.config.livemode,
        "mode": "subscription", "status": "open",
        "url": "https://checkout.stripe.com/c/pay/" + session_id,
    }
    before = billing_rows(eligibility)
    assert status(eligibility, owner).status_code == 200
    portal = eligibility.client.post("/api/billing/portal", headers=eligibility.headers[owner], json_body={})
    assert portal.status_code == 200, portal.body
    assert portal.json() == {"url": eligibility.provider.portal_url}
    assert eligibility.provider.calls[-1] == (
        "portal", {"customer": customer_id, "return_url": eligibility.config.public_origin + "/pricing"},
    )
    calls_before = list(eligibility.provider.calls)
    assert_denied(checkout(eligibility, owner))
    assert eligibility.provider.calls == calls_before
    assert billing_rows(eligibility) == before


@pytest.mark.parametrize("change", ["approval-revoked", "seat-cap-reduced"])
@pytest.mark.parametrize("published", [False, True], ids=["new-hosted-checkout", "competing-hosted-checkout"])
def test_checkout_rechecks_eligibility_across_its_real_commit_gap(eligibility, change, published):
    owner = 0 if change == "approval-revoked" else 1
    eligibility.source_settings.beta_seats_total = 1 if owner == 0 else 2
    assert access(eligibility, owner)["workspace_access"] is True
    fired = []
    calls_at_gap = []
    session_id = f"cs_{eligibility.config.mode}_competing"

    def after_commit(db):
        if fired or not any(isinstance(row, models.BillingCustomer)
                            and row.user_id == eligibility.owners[owner]
                            and row.pending_nonce for row in db.identity_map.values()):
            return
        fired.append(True)
        calls_at_gap.extend(eligibility.provider.calls)
        # A real separate transaction changes enrollment after the service
        # persists its customer+nonce. No route/auth/access function is mocked.
        with eligibility.factory() as observer:
            if change == "approval-revoked":
                observer.get(models.BetaUser, eligibility.owners[owner]).status = "WAITLISTED"
                # The other already-approved account fills the remaining seat.
            else:
                eligibility.source_settings.beta_seats_total = 1
            row = observer.scalar(select(models.BillingCustomer).where(
                models.BillingCustomer.user_id == eligibility.owners[owner],
                models.BillingCustomer.livemode == eligibility.config.livemode,
            ))
            assert row.pending_nonce is not None
            if published:
                # Provider-state transport fixture models another already
                # admitted checkout completing during the unlocked gap.
                row.checkout_session_id = session_id
                eligibility.provider.checkouts[session_id] = {
                    "id": session_id, "customer": row.stripe_customer_id,
                    "livemode": eligibility.config.livemode, "mode": "subscription",
                    "status": "open", "url": "https://checkout.stripe.com/c/pay/" + session_id,
                }
            observer.commit()

    event.listen(eligibility.factory.class_, "after_commit", after_commit)
    try:
        response = checkout(eligibility, owner)
    finally:
        event.remove(eligibility.factory.class_, "after_commit", after_commit)
    assert fired == [True], "The race must occur at the service's actual internal commit."
    assert_denied(response)
    assert eligibility.provider.calls == calls_at_gap, "No provider reconciliation or hosted-session reuse after revocation."
    assert not any(call[0] in {"checkout", "retrieve_checkout", "expire_checkout"} for call in eligibility.provider.calls)
    assert access(eligibility, owner)["workspace_access"] is False
    rows = billing_rows(eligibility)
    assert len(rows) == 1 and rows[0][2] is not None
    assert rows[0][3] == (session_id if published else None)


@pytest.mark.parametrize("phase", [1, 2], ids=["before-initial-enrollment-lock", "before-post-commit-enrollment-lock"])
def test_revocation_before_enrollment_acquisition_cannot_use_a_stale_positioned_identity(
        eligibility, monkeypatch, phase):
    assert access(eligibility, 0)["workspace_access"] is True
    with eligibility.factory() as db:
        owner = db.get(models.BetaUser, eligibility.owners[0])
        assert (owner.status, owner.beta_position) == ("APPROVED", 1)
    original_lock = access_policy.lock_enrollment
    acquired_transactions = set()
    acquisitions = []
    revoked = []
    calls_before_revocation = []

    def revoke_before_lock(db):
        # Count the first acquisition in each real transaction; sync_beta's
        # reentrant lock is not another unlocked concurrency gap.
        if db.get_transaction() not in acquired_transactions:
            acquisitions.append(len(acquisitions) + 1)
            if len(acquisitions) == phase:
                calls_before_revocation.extend(eligibility.provider.calls)
                with eligibility.factory() as other:
                    row = other.get(models.BetaUser, eligibility.owners[0])
                    assert (row.status, row.beta_position) == ("APPROVED", 1)
                    row.status, row.beta_position = "REVOKED", None
                    other.commit()
                revoked.append(True)
        result = original_lock(db)
        acquired_transactions.add(db.get_transaction())
        return result

    with monkeypatch.context() as race:
        # Instrument the lock boundary, then delegate to the actual lock.
        # Auth, policy decisions, ORM reads and provider transport remain real.
        race.setattr(access_policy, "lock_enrollment", revoke_before_lock)
        response = checkout(eligibility, 0)
    assert revoked == [True]
    assert_denied(response)
    assert eligibility.provider.calls == calls_before_revocation
    assert not any(call[0] in {"checkout", "retrieve_checkout", "expire_checkout"}
                   for call in eligibility.provider.calls)
    rows = billing_rows(eligibility)
    if phase == 1:
        assert eligibility.provider.calls == []
        assert rows == []
    else:
        assert len(rows) == 1 and rows[0][2] is not None and rows[0][3] is None
    assert access(eligibility, 0)["workspace_access"] is False
    with eligibility.factory() as db:
        owner = db.get(models.BetaUser, eligibility.owners[0])
        assert (owner.status, owner.beta_position) == ("REVOKED", None)
