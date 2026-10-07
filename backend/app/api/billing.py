"""Billing routes authenticate identity; they do not require paid workspace access."""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
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


def _transaction(db: Session, action):
    try:
        result = action()
        db.commit()
        return result
    except billing.BillingError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=exc.public_message) from None
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=503, detail="Billing storage is temporarily unavailable.") from None


@router.get("/catalog")
def read_catalog(
    response: Response,
    config: billing.BillingConfig = Depends(get_billing_config),
    provider=Depends(get_billing_provider),
):
    response.headers["Cache-Control"] = "no-store"
    return billing.catalog(config, provider)


@router.get("/status")
def read_status(
    response: Response,
    db: Session = Depends(get_db),
    user: AuthenticatedUser = Depends(require_billing_identity),
    config: billing.BillingConfig = Depends(get_billing_config),
    provider=Depends(get_billing_provider),
):
    response.headers["Cache-Control"] = "no-store"
    return _transaction(db, lambda: billing.status(db, user.id, config, provider))


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
    return _transaction(db, lambda: billing.create_checkout(db, user.id, payload.plan, payload.cadence, config, provider))


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
    return _transaction(db, lambda: billing.create_portal(db, user.id, config, provider))


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
