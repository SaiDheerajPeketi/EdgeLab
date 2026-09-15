from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_EVEN
from hashlib import sha256
import json
import os
import socket
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    BrokerAccount,
    BrokerAuditLog,
    BrokerConnection,
    BrokerFill,
    BrokerOrder,
    BrokerPositionSnapshot,
    BrokerSyncCursor,
    BrokerSyncJob,
    utcnow,
)
from app.schemas import (
    BrokerAccountRead,
    BrokerAuditRead,
    BrokerCapabilityRead,
    BrokerConnectionCreate,
    BrokerConnectionRead,
    BrokerFillRead,
    BrokerOrderRead,
    BrokerPositionRead,
    BrokerProviderRead,
    BrokerSyncJobRead,
)
from app.services import integration_secrets


DECIMAL_QUANTUM = Decimal("0.0000000001")
SYNC_STREAM = "broker"
SYNC_SCOPE = "*"
BASE_RETRY_SECONDS = 5


class BrokerServiceError(Exception):
    status_code = 500
    public_message = "Broker operation failed"
    code = "broker_error"
    retryable = False

    def __init__(self, public_message: str | None = None) -> None:
        super().__init__(public_message or self.public_message)
        self.public_message = public_message or self.public_message


class BrokerNotFoundError(BrokerServiceError):
    status_code = 404
    public_message = "Broker resource not found"
    code = "not_found"


class BrokerConflictError(BrokerServiceError):
    status_code = 409
    public_message = "Broker connection or sync is already active"
    code = "conflict"


class BrokerProviderUnavailableError(BrokerServiceError):
    status_code = 422
    public_message = "This broker provider is not available for connections"
    code = "provider_unavailable"


class BrokerAuthenticationError(BrokerServiceError):
    status_code = 401
    public_message = "Broker credentials were rejected"
    code = "authentication_failed"


class BrokerDataError(BrokerServiceError):
    status_code = 422
    public_message = "Broker returned inconsistent normalized data"
    code = "invalid_provider_data"


class BrokerTransientError(BrokerServiceError):
    status_code = 503
    public_message = "Broker is temporarily unavailable"
    code = "provider_unavailable"
    retryable = True


@dataclass(frozen=True)
class AccountRecord:
    external_account_id: str
    display_name: str
    currency: str = "USD"
    status: str = "ACTIVE"


@dataclass(frozen=True)
class OrderRecord:
    external_order_id: str
    external_account_id: str
    symbol: str
    side: str
    order_type: str
    status: str
    quantity: Decimal
    filled_quantity: Decimal
    average_fill_price: Decimal | None
    commission_total: Decimal
    fees_total: Decimal
    placed_at: datetime
    provider_updated_at: datetime
    source_revision: int = 1
    cancelled_at: datetime | None = None


@dataclass(frozen=True)
class FillRecord:
    external_fill_id: str
    external_order_id: str
    external_account_id: str
    symbol: str
    side: str
    quantity: Decimal
    price: Decimal
    commission: Decimal
    fees: Decimal
    executed_at: datetime
    provider_updated_at: datetime
    source_revision: int = 1
    cancelled: bool = False


@dataclass(frozen=True)
class SyncBatch:
    accounts: tuple[AccountRecord, ...] = ()
    orders: tuple[OrderRecord, ...] = ()
    fills: tuple[FillRecord, ...] = ()
    next_cursor: str | None = None
    high_watermark: datetime | None = None


class BrokerAdapter(Protocol):
    provider_id: str

    def fetch_incremental(
        self,
        credentials: Mapping[str, str],
        cursor: str | None,
    ) -> SyncBatch: ...


class BrokerHttpTransport(Protocol):
    def get_json(
        self, url: str, *, headers: Mapping[str, str], query: Mapping[str, str] | None = None
    ) -> Any: ...


class UrllibBrokerTransport:
    """Small, dependency-free provider client with bounded I/O and no secret logging."""

    def __init__(self, timeout_seconds: float = 15.0) -> None:
        self.timeout_seconds = timeout_seconds

    def get_json(
        self, url: str, *, headers: Mapping[str, str], query: Mapping[str, str] | None = None
    ) -> Any:
        target = f"{url}?{urlencode(query)}" if query else url
        request = Request(target, headers=dict(headers), method="GET")
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:  # noqa: S310 - URLs are server configured
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            if exc.code in {401, 403}:
                raise BrokerAuthenticationError() from exc
            if exc.code == 429 or exc.code >= 500:
                raise BrokerTransientError(f"Broker request failed with status {exc.code}") from exc
            raise BrokerDataError(f"Broker request failed with status {exc.code}") from exc
        except (URLError, TimeoutError, socket.timeout) as exc:
            raise BrokerTransientError("Broker endpoint could not be reached") from exc
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise BrokerDataError("Broker returned an invalid JSON response") from exc


