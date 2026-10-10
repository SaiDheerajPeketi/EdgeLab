"""Authoritative account access, independent of identity and market-data licences."""
from datetime import timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select, text

from app.personal_access import is_personal_identity
from app.models import BetaUser, BillingCustomer, BillingSubscription, utcnow
from app.services import billing


def deployment_mode(source_settings):
    mode = getattr(source_settings, "deployment_mode", "production")
    if mode not in {"beta", "production", "personal"}:
        raise HTTPException(status_code=503, detail="Deployment access policy is unavailable")
    return mode


def lock_enrollment(db):
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(1701047)"))
    elif db.get_bind().dialect.name == "sqlite":
        db.execute(text("UPDATE beta_users SET id = id WHERE id = -1"))
    else:
        raise HTTPException(status_code=503, detail="Account enrollment locking is unavailable")


def sync_beta(db, source_settings):
    lock_enrollment(db)
    cap = min(500, max(1, int(getattr(source_settings, "beta_seats_total", 500))))
    approved = db.scalars(select(BetaUser).where(BetaUser.status == "APPROVED").order_by(BetaUser.beta_position, BetaUser.created_at, BetaUser.id).execution_options(populate_existing=True)).all()
    for index, user in enumerate(approved, 1):
        user.beta_position = index
    waiting = db.scalars(select(BetaUser).where(BetaUser.status.in_({"WAITLISTED", "PUBLIC"})).order_by(BetaUser.created_at, BetaUser.id).execution_options(populate_existing=True)).all()
    for user in waiting[:max(0, cap - len(approved))]:
        user.status, user.beta_position = "APPROVED", len(approved) + 1
        approved.append(user)
    remaining = [user for user in waiting if user.status != "APPROVED"]
    for index, user in enumerate(remaining, 1):
        user.status, user.beta_position = "WAITLISTED", index
    db.flush()
    return {"deployment_mode": "beta", "mode": "beta", "seats_total": cap, "seats_taken": min(cap, len(approved)), "seats_remaining": max(0, cap-len(approved)), "waitlist_count": len(remaining)}


def _utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def access_snapshot(db, user_id, source_settings, *, refresh=True, paid_only=False):
    mode = deployment_mode(source_settings)
    if mode == "beta" and not paid_only:
        # Read approval only after concurrent enrollment changes are serialized.
        lock_enrollment(db)
    user = db.get(BetaUser, user_id, populate_existing=True)
    if user is None:
        raise HTTPException(status_code=401, detail="Account no longer exists")
    result = {"deployment_mode": mode, "workspace_access": False, "access_expires_at": None, "is_beta_user": mode == "beta", "plan": "none"}
    if mode == "personal":
        granted = is_personal_identity(user)
        result.update(workspace_access=granted, plan="personal" if granted else "none")
        return result
    if mode == "beta" and not paid_only:
        sync_beta(db, source_settings)
        cap = min(500, max(1, int(getattr(source_settings, "beta_seats_total", 500))))
        granted = user.status == "APPROVED" and user.beta_position is not None and 1 <= user.beta_position <= cap
        result.update(workspace_access=granted, plan="beta" if granted else "none")
        return result
    conf = billing.BillingConfig.from_settings()
    try:
        conf.require_ready()
    except billing.BillingError:
        return result
    if not conf.livemode:
        return result
    customer = db.scalar(select(BillingCustomer).where(BillingCustomer.user_id == user_id, BillingCustomer.livemode.is_(True)).execution_options(populate_existing=True))
    if customer is None:
        return result
    now = utcnow()
    if refresh and not billing._lease_fresh(customer, now):
        try:
            # Keep identity/session enrollment outside this savepoint alive if
            # the provider fails; failed reconciliation never extends the lease.
            with db.begin_nested():
                billing.refresh_workspace_access(db, user_id, conf)
                db.flush()
        except billing.BillingError:
            return result
        customer = db.get(BillingCustomer, customer.id, populate_existing=True)
    now = utcnow()
    if not billing._lease_fresh(customer, now):
        return result
    rows = db.scalars(select(BillingSubscription).where(BillingSubscription.billing_customer_id == customer.id).execution_options(populate_existing=True)).all()
    ends = [_utc(row.current_period_end) for row in rows if billing._has_access(row, now)]
    if not ends:
        return result
    expiry = min(_utc(customer.verified_at) + timedelta(seconds=billing.ACCESS_LEASE_SECONDS), max(ends))
    if expiry <= utcnow():
        return result
    result.update(workspace_access=True, access_expires_at=expiry, plan="pro")
    return result


def require_workspace_user(db, user_id, source_settings):
    access = access_snapshot(db, user_id, source_settings)
    db.commit()
    if not access["workspace_access"]:
        raise HTTPException(status_code=403, detail="Workspace access requires an active plan" if access["deployment_mode"] == "production" else "Approved beta account required")
    return access
