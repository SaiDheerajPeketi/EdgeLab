"""Billing routes authenticate identity; they do not require paid workspace access."""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from contextlib import nullcontext
from pydantic import BaseModel, ConfigDict
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from typing import Literal

from app.auth import AuthenticatedUser, require_billing_identity
from app.db import get_db
from app.services import billing

router = APIRouter(prefix="/billing", tags=["billing"])


class CheckoutRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plan: Literal["pro"]
    cadence: Literal["monthly", "annual"]


class PortalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


def get_billing_config():
    return billing.BillingConfig.from_settings()


def get_billing_provider():
    # Injection seam for provider fixtures. Services create the isolated SDK
    # adapter only when valid configuration requires a provider request.
    return None


def _http_error(exc: billing.BillingError):
    headers = {"Cache-Control": "no-store"}
    if exc.retry_after_seconds is not None:
        headers["Retry-After"] = str(exc.retry_after_seconds)
    return HTTPException(status_code=exc.status_code, detail=exc.public_message, headers=headers)


def _transaction(db: Session, action, *, owner_id: int | None = None, family: str = "status"):
    try:
        with billing.admit_billing_request(owner_id, family) if owner_id is not None else nullcontext():
            try:
                result = action()
                db.commit()
                return result
            except Exception:
                # Keep the admission slot until provider/storage failure cleanup
                # completes, including checkout's separately persisted attempt.
                db.rollback()
                raise
    except billing.BillingError as exc:
        if db.in_transaction():
            db.rollback()
        raise _http_error(exc) from None
    except SQLAlchemyError:
        if db.in_transaction():
            db.rollback()
        raise HTTPException(status_code=503, detail="Billing storage is temporarily unavailable.") from None


@router.get("/catalog")
def read_catalog(
    response: Response,
    config: billing.BillingConfig = Depends(get_billing_config),
    provider=Depends(get_billing_provider),
):
    response.headers["Cache-Control"] = "no-store"
    try:
        return billing.catalog(config, provider)
    except billing.BillingError as exc:
        raise _http_error(exc) from None


@router.get("/status")
def read_status(
    response: Response,
    db: Session = Depends(get_db),
    user: AuthenticatedUser = Depends(require_billing_identity),
    config: billing.BillingConfig = Depends(get_billing_config),
    provider=Depends(get_billing_provider),
):
    response.headers["Cache-Control"] = "no-store"
    return _transaction(db, lambda: billing.status(db, user.id, config, provider), owner_id=user.id)


@router.post("/checkout")
def checkout(
    payload: CheckoutRequest,
    response: Response,
    db: Session = Depends(get_db),
    user: AuthenticatedUser = Depends(require_billing_identity),
    config: billing.BillingConfig = Depends(get_billing_config),
    provider=Depends(get_billing_provider),
):
    response.headers["Cache-Control"] = "no-store"
    return _transaction(db, lambda: billing.create_checkout(db, user.id, payload.plan, payload.cadence, config, provider), owner_id=user.id, family="actions")


@router.post("/portal")
def portal(
    response: Response,
    payload: PortalRequest | None = None,
    db: Session = Depends(get_db),
    user: AuthenticatedUser = Depends(require_billing_identity),
    config: billing.BillingConfig = Depends(get_billing_config),
    provider=Depends(get_billing_provider),
):
    response.headers["Cache-Control"] = "no-store"
    return _transaction(db, lambda: billing.create_portal(db, user.id, config, provider), owner_id=user.id, family="actions")


@router.post("/webhook")
async def webhook(
    request: Request,
    db: Session = Depends(get_db),
    config: billing.BillingConfig = Depends(get_billing_config),
    provider=Depends(get_billing_provider),
):
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > billing.WEBHOOK_BYTES:
            raise HTTPException(status_code=413, detail="Webhook body is too large.")
        body.extend(chunk)
    return await run_in_threadpool(
        _transaction, db,
        lambda: billing.process_webhook(db, bytes(body), request.headers.get("stripe-signature"), config, provider),
    )