class JsonRestBrokerAdapter:
    """Normalizes account/order/fill payloads from supported broker REST APIs."""

    provider_id = ""
    token_key = "access_token"
    default_base_url: str | None = None
    environment_base_url = ""
    account_path = "/accounts"
    order_path = "/orders"
    fill_path = "/fills"

    def __init__(self, transport: BrokerHttpTransport | None = None, *, base_url: str | None = None) -> None:
        self.transport = transport or UrllibBrokerTransport()
        self.base_url = (base_url or os.getenv(self.environment_base_url) or self.default_base_url or "").rstrip("/")

    def fetch_incremental(self, credentials: Mapping[str, str], cursor: str | None) -> SyncBatch:
        token = credentials.get(self.token_key) or credentials.get("access_token") or credentials.get("api_key")
        if not token:
            raise BrokerAuthenticationError(f"{self.provider_id} credential is missing {self.token_key}")
        if not self.base_url.startswith("https://"):
            raise BrokerProviderUnavailableError(
                f"{self.provider_id} endpoint is not configured with an HTTPS URL"
            )
        headers = self.auth_headers(token)
        query = {"cursor": cursor} if cursor else None
        accounts_payload = self.transport.get_json(f"{self.base_url}{self.account_path}", headers=headers)
        orders_payload = self.transport.get_json(f"{self.base_url}{self.order_path}", headers=headers, query=query)
        fills_payload = self.transport.get_json(f"{self.base_url}{self.fill_path}", headers=headers, query=query)
        accounts = tuple(self.parse_account(item) for item in payload_rows(accounts_payload))
        orders = tuple(self.parse_order(item) for item in payload_rows(orders_payload))
        fills = tuple(self.parse_fill(item) for item in payload_rows(fills_payload))
        next_cursor = payload_cursor(fills_payload) or payload_cursor(orders_payload) or cursor
        watermark = max(
            (record.provider_updated_at for record in (*orders, *fills)),
            default=None,
        )
        return SyncBatch(accounts=accounts, orders=orders, fills=fills, next_cursor=next_cursor, high_watermark=watermark)

    def auth_headers(self, token: str) -> dict[str, str]:
        return {"Accept": "application/json", "Authorization": f"Bearer {token}"}

    def parse_account(self, item: Mapping[str, Any]) -> AccountRecord:
        account_id = required_text(item, "id", "accountId", "account_id", "name")
        return AccountRecord(
            external_account_id=account_id,
            display_name=text_value(item, "displayName", "name", "accountName") or account_id,
            currency=(text_value(item, "currency", "currencyCode") or "USD").upper(),
            status=(text_value(item, "status", "activeStatus") or "ACTIVE").upper(),
        )

    def parse_order(self, item: Mapping[str, Any]) -> OrderRecord:
        quantity = decimal_field(item, "quantity", "qty", "orderQty")
        filled = decimal_field(item, "filledQuantity", "filledQty", "cumQty", default="0")
        status = (text_value(item, "status", "ordStatus") or "UNKNOWN").upper()
        return OrderRecord(
            external_order_id=required_text(item, "id", "orderId", "order_id"),
            external_account_id=required_text(item, "accountId", "account_id", "account"),
            symbol=required_text(item, "symbol", "contract", "instrument"),
            side=normalize_side(required_text(item, "side", "action", "orderAction")),
            order_type=(text_value(item, "orderType", "type", "ordType") or "UNKNOWN").upper(),
            status=status,
            quantity=quantity,
            filled_quantity=filled,
            average_fill_price=optional_decimal_field(item, "averageFillPrice", "avgPrice", "avgFillPrice"),
            commission_total=decimal_field(item, "commission", "commissionTotal", default="0"),
            fees_total=decimal_field(item, "fees", "feeTotal", default="0"),
            placed_at=datetime_field(item, "placedAt", "createdAt", "timestamp", "orderTimestamp"),
            provider_updated_at=datetime_field(item, "updatedAt", "modifiedAt", "timestamp", "orderTimestamp"),
            source_revision=integer_field(item, "revision", "version", "updateSequence", default=1),
            cancelled_at=(datetime_field(item, "cancelledAt", "canceledAt") if text_value(item, "cancelledAt", "canceledAt") else None),
        )

    def parse_fill(self, item: Mapping[str, Any]) -> FillRecord:
        executed_at = datetime_field(item, "executedAt", "timestamp", "fillTime", "tradeTime")
        return FillRecord(
            external_fill_id=required_text(item, "id", "fillId", "executionId", "execId"),
            external_order_id=required_text(item, "orderId", "order_id"),
            external_account_id=required_text(item, "accountId", "account_id", "account"),
            symbol=required_text(item, "symbol", "contract", "instrument"),
            side=normalize_side(required_text(item, "side", "action", "orderAction")),
            quantity=decimal_field(item, "quantity", "qty", "fillQty"),
            price=decimal_field(item, "price", "fillPrice"),
            commission=decimal_field(item, "commission", default="0"),
            fees=decimal_field(item, "fees", "fee", default="0"),
            executed_at=executed_at,
            provider_updated_at=(datetime_field(item, "updatedAt", "modifiedAt") if text_value(item, "updatedAt", "modifiedAt") else executed_at),
            source_revision=integer_field(item, "revision", "version", "updateSequence", default=1),
            cancelled=bool(item.get("cancelled", False)),
        )


class TradovateBrokerAdapter(JsonRestBrokerAdapter):
    provider_id = "tradovate"
    token_key = "access_token"
    default_base_url = "https://live.tradovateapi.com/v1"
    environment_base_url = "EDGELAB_TRADOVATE_API_BASE_URL"
    account_path = "/account/list"
    order_path = "/order/list"
    fill_path = "/fill/list"


class NinjaTraderBrokerAdapter(JsonRestBrokerAdapter):
    provider_id = "ninjatrader"
    token_key = "api_key"
    environment_base_url = "EDGELAB_NINJATRADER_API_BASE_URL"

    def auth_headers(self, token: str) -> dict[str, str]:
        return {"Accept": "application/json", "X-API-Key": token}


@dataclass(frozen=True)
class ProviderDefinition:
    provider_id: str
    display_name: str
    availability: str
    capabilities: BrokerCapabilityRead
    requires_secret: bool
    description: str


PROVIDERS: tuple[ProviderDefinition, ...] = (
    ProviderDefinition(
        provider_id="offline-fixture",
        display_name="Offline deterministic fixture",
        availability="offline-fixture",
        capabilities=BrokerCapabilityRead(
            accounts=True,
            incremental_sync=True,
            orders=True,
            fills=True,
            live_connectivity=False,
        ),
        requires_secret=True,
        description="Local deterministic data for development and contract testing; no live broker connection.",
    ),
    ProviderDefinition(
        provider_id="tradovate",
        display_name="Tradovate",
        availability="available",
        capabilities=BrokerCapabilityRead(
            accounts=True, incremental_sync=True, orders=True, fills=True, live_connectivity=True
        ),
        requires_secret=True,
        description="Direct incremental REST sync. Requires a Tradovate access token stored in the EdgeLab vault.",
    ),
    ProviderDefinition(
        provider_id="ninjatrader",
        display_name="NinjaTrader",
        availability="available" if os.getenv("EDGELAB_NINJATRADER_API_BASE_URL", "").startswith("https://") else "unconfigured",
        capabilities=BrokerCapabilityRead(
            accounts=True, incremental_sync=True, orders=True, fills=True, live_connectivity=True
        ),
        requires_secret=True,
        description="Direct incremental sync through the configured NinjaTrader HTTPS API endpoint. The server endpoint must be configured before connecting.",
    ),
)


class FixtureBrokerAdapter:
    provider_id = "offline-fixture"

    def __init__(
        self,
        batches: Sequence[SyncBatch] | None = None,
        *,
        transient_failures: int = 0,
    ) -> None:
        self.batches = tuple(batches or default_fixture_batches())
        self.transient_failures = transient_failures
        self.calls = 0

    def fetch_incremental(
        self,
        credentials: Mapping[str, str],
        cursor: str | None,
    ) -> SyncBatch:
        self.calls += 1
        if not credentials.get("fixture_token"):
            raise BrokerAuthenticationError()
        if self.calls <= self.transient_failures:
            raise BrokerTransientError()
        try:
            index = int(cursor or "0")
        except ValueError as exc:
            raise BrokerDataError("Stored broker cursor is invalid") from exc
        if index < 0:
            raise BrokerDataError("Stored broker cursor is invalid")
        if index >= len(self.batches):
            return SyncBatch(next_cursor=str(index))
        batch = self.batches[index]
        return SyncBatch(
            accounts=batch.accounts,
            orders=batch.orders,
            fills=batch.fills,
            next_cursor=batch.next_cursor or str(index + 1),
            high_watermark=batch.high_watermark,
        )


ADAPTERS: dict[str, BrokerAdapter] = {}


def list_provider_catalog() -> list[BrokerProviderRead]:
    return [
        BrokerProviderRead(
            provider_id=provider.provider_id,
            display_name=provider.display_name,
            availability=provider.availability,
            capabilities=provider.capabilities,
            requires_secret=provider.requires_secret,
            description=provider.description,
        )
        for provider in PROVIDERS
    ]


def create_connection(
    db: Session,
    user_id: int,
    payload: BrokerConnectionCreate,
) -> BrokerConnectionRead:
    provider = provider_definition(payload.provider)
    if provider.availability not in {"offline-fixture", "available"} or payload.provider not in ADAPTERS:
        raise BrokerProviderUnavailableError()
    secret = integration_secrets.get_integration_secret(db, user_id, payload.secret_id)
    if secret.state != "active":
        raise BrokerServiceError("The selected integration credential is revoked")
    if secret.provider != payload.provider or secret.purpose != "broker-sync":
        raise BrokerDataError(
            "The selected credential must match the provider and broker-sync purpose"
        )
    existing = db.scalar(
        select(BrokerConnection.id).where(
            BrokerConnection.user_id == user_id,
            BrokerConnection.provider == payload.provider,
            BrokerConnection.display_name == payload.display_name,
        )
    )
    if existing is not None:
        raise BrokerConflictError("A connection with this provider and name already exists")
    row = BrokerConnection(
        user_id=user_id,
        provider=payload.provider,
        display_name=payload.display_name,
        secret_id=payload.secret_id,
        status="READY",
        health="UNKNOWN",
    )
    db.add(row)
    try:
        db.flush()
        add_audit(
            db,
            row,
            action="connection.create",
            outcome="SUCCEEDED",
            details={"availability": provider.availability},
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise BrokerConflictError("A connection with this provider and name already exists") from exc
    db.refresh(row)
    return connection_read(row)


def list_connections(db: Session, user_id: int) -> list[BrokerConnectionRead]:
    rows = db.scalars(
        select(BrokerConnection)
        .where(BrokerConnection.user_id == user_id)
        .order_by(BrokerConnection.updated_at.desc(), BrokerConnection.id.desc())
    ).all()
    return [connection_read(row) for row in rows]


def get_connection(db: Session, user_id: int, connection_id: int) -> BrokerConnectionRead:
    return connection_read(owned_connection(db, user_id, connection_id))


def revoke_connection(db: Session, user_id: int, connection_id: int) -> BrokerConnectionRead:
    row = owned_connection(db, user_id, connection_id, for_update=True)
    if row.revoked_at is None:
        now = utcnow()
        row.revoked_at = now
        row.updated_at = now
        row.status = "REVOKED"
        row.health = "ERROR"
        row.last_error_code = "connection_revoked"
        row.last_error_message = "Connection was revoked by its owner"
        add_audit(db, row, action="connection.revoke", outcome="SUCCEEDED")
        db.commit()
        db.refresh(row)
    return connection_read(row)


def refresh_connection(
    db: Session,
    user_id: int,
    connection_id: int,
    *,
    max_attempts: int = 3,
    adapter: BrokerAdapter | None = None,
) -> BrokerSyncJobRead:
    connection = owned_connection(db, user_id, connection_id, for_update=True)
    ensure_connection_active(connection)
    pending = db.scalar(
        select(BrokerSyncJob.id).where(
            BrokerSyncJob.user_id == user_id,
            BrokerSyncJob.connection_id == connection_id,
            BrokerSyncJob.status.in_(("QUEUED", "RUNNING", "RETRYING")),
        )
    )
    if pending is not None:
        raise BrokerConflictError("This connection already has an unfinished sync job")
    cursor = sync_cursor(db, connection, create=False)
    job = BrokerSyncJob(
        user_id=user_id,
        connection_id=connection.id,
        status="QUEUED",
        attempt=0,
        max_attempts=max_attempts,
        cursor_before=cursor.cursor if cursor else None,
        stats={},
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return run_sync_job(db, user_id, job.id, adapter=adapter, force=True)


def retry_sync_job(
    db: Session,
    user_id: int,
    job_id: int,
    *,
    adapter: BrokerAdapter | None = None,
    force: bool = False,
) -> BrokerSyncJobRead:
    return run_sync_job(db, user_id, job_id, adapter=adapter, force=force)


def run_sync_job(
    db: Session,
    user_id: int,
    job_id: int,
    *,
    adapter: BrokerAdapter | None = None,
    force: bool = False,
) -> BrokerSyncJobRead:
    job = owned_job(db, user_id, job_id, for_update=True)
    if job.status not in {"QUEUED", "RETRYING"}:
        raise BrokerConflictError("Only queued or retrying sync jobs can run")
    now = utcnow()
    if job.next_retry_at is not None and normalize_datetime(job.next_retry_at) > now and not force:
        raise BrokerConflictError("Sync retry is not due yet")
    connection = owned_connection(db, user_id, job.connection_id, for_update=True)
    ensure_connection_active(connection)
    selected_adapter = adapter or ADAPTERS.get(connection.provider)
    if selected_adapter is None:
        raise BrokerProviderUnavailableError()
    job.status = "RUNNING"
    job.attempt += 1
    job.started_at = now
    job.finished_at = None
    job.next_retry_at = None
    job.error_code = None
    job.error_message = None
    job.updated_at = now
    connection.status = "SYNCING"
    connection.last_sync_started_at = now
    connection.updated_at = now
    db.commit()

    try:
        batch = integration_secrets.use_integration_credentials(
            db,
            user_id,
            connection.secret_id,
            lambda provider, purpose, credentials: fetch_batch(
                selected_adapter,
                connection,
                provider,
                purpose,
                credentials,
                job.cursor_before,
            ),
        )
        stats = apply_sync_batch(db, connection, batch)
        cursor = sync_cursor(db, connection, create=True)
        cursor.cursor = batch.next_cursor
        cursor.high_watermark = batch.high_watermark
        cursor.updated_at = utcnow()
        finished_at = utcnow()
        job.status = "SUCCEEDED"
        job.cursor_after = batch.next_cursor
        job.stats = stats
        job.finished_at = finished_at
        job.updated_at = finished_at
        connection.status = "HEALTHY"
        connection.health = "HEALTHY"
        connection.last_error_code = None
        connection.last_error_message = None
        connection.last_sync_completed_at = finished_at
        connection.next_retry_at = None
        connection.updated_at = finished_at
        add_audit(
            db,
            connection,
            job=job,
            action="sync.incremental",
            outcome="SUCCEEDED",
            details=stats,
        )
        db.commit()
        db.refresh(job)
        return job_read(job)
    except Exception as exc:
        db.rollback()
        return record_sync_failure(db, user_id, job_id, exc)


def list_accounts(
    db: Session,
    user_id: int,
    connection_id: int,
) -> list[BrokerAccountRead]:
    owned_connection(db, user_id, connection_id)
    rows = db.scalars(
        select(BrokerAccount)
        .where(
            BrokerAccount.user_id == user_id,
            BrokerAccount.connection_id == connection_id,
        )
        .order_by(BrokerAccount.display_name.asc(), BrokerAccount.id.asc())
    ).all()
    return [account_read(row) for row in rows]


def list_orders(
    db: Session,
    user_id: int,
    connection_id: int,
    *,
    limit: int = 100,
) -> list[BrokerOrderRead]:
    owned_connection(db, user_id, connection_id)
    rows = db.scalars(
        select(BrokerOrder)
        .where(BrokerOrder.user_id == user_id, BrokerOrder.connection_id == connection_id)
        .order_by(BrokerOrder.provider_updated_at.desc(), BrokerOrder.id.desc())
        .limit(limit)
    ).all()
    return [order_read(row) for row in rows]


def list_fills(
    db: Session,
    user_id: int,
    connection_id: int,
    *,
    limit: int = 100,
) -> list[BrokerFillRead]:
    owned_connection(db, user_id, connection_id)
    rows = db.scalars(
        select(BrokerFill)
        .where(BrokerFill.user_id == user_id, BrokerFill.connection_id == connection_id)
        .order_by(BrokerFill.executed_at.desc(), BrokerFill.external_fill_id.desc())
        .limit(limit)
    ).all()
    return [fill_read(row) for row in rows]


def list_positions(
    db: Session,
    user_id: int,
    connection_id: int,
) -> list[BrokerPositionRead]:
    owned_connection(db, user_id, connection_id)
    rows = db.scalars(
        select(BrokerPositionSnapshot)
        .where(
            BrokerPositionSnapshot.user_id == user_id,
            BrokerPositionSnapshot.connection_id == connection_id,
        )
        .order_by(BrokerPositionSnapshot.account_id.asc(), BrokerPositionSnapshot.symbol.asc())
    ).all()
    return [position_read(row) for row in rows]


def list_sync_jobs(
    db: Session,
    user_id: int,
    connection_id: int,
    *,
    limit: int = 100,
) -> list[BrokerSyncJobRead]:
    owned_connection(db, user_id, connection_id)
    rows = db.scalars(
        select(BrokerSyncJob)
        .where(BrokerSyncJob.user_id == user_id, BrokerSyncJob.connection_id == connection_id)
        .order_by(BrokerSyncJob.created_at.desc(), BrokerSyncJob.id.desc())
        .limit(limit)
    ).all()
    return [job_read(row) for row in rows]


def list_audit_logs(
    db: Session,
    user_id: int,
    connection_id: int,
    *,
    limit: int = 100,
) -> list[BrokerAuditRead]:
    owned_connection(db, user_id, connection_id)
    rows = db.scalars(
        select(BrokerAuditLog)
        .where(
            BrokerAuditLog.user_id == user_id,
            BrokerAuditLog.connection_id == connection_id,
        )
        .order_by(BrokerAuditLog.created_at.desc(), BrokerAuditLog.id.desc())
        .limit(limit)
    ).all()
    return [audit_read(row) for row in rows]


def fetch_batch(
    adapter: BrokerAdapter,
    connection: BrokerConnection,
    secret_provider: str,
    secret_purpose: str,
    credentials: Mapping[str, str],
    cursor: str | None,
) -> SyncBatch:
    if adapter.provider_id != connection.provider:
        raise BrokerDataError("Adapter does not match the connection provider")
    if secret_provider != connection.provider or secret_purpose != "broker-sync":
        raise BrokerAuthenticationError()
    return adapter.fetch_incremental(credentials, cursor)


def apply_sync_batch(
    db: Session,
    connection: BrokerConnection,
    batch: SyncBatch,
) -> dict[str, int]:
    accounts: dict[str, BrokerAccount] = {}
    for record in batch.accounts:
        validate_account_record(record)
        row = db.scalar(
            select(BrokerAccount).where(
                BrokerAccount.connection_id == connection.id,
                BrokerAccount.external_account_id == record.external_account_id,
            )
        )
        if row is None:
            row = BrokerAccount(
                user_id=connection.user_id,
                connection_id=connection.id,
                external_account_id=record.external_account_id,
                display_name=record.display_name,
                currency=record.currency,
                status=record.status,
            )
            db.add(row)
            db.flush()
        else:
            row.display_name = record.display_name
            row.currency = record.currency
            row.status = record.status
            row.updated_at = utcnow()
        accounts[record.external_account_id] = row

    existing_accounts = db.scalars(
        select(BrokerAccount).where(BrokerAccount.connection_id == connection.id)
    ).all()
    accounts.update({row.external_account_id: row for row in existing_accounts})

    orders_upserted = 0
    for record in batch.orders:
        validate_order_record(record)
        account = accounts.get(record.external_account_id)
        if account is None:
            raise BrokerDataError("Order references an unknown broker account")
        if upsert_order(db, connection, account, record):
            orders_upserted += 1
    db.flush()

    orders = {
        row.external_order_id: row
        for row in db.scalars(
            select(BrokerOrder).where(BrokerOrder.connection_id == connection.id)
        ).all()
    }
    fills_upserted = 0
    for record in batch.fills:
        validate_fill_record(record)
        account = accounts.get(record.external_account_id)
        if account is None:
            raise BrokerDataError("Fill references an unknown broker account")
        if upsert_fill(db, connection, account, orders.get(record.external_order_id), record):
            fills_upserted += 1
    db.flush()
    position_count = reconcile_positions(db, connection)
    return {
        "accounts": len(batch.accounts),
        "fills_received": len(batch.fills),
        "fills_upserted": fills_upserted,
        "orders_received": len(batch.orders),
        "orders_upserted": orders_upserted,
        "positions": position_count,
    }


def upsert_order(
    db: Session,
    connection: BrokerConnection,
    account: BrokerAccount,
    record: OrderRecord,
) -> bool:
    row = db.scalar(
        select(BrokerOrder).where(
            BrokerOrder.connection_id == connection.id,
            BrokerOrder.external_order_id == record.external_order_id,
        )
    )
    values = order_values(record)
    if row is not None:
        if record.source_revision < row.source_revision:
            return False
        if record.source_revision == row.source_revision:
            if order_matches(row, account.id, values):
                return False
            raise BrokerDataError("Order revision conflicts with previously synced data")
    if row is None:
        row = BrokerOrder(
            user_id=connection.user_id,
            connection_id=connection.id,
            account_id=account.id,
            external_order_id=record.external_order_id,
            **values,
        )
        db.add(row)
    else:
        row.account_id = account.id
        for field, value in values.items():
            setattr(row, field, value)
        row.updated_at = utcnow()
    return True


def upsert_fill(
    db: Session,
    connection: BrokerConnection,
    account: BrokerAccount,
    order: BrokerOrder | None,
    record: FillRecord,
) -> bool:
    fingerprint = fill_fingerprint(record)
    row = db.scalar(
        select(BrokerFill).where(
            BrokerFill.connection_id == connection.id,
            BrokerFill.external_fill_id == record.external_fill_id,
        )
    )
    if row is not None:
        if record.source_revision < row.source_revision:
            return False
        if record.source_revision == row.source_revision:
            if row.fingerprint == fingerprint:
                return False
            raise BrokerDataError("Fill revision conflicts with previously synced data")
    values = fill_values(record)
    if row is None:
        row = BrokerFill(
            user_id=connection.user_id,
            connection_id=connection.id,
            account_id=account.id,
            order_id=order.id if order else None,
            external_fill_id=record.external_fill_id,
            fingerprint=fingerprint,
            **values,
        )
        db.add(row)
    else:
        row.account_id = account.id
        row.order_id = order.id if order else None
        row.fingerprint = fingerprint
        for field, value in values.items():
            setattr(row, field, value)
        row.updated_at = utcnow()
    return True


@dataclass
class PositionState:
    signed_quantity: Decimal = Decimal("0")
    average_entry_price: Decimal | None = None
    open_costs: Decimal = Decimal("0")
    realized_gross_pnl: Decimal = Decimal("0")
    realized_costs: Decimal = Decimal("0")
    fill_count: int = 0
    last_fill_at: datetime | None = None

    def apply(self, fill: BrokerFill) -> None:
        quantity = decimal_value(fill.quantity)
        price = decimal_value(fill.price)
        cost = decimal_value(fill.commission) + decimal_value(fill.fees)
        signed_fill = quantity if fill.side == "BUY" else -quantity
        self.fill_count += 1
        self.last_fill_at = fill.executed_at

        if self.signed_quantity == 0 or same_sign(self.signed_quantity, signed_fill):
            previous_quantity = abs(self.signed_quantity)
            next_quantity = previous_quantity + quantity
            previous_notional = (self.average_entry_price or Decimal("0")) * previous_quantity
            self.average_entry_price = quantize((previous_notional + price * quantity) / next_quantity)
            self.signed_quantity += signed_fill
            self.open_costs += cost
            return

        previous_quantity = abs(self.signed_quantity)
        closing_quantity = min(previous_quantity, quantity)
        direction = Decimal("1") if self.signed_quantity > 0 else Decimal("-1")
        self.realized_gross_pnl += (
            price - (self.average_entry_price or Decimal("0"))
        ) * closing_quantity * direction
        opening_cost = self.open_costs * closing_quantity / previous_quantity
        closing_cost = cost * closing_quantity / quantity
        self.realized_costs += opening_cost + closing_cost

        if quantity < previous_quantity:
            self.signed_quantity += signed_fill
            self.open_costs -= opening_cost
        elif quantity == previous_quantity:
            self.signed_quantity = Decimal("0")
            self.average_entry_price = None
            self.open_costs = Decimal("0")
        else:
            remainder = quantity - previous_quantity
            self.signed_quantity = remainder if signed_fill > 0 else -remainder
            self.average_entry_price = price
            self.open_costs = cost - closing_cost

        self.signed_quantity = quantize(self.signed_quantity)
        self.open_costs = quantize(self.open_costs)
        self.realized_gross_pnl = quantize(self.realized_gross_pnl)
        self.realized_costs = quantize(self.realized_costs)


def reconcile_positions(db: Session, connection: BrokerConnection) -> int:
    fills = db.scalars(
        select(BrokerFill)
        .where(
            BrokerFill.user_id == connection.user_id,
            BrokerFill.connection_id == connection.id,
            BrokerFill.cancelled.is_(False),
        )
        .order_by(BrokerFill.executed_at.asc(), BrokerFill.external_fill_id.asc())
    ).all()
    grouped: dict[tuple[int, str], list[BrokerFill]] = defaultdict(list)
    for fill in fills:
        grouped[(fill.account_id, fill.symbol)].append(fill)

    existing = {
        (row.account_id, row.symbol): row
        for row in db.scalars(
            select(BrokerPositionSnapshot).where(
                BrokerPositionSnapshot.connection_id == connection.id
            )
        ).all()
    }
    for key, position_fills in grouped.items():
        state = PositionState()
        for fill in position_fills:
            state.apply(fill)
        row = existing.pop(key, None)
        if row is None:
            row = BrokerPositionSnapshot(
                user_id=connection.user_id,
                connection_id=connection.id,
                account_id=key[0],
                symbol=key[1],
                signed_quantity=Decimal("0"),
                average_entry_price=None,
                open_costs=Decimal("0"),
                realized_gross_pnl=Decimal("0"),
                realized_costs=Decimal("0"),
                realized_net_pnl=Decimal("0"),
                fill_count=0,
                reconciliation_hash="",
            )
            db.add(row)
        row.signed_quantity = quantize(state.signed_quantity)
        row.average_entry_price = (
            quantize(state.average_entry_price) if state.average_entry_price is not None else None
        )
        row.open_costs = quantize(state.open_costs)
        row.realized_gross_pnl = quantize(state.realized_gross_pnl)
        row.realized_costs = quantize(state.realized_costs)
        row.realized_net_pnl = quantize(
            state.realized_gross_pnl - state.realized_costs
        )
        row.fill_count = state.fill_count
        row.last_fill_at = state.last_fill_at
        row.reconciliation_hash = reconciliation_hash(position_fills)
        row.updated_at = utcnow()
    for stale in existing.values():
        db.delete(stale)
    db.flush()
    return len(grouped)


def record_sync_failure(
    db: Session,
    user_id: int,
    job_id: int,
    exc: Exception,
) -> BrokerSyncJobRead:
    job = owned_job(db, user_id, job_id, for_update=True)
    connection = owned_connection(db, user_id, job.connection_id, for_update=True)
    code, message, retryable = public_sync_error(exc)
    now = utcnow()
    will_retry = retryable and job.attempt < job.max_attempts
    next_retry = (
        now + timedelta(seconds=BASE_RETRY_SECONDS * (2 ** max(job.attempt - 1, 0)))
        if will_retry
        else None
    )
    job.status = "RETRYING" if will_retry else "DEAD_LETTER"
    job.error_code = code
    job.error_message = message
    job.finished_at = now
    job.next_retry_at = next_retry
    job.updated_at = now
    connection.status = "DEGRADED" if will_retry else "ERROR"
    connection.health = "DEGRADED" if will_retry else "ERROR"
    connection.last_error_code = code
    connection.last_error_message = message
    connection.next_retry_at = next_retry
    connection.updated_at = now
    add_audit(
        db,
        connection,
        job=job,
        action="sync.incremental",
        outcome=job.status,
        details={"attempt": job.attempt, "retryable": retryable},
    )
    db.commit()
    db.refresh(job)
    return job_read(job)


def public_sync_error(exc: Exception) -> tuple[str, str, bool]:
    if isinstance(exc, BrokerServiceError):
        return exc.code, exc.public_message, exc.retryable
    if isinstance(exc, integration_secrets.VaultRevokedError):
        return "secret_revoked", "Integration credential has been revoked", False
    if isinstance(exc, integration_secrets.VaultConfigurationError):
        return "secret_unavailable", "Integration credential vault is unavailable", False
    if isinstance(exc, integration_secrets.VaultIntegrityError):
        return "secret_integrity", "Integration credential failed integrity verification", False
    return "sync_internal_error", "Broker sync failed", True


def sync_cursor(
    db: Session,
    connection: BrokerConnection,
    *,
    create: bool,
) -> BrokerSyncCursor | None:
    row = db.scalar(
        select(BrokerSyncCursor).where(
            BrokerSyncCursor.user_id == connection.user_id,
            BrokerSyncCursor.connection_id == connection.id,
            BrokerSyncCursor.stream == SYNC_STREAM,
            BrokerSyncCursor.scope_key == SYNC_SCOPE,
        )
    )
    if row is None and create:
        row = BrokerSyncCursor(
            user_id=connection.user_id,
            connection_id=connection.id,
            stream=SYNC_STREAM,
            scope_key=SYNC_SCOPE,
        )
        db.add(row)
        db.flush()
    return row


def owned_connection(
    db: Session,
    user_id: int,
    connection_id: int,
    *,
    for_update: bool = False,
) -> BrokerConnection:
    statement = select(BrokerConnection).where(
        BrokerConnection.id == connection_id,
        BrokerConnection.user_id == user_id,
    )
    if for_update:
        statement = statement.with_for_update()
    row = db.scalar(statement)
    if row is None:
        raise BrokerNotFoundError()
    return row


def owned_job(
    db: Session,
    user_id: int,
    job_id: int,
    *,
    for_update: bool = False,
) -> BrokerSyncJob:
    statement = select(BrokerSyncJob).where(
        BrokerSyncJob.id == job_id,
        BrokerSyncJob.user_id == user_id,
    )
    if for_update:
        statement = statement.with_for_update()
    row = db.scalar(statement)
    if row is None:
        raise BrokerNotFoundError()
    return row


def ensure_connection_active(connection: BrokerConnection) -> None:
    if connection.revoked_at is not None:
        raise BrokerConflictError("Broker connection has been revoked")


def provider_definition(provider_id: str) -> ProviderDefinition:
    for provider in PROVIDERS:
        if provider.provider_id == provider_id:
            return provider
    raise BrokerProviderUnavailableError()


def add_audit(
    db: Session,
    connection: BrokerConnection,
    *,
    action: str,
    outcome: str,
    details: Mapping[str, object] | None = None,
    job: BrokerSyncJob | None = None,
) -> None:
    db.add(
        BrokerAuditLog(
            user_id=connection.user_id,
            connection_id=connection.id,
            job_id=job.id if job else None,
            provider=connection.provider,
            action=action,
            outcome=outcome,
            details=dict(details or {}),
        )
    )


def validate_account_record(record: AccountRecord) -> None:
    if not record.external_account_id or not record.display_name:
        raise BrokerDataError("Broker account identifiers are required")
    if not record.currency or len(record.currency) > 12:
        raise BrokerDataError("Broker account currency is invalid")


def validate_order_record(record: OrderRecord) -> None:
    if record.side not in {"BUY", "SELL"}:
        raise BrokerDataError("Order side must be BUY or SELL")
    if decimal_value(record.quantity) <= 0 or decimal_value(record.filled_quantity) < 0:
        raise BrokerDataError("Order quantities are invalid")
    if decimal_value(record.filled_quantity) > decimal_value(record.quantity):
        raise BrokerDataError("Filled quantity exceeds order quantity")
    if record.source_revision < 1:
        raise BrokerDataError("Order revision must be positive")


def validate_fill_record(record: FillRecord) -> None:
    if record.side not in {"BUY", "SELL"}:
        raise BrokerDataError("Fill side must be BUY or SELL")
    if decimal_value(record.quantity) <= 0 or decimal_value(record.price) <= 0:
        raise BrokerDataError("Fill quantity and price must be positive")
    if decimal_value(record.commission) < 0 or decimal_value(record.fees) < 0:
        raise BrokerDataError("Fill costs cannot be negative")
    if record.source_revision < 1:
        raise BrokerDataError("Fill revision must be positive")


def order_values(record: OrderRecord) -> dict[str, object]:
    return {
        "symbol": record.symbol,
        "side": record.side,
        "order_type": record.order_type,
        "status": record.status,
        "quantity": quantize(record.quantity),
        "filled_quantity": quantize(record.filled_quantity),
        "average_fill_price": (
            quantize(record.average_fill_price)
            if record.average_fill_price is not None
            else None
        ),
        "commission_total": quantize(record.commission_total),
        "fees_total": quantize(record.fees_total),
        "source_revision": record.source_revision,
        "placed_at": record.placed_at,
        "provider_updated_at": record.provider_updated_at,
        "cancelled_at": record.cancelled_at,
    }


def order_matches(
    row: BrokerOrder,
    account_id: int,
    values: Mapping[str, object],
) -> bool:
    if row.account_id != account_id:
        return False
    return all(
        equivalent_value(getattr(row, field), value)
        for field, value in values.items()
    )


def fill_values(record: FillRecord) -> dict[str, object]:
    return {
        "external_order_id": record.external_order_id,
        "symbol": record.symbol,
        "side": record.side,
        "quantity": quantize(record.quantity),
        "price": quantize(record.price),
        "commission": quantize(record.commission),
        "fees": quantize(record.fees),
        "source_revision": record.source_revision,
        "cancelled": record.cancelled,
        "executed_at": record.executed_at,
        "provider_updated_at": record.provider_updated_at,
    }


def fill_fingerprint(record: FillRecord) -> str:
    payload = {
        **fill_values(record),
        "external_account_id": record.external_account_id,
        "external_fill_id": record.external_fill_id,
    }
    canonical = json.dumps(payload, default=str, sort_keys=True, separators=(",", ":"))
    return sha256(canonical.encode("utf-8")).hexdigest()


def reconciliation_hash(fills: Sequence[BrokerFill]) -> str:
    canonical = [
        {
            "cancelled": fill.cancelled,
            "commission": str(fill.commission),
            "executed_at": normalize_datetime(fill.executed_at)
            .astimezone(timezone.utc)
            .isoformat(),
            "external_fill_id": fill.external_fill_id,
            "fees": str(fill.fees),
            "fingerprint": fill.fingerprint,
            "price": str(fill.price),
            "quantity": str(fill.quantity),
            "revision": fill.source_revision,
            "side": fill.side,
        }
        for fill in fills
    ]
    return sha256(
        json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def same_sign(left: Decimal, right: Decimal) -> bool:
    return (left > 0 and right > 0) or (left < 0 and right < 0)


def decimal_value(value: Decimal | int | float | str) -> Decimal:
    try:
        converted = value if isinstance(value, Decimal) else Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise BrokerDataError("Broker numeric value is invalid") from exc
    if not converted.is_finite():
        raise BrokerDataError("Broker numeric value must be finite")
    return converted


def quantize(value: Decimal | int | float | str) -> Decimal:
    return decimal_value(value).quantize(DECIMAL_QUANTUM, rounding=ROUND_HALF_EVEN)


def normalize_datetime(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def equivalent_value(left: object, right: object) -> bool:
    if isinstance(left, datetime) and isinstance(right, datetime):
        return normalize_datetime(left) == normalize_datetime(right)
    if isinstance(left, Decimal) and isinstance(right, Decimal):
        return quantize(left) == quantize(right)
    return left == right


def connection_read(row: BrokerConnection) -> BrokerConnectionRead:
    return BrokerConnectionRead(
        id=row.id,
        provider=row.provider,
        display_name=row.display_name,
        secret_id=row.secret_id,
        status=row.status,
        health=row.health,
        last_error_code=row.last_error_code,
        last_error_message=row.last_error_message,
        last_sync_started_at=row.last_sync_started_at,
        last_sync_completed_at=row.last_sync_completed_at,
        next_retry_at=row.next_retry_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
        revoked_at=row.revoked_at,
    )


def account_read(row: BrokerAccount) -> BrokerAccountRead:
    return BrokerAccountRead(
        id=row.id,
        connection_id=row.connection_id,
        external_account_id=row.external_account_id,
        display_name=row.display_name,
        currency=row.currency,
        status=row.status,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def order_read(row: BrokerOrder) -> BrokerOrderRead:
    return BrokerOrderRead(**{
        field: getattr(row, field)
        for field in BrokerOrderRead.model_fields
    })


def fill_read(row: BrokerFill) -> BrokerFillRead:
    return BrokerFillRead(**{
        field: getattr(row, field)
        for field in BrokerFillRead.model_fields
    })


def position_read(row: BrokerPositionSnapshot) -> BrokerPositionRead:
    return BrokerPositionRead(**{
        field: getattr(row, field)
        for field in BrokerPositionRead.model_fields
    })


def job_read(row: BrokerSyncJob) -> BrokerSyncJobRead:
    stats = row.stats if isinstance(row.stats, dict) else {}
    return BrokerSyncJobRead(
        id=row.id,
        connection_id=row.connection_id,
        status=row.status,
        attempt=row.attempt,
        max_attempts=row.max_attempts,
        cursor_before=row.cursor_before,
        cursor_after=row.cursor_after,
        error_code=row.error_code,
        error_message=row.error_message,
        stats={str(key): int(value) for key, value in stats.items()},
        started_at=row.started_at,
        finished_at=row.finished_at,
        next_retry_at=row.next_retry_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def audit_read(row: BrokerAuditLog) -> BrokerAuditRead:
    return BrokerAuditRead(
        id=row.id,
        connection_id=row.connection_id,
        job_id=row.job_id,
        provider=row.provider,
        action=row.action,
        outcome=row.outcome,
        details=row.details if isinstance(row.details, dict) else {},
        created_at=row.created_at,
    )


def payload_rows(payload: Any) -> list[Mapping[str, Any]]:
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        rows = next(
            (payload[key] for key in ("items", "data", "results", "accounts", "orders", "fills") if isinstance(payload.get(key), list)),
            [],
        )
    else:
        raise BrokerDataError("Broker response must be a JSON array or object")
    if not all(isinstance(item, dict) for item in rows):
        raise BrokerDataError("Broker response contains an invalid record")
    return rows


def payload_cursor(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    value = payload.get("nextCursor", payload.get("next_cursor", payload.get("cursor")))
    return str(value) if value not in (None, "") else None


def text_value(item: Mapping[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = item.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def required_text(item: Mapping[str, Any], *keys: str) -> str:
    value = text_value(item, *keys)
    if value is None:
        raise BrokerDataError(f"Broker record is missing {keys[0]}")
    return value


def decimal_field(item: Mapping[str, Any], *keys: str, default: str | None = None) -> Decimal:
    value = text_value(item, *keys)
    if value is None:
        if default is None:
            raise BrokerDataError(f"Broker record is missing {keys[0]}")
        value = default
    try:
        return Decimal(value)
    except InvalidOperation as exc:
        raise BrokerDataError(f"Broker record has invalid {keys[0]}") from exc


def optional_decimal_field(item: Mapping[str, Any], *keys: str) -> Decimal | None:
    value = text_value(item, *keys)
    return decimal_field({keys[0]: value}, keys[0]) if value is not None else None


def integer_field(item: Mapping[str, Any], *keys: str, default: int) -> int:
    value = text_value(item, *keys)
    try:
        return int(value) if value is not None else default
    except ValueError as exc:
        raise BrokerDataError(f"Broker record has invalid {keys[0]}") from exc


def datetime_field(item: Mapping[str, Any], *keys: str) -> datetime:
    value = required_text(item, *keys)
    try:
        if value.isdigit():
            number = int(value)
            return datetime.fromtimestamp(number / 1000 if number > 10_000_000_000 else number, tz=timezone.utc)
        return normalize_datetime(datetime.fromisoformat(value.replace("Z", "+00:00")))
    except (ValueError, OSError, OverflowError) as exc:
        raise BrokerDataError(f"Broker record has invalid {keys[0]}") from exc


def normalize_side(value: str) -> str:
    normalized = value.strip().upper()
    if normalized in {"BUY", "BUYTOCOVER", "BUY_TO_COVER", "B"}:
        return "BUY"
    if normalized in {"SELL", "SELLSHORT", "SELL_SHORT", "S"}:
        return "SELL"
    raise BrokerDataError("Broker record has an invalid side")


def default_fixture_batches() -> tuple[SyncBatch, ...]:
    occurred_at = datetime(2024, 1, 2, 14, 30, tzinfo=timezone.utc)
    return (
        SyncBatch(
            accounts=(
                AccountRecord("SIM-001", "Deterministic simulation", "USD"),
            ),
            orders=(
                OrderRecord(
                    external_order_id="ORDER-001",
                    external_account_id="SIM-001",
                    symbol="ES",
                    side="BUY",
                    order_type="MARKET",
                    status="FILLED",
                    quantity=Decimal("2"),
                    filled_quantity=Decimal("2"),
                    average_fill_price=Decimal("5000.5"),
                    commission_total=Decimal("2.4"),
                    fees_total=Decimal("0.6"),
                    placed_at=occurred_at,
                    provider_updated_at=occurred_at,
                ),
            ),
            fills=(
                FillRecord(
                    external_fill_id="FILL-001",
                    external_order_id="ORDER-001",
                    external_account_id="SIM-001",
                    symbol="ES",
                    side="BUY",
                    quantity=Decimal("2"),
                    price=Decimal("5000.5"),
                    commission=Decimal("2.4"),
                    fees=Decimal("0.6"),
                    executed_at=occurred_at,
                    provider_updated_at=occurred_at,
                ),
            ),
            next_cursor="1",
            high_watermark=occurred_at,
        ),
    )


ADAPTERS["offline-fixture"] = FixtureBrokerAdapter()
ADAPTERS["tradovate"] = TradovateBrokerAdapter()
ADAPTERS["ninjatrader"] = NinjaTraderBrokerAdapter()
