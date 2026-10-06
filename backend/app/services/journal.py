from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timezone
from decimal import Decimal
from hashlib import sha256
import json
import re
from typing import Any, Iterable, Literal
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session, selectinload

from app.models import (
    AppStorageItem,
    BacktestSession,
    BrokerAccount,
    BrokerConnection,
    BrokerFill,
    CanonicalExecution,
    CanonicalTrade,
    CanonicalTradeNote,
    CanonicalTradeScreenshot,
    CanonicalTradeTag,
    JournalAccount,
    JournalBackfillCheckpoint,
    JournalDailyNote,
    JournalImportDiagnostic,
    JournalImportRow,
    JournalImportRun,
    JournalTag,
    Trade,
    TradeNote,
    utcnow,
)
from app.schemas import (
    CanonicalExecutionCreate,
    CanonicalExecutionRead,
    CanonicalTradeCreate,
    CanonicalTradeNoteRead,
    CanonicalTradeRead,
    CanonicalTradeReviewUpdate,
    CanonicalTradeScreenshotRead,
    JournalAccountCreate,
    JournalAccountRead,
    JournalBackfillResult,
    JournalDailyNoteRead,
    JournalDailyNoteUpsert,
    JournalImportCreate,
    JournalImportDiagnosticRead,
    JournalImportResult,
    JournalImportRowRead,
    JournalImportRunRead,
    JournalTagCreate,
    JournalTagRead,
)
from app.services.trade_imports import FIELD_ALIASES, _parse_trade_row, _read_csv


DECIMAL_SCALE = Decimal("0.0000000001")
LIVE_JOURNAL_NAMESPACE = "edgelab"
LIVE_JOURNAL_KEY = "live-journal.v1"
VALID_IMPORT_MAPPING_FIELDS = frozenset(FIELD_ALIASES)


class JournalServiceError(Exception):
    status_code = 400
    public_message = "Journal request could not be completed"

    def __init__(self, public_message: str | None = None):
        super().__init__(public_message or self.public_message)
        if public_message:
            self.public_message = public_message


class JournalNotFoundError(JournalServiceError):
    status_code = 404
    public_message = "Journal record not found"


class JournalConflictError(JournalServiceError):
    status_code = 409


def _decimal(value: Any, default: Decimal = Decimal("0")) -> Decimal:
    if value is None or value == "":
        return default
    try:
        result = Decimal(str(value))
    except Exception:
        return default
    return result if result.is_finite() else default


def _optional_decimal(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        result = Decimal(str(value))
    except Exception:
        return None
    return result if result.is_finite() else None


def _quantize(value: Decimal) -> Decimal:
    return value.quantize(DECIMAL_SCALE)


def normalize_symbol(value: str | None, fallback: str = "UNKNOWN") -> str:
    clean = re.sub(r"[^A-Z0-9._-]+", "", (value or "").strip().upper())
    return clean[:80] or fallback


def normalize_currency(value: str | None, fallback: str = "USD") -> str:
    clean = re.sub(r"[^A-Z0-9]+", "", (value or "").strip().upper())
    return clean[:12] or fallback


def _normalize_datetime(value: datetime, source_timezone: str) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=ZoneInfo(source_timezone))
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _parse_legacy_datetime(value: Any, fallback: datetime | None = None) -> datetime:
    if isinstance(value, datetime):
        result = value
    elif isinstance(value, str) and value.strip():
        try:
            result = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return fallback or utcnow().replace(tzinfo=None)
    else:
        return fallback or utcnow().replace(tzinfo=None)
    if result.tzinfo is not None:
        return result.astimezone(timezone.utc).replace(tzinfo=None)
    return result


def _digest(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    return sha256(encoded).hexdigest()


def _json_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    return value


def _owned_account(db: Session, user_id: int, account_id: int) -> JournalAccount:
    account = db.scalar(
        select(JournalAccount).where(
            JournalAccount.id == account_id,
            JournalAccount.user_id == user_id,
        )
    )
    if account is None:
        raise JournalNotFoundError("Journal account not found")
    return account


def _new_account(
    db: Session,
    user_id: int,
    payload: JournalAccountCreate,
    *,
    source_type: str = "MANUAL",
    source_key: str | None = None,
) -> JournalAccount:
    if payload.broker_account_id is not None:
        broker_account = db.scalar(
            select(BrokerAccount).where(
                BrokerAccount.id == payload.broker_account_id,
                BrokerAccount.user_id == user_id,
            )
        )
        if broker_account is None:
            raise JournalNotFoundError("Broker account not found")
    row = JournalAccount(
        user_id=user_id,
        broker_account_id=payload.broker_account_id,
        source_type=source_type,
        source_key=source_key or f"manual:{uuid4()}",
        name=payload.name.strip(),
        provider=payload.provider.strip(),
        currency=normalize_currency(payload.currency),
        timezone=payload.timezone,
        initial_balance=payload.initial_balance,
        color=payload.color,
        notes=payload.notes,
        status="ACTIVE",
    )
    db.add(row)
    db.flush()
    return row


def create_account(db: Session, user_id: int, payload: JournalAccountCreate) -> JournalAccountRead:
    row = _new_account(db, user_id, payload)
    db.commit()
    db.refresh(row)
    return JournalAccountRead.model_validate(row)


def list_accounts(db: Session, user_id: int, *, include_archived: bool = False) -> list[JournalAccountRead]:
    statement = select(JournalAccount).where(JournalAccount.user_id == user_id)
    if not include_archived:
        statement = statement.where(JournalAccount.status == "ACTIVE")
    rows = db.scalars(statement.order_by(JournalAccount.name.asc(), JournalAccount.id.asc())).all()
    return [JournalAccountRead.model_validate(row) for row in rows]


def _normalized_tag_name(name: str) -> str:
    return " ".join(name.strip().lower().split())


def _ensure_tag(
    db: Session,
    user_id: int,
    category: str,
    name: str,
    *,
    color: str | None = None,
) -> tuple[JournalTag, bool]:
    clean = " ".join(name.strip().split())[:80]
    normalized = _normalized_tag_name(clean)
    row = db.scalar(
        select(JournalTag).where(
            JournalTag.user_id == user_id,
            JournalTag.category == category,
            JournalTag.normalized_name == normalized,
        )
    )
    if row is not None:
        return row, False
    row = JournalTag(
        user_id=user_id,
        category=category,
        name=clean,
        normalized_name=normalized,
        color=color,
    )
    db.add(row)
    db.flush()
    return row, True


def create_tag(db: Session, user_id: int, payload: JournalTagCreate) -> JournalTagRead:
    row, created = _ensure_tag(db, user_id, payload.category, payload.name, color=payload.color)
    if not created and row.archived_at is None:
        raise JournalConflictError("A tag with this name and category already exists")
    if row.archived_at is not None:
        row.archived_at = None
        row.name = payload.name.strip()
        row.color = payload.color
    db.commit()
    db.refresh(row)
    return JournalTagRead.model_validate(row)


def list_tags(
    db: Session,
    user_id: int,
    *,
    category: str | None = None,
    include_archived: bool = False,
) -> list[JournalTagRead]:
    statement = select(JournalTag).where(JournalTag.user_id == user_id)
    if category is not None:
        statement = statement.where(JournalTag.category == category)
    if not include_archived:
        statement = statement.where(JournalTag.archived_at.is_(None))
    rows = db.scalars(statement.order_by(JournalTag.category.asc(), JournalTag.name.asc(), JournalTag.id.asc())).all()
    return [JournalTagRead.model_validate(row) for row in rows]


def _owned_tags(db: Session, user_id: int, tag_ids: Iterable[int]) -> list[JournalTag]:
    ids = sorted(set(tag_ids))
    if not ids:
        return []
    rows = db.scalars(
        select(JournalTag).where(
            JournalTag.user_id == user_id,
            JournalTag.id.in_(ids),
            JournalTag.archived_at.is_(None),
        )
    ).all()
    if len(rows) != len(ids):
        raise JournalNotFoundError("One or more Journal tags were not found")
    return sorted(rows, key=lambda row: ids.index(row.id))


def _trade_statement(user_id: int):
    return (
        select(CanonicalTrade)
        .where(CanonicalTrade.user_id == user_id)
        .options(
            selectinload(CanonicalTrade.executions),
            selectinload(CanonicalTrade.tag_links).selectinload(CanonicalTradeTag.tag),
            selectinload(CanonicalTrade.notes),
            selectinload(CanonicalTrade.screenshots),
        )
    )


def _owned_trade(db: Session, user_id: int, trade_id: int) -> CanonicalTrade:
    row = db.scalar(_trade_statement(user_id).where(CanonicalTrade.id == trade_id))
    if row is None:
        raise JournalNotFoundError("Canonical trade not found")
    return row


def _trade_read(row: CanonicalTrade) -> CanonicalTradeRead:
    return CanonicalTradeRead(
        **{
            column.name: getattr(row, column.name)
            for column in CanonicalTrade.__table__.columns
            if column.name not in {"user_id"}
        },
        tags=[JournalTagRead.model_validate(link.tag) for link in row.tag_links],
        notes=[CanonicalTradeNoteRead.model_validate(note) for note in row.notes],
        screenshots=[CanonicalTradeScreenshotRead.model_validate(item) for item in row.screenshots],
        executions=[CanonicalExecutionRead.model_validate(item) for item in row.executions],
    )


def _calculated_pnl(
    side: str,
    entry_price: Decimal,
    exit_price: Decimal | None,
    quantity: Decimal,
) -> Decimal:
    if exit_price is None:
        return Decimal("0")
    direction = Decimal("1") if side == "LONG" else Decimal("-1")
    return _quantize((exit_price - entry_price) * quantity * direction)


def _execution_fingerprint(payload: dict[str, Any]) -> str:
    return _digest(payload)


def _append_execution(
    db: Session,
    trade: CanonicalTrade,
    user_id: int,
    source_type: str,
    source_ref: str,
    execution_type: str,
    side: str,
    occurred_at: datetime,
    price: Decimal,
    quantity: Decimal,
    commission: Decimal,
    fees: Decimal,
    sequence: int,
    source_revision: int = 1,
    raw_payload: dict[str, Any] | None = None,
    fingerprint: str | None = None,
) -> CanonicalExecution:
    fingerprint_payload = {
        "source_type": source_type,
        "source_ref": source_ref,
        "execution_type": execution_type,
        "side": side,
        "occurred_at": occurred_at.isoformat(),
        "price": str(price),
        "quantity": str(quantity),
        "commission": str(commission),
        "fees": str(fees),
        "source_revision": source_revision,
    }
    row = CanonicalExecution(
        user_id=user_id,
        trade=trade,
        source_type=source_type,
        source_ref=source_ref,
        execution_type=execution_type,
        side=side,
        occurred_at=occurred_at,
        price=price,
        quantity=quantity,
        commission=commission,
        fees=fees,
        sequence=sequence,
        source_revision=source_revision,
        fingerprint=fingerprint or _execution_fingerprint(fingerprint_payload),
        raw_payload=raw_payload or {},
    )
    db.add(row)
    return row


def _add_trade_note(db: Session, trade: CanonicalTrade, user_id: int, body: str | None, kind: str = "REVIEW") -> bool:
    clean = (body or "").strip()
    if not clean:
        return False
    db.add(CanonicalTradeNote(user_id=user_id, trade=trade, kind=kind, body=clean))
    return True


def _add_screenshot(
    db: Session,
    trade: CanonicalTrade,
    user_id: int,
    url: str | None,
    *,
    caption: str | None = None,
) -> bool:
    clean = (url or "").strip()
    if not clean:
        return False
    db.add(
        CanonicalTradeScreenshot(
            user_id=user_id,
            trade=trade,
            url=clean,
            caption=caption,
        )
    )
    return True


def create_trade(db: Session, user_id: int, payload: CanonicalTradeCreate) -> CanonicalTradeRead:
    account = _owned_account(db, user_id, payload.account_id)
    tags = _owned_tags(db, user_id, payload.tag_ids)
    source_timezone = payload.source_timezone or account.timezone
    ZoneInfo(source_timezone)
    entry_time = _normalize_datetime(payload.entry_time, source_timezone)
    exit_time = _normalize_datetime(payload.exit_time, source_timezone) if payload.exit_time else None
    if exit_time is not None and exit_time < entry_time:
        raise JournalServiceError("exit_time cannot precede entry_time")
    remaining_quantity = (
        payload.remaining_quantity
        if payload.remaining_quantity is not None
        else Decimal("0") if exit_time is not None else payload.quantity
    )
    gross_pnl = payload.gross_pnl
    if gross_pnl is None:
        gross_pnl = _calculated_pnl(payload.side, payload.entry_price, payload.exit_price, payload.quantity)
    net_pnl = payload.net_pnl
    if net_pnl is None:
        net_pnl = gross_pnl - payload.commission - payload.fees
    source_ref = f"manual:{uuid4()}"
    row = CanonicalTrade(
        user_id=user_id,
        account_id=account.id,
        source_type="MANUAL",
        source_ref=source_ref,
        duplicate_key=_digest(source_ref),
        entry_type=payload.entry_type,
        status=(
            "MISSED"
            if payload.entry_type == "MISSED"
            else "CLOSED"
            if exit_time is not None and remaining_quantity == 0
            else "OPEN"
        ),
        symbol=normalize_symbol(payload.symbol),
        source_symbol=payload.symbol.strip(),
        currency=normalize_currency(payload.currency, account.currency),
        source_timezone=source_timezone,
        side=payload.side,
        entry_time=entry_time,
        exit_time=exit_time,
        entry_price=payload.entry_price,
        exit_price=payload.exit_price,
        quantity=payload.quantity,
        remaining_quantity=remaining_quantity,
        gross_pnl=gross_pnl,
        net_pnl=net_pnl,
        commission=payload.commission,
        fees=payload.fees,
        stop_loss=payload.stop_loss,
        take_profit=payload.take_profit,
        planned_entry_price=payload.planned_entry_price,
        planned_exit_price=payload.planned_exit_price,
        planned_stop_loss=payload.planned_stop_loss,
        planned_take_profit=payload.planned_take_profit,
        r_multiple=payload.r_multiple,
        strategy_name=payload.strategy_name,
        emotional_state=payload.emotional_state,
        missed_reason=payload.missed_reason,
        rating=payload.rating,
        setup_grade=payload.setup_grade,
        reviewed=payload.reviewed,
        reviewed_at=utcnow() if payload.reviewed else None,
    )
    db.add(row)
    db.flush()
    for tag in tags:
        db.add(CanonicalTradeTag(user_id=user_id, trade=row, tag=tag))
    _add_trade_note(db, row, user_id, payload.note)
    for url in payload.screenshot_urls:
        _add_screenshot(db, row, user_id, url)

    executions = payload.executions
    if not executions and payload.entry_type == "TAKEN" and payload.quantity > 0:
        executions = [
            CanonicalExecutionCreate(
                source_ref=f"{source_ref}:entry",
                execution_type="ENTRY",
                side="BUY" if payload.side == "LONG" else "SELL",
                occurred_at=payload.entry_time,
                price=payload.entry_price,
                quantity=payload.quantity,
                commission=payload.commission / 2,
                fees=payload.fees / 2,
            )
        ]
        closed_quantity = payload.quantity - remaining_quantity
        if payload.exit_time and payload.exit_price and closed_quantity > 0:
            executions.append(
                CanonicalExecutionCreate(
                    source_ref=f"{source_ref}:exit",
                    execution_type="EXIT",
                    side="SELL" if payload.side == "LONG" else "BUY",
                    occurred_at=payload.exit_time,
                    price=payload.exit_price,
                    quantity=closed_quantity,
                    commission=payload.commission - payload.commission / 2,
                    fees=payload.fees - payload.fees / 2,
                )
            )
    for sequence, execution in enumerate(executions):
        _append_execution(
            db,
            row,
            user_id,
            "MANUAL",
            execution.source_ref or f"{source_ref}:{sequence}",
            execution.execution_type,
            execution.side,
            _normalize_datetime(execution.occurred_at, source_timezone),
            execution.price,
            execution.quantity,
            execution.commission,
            execution.fees,
            sequence,
            execution.source_revision,
            execution.raw_payload,
        )
    db.commit()
    return _trade_read(_owned_trade(db, user_id, row.id))


def list_trades(
    db: Session,
    user_id: int,
    *,
    account_id: int | None = None,
    reviewed: bool | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    tag_ids: Iterable[int] = (),
    offset: int = 0,
    limit: int = 100,
    order: Literal["entry", "id"] = "entry",
    before_id: int | None = None,
) -> list[CanonicalTradeRead]:
    if (before_id is not None and (order != "id" or before_id <= 0)) or (order == "id" and offset != 0):
        raise JournalServiceError("ID cursor paging requires a positive before_id, order=id and offset=0")
    statement = _trade_statement(user_id)
    if account_id is not None:
        _owned_account(db, user_id, account_id)
        statement = statement.where(CanonicalTrade.account_id == account_id)
    if reviewed is not None:
        statement = statement.where(CanonicalTrade.reviewed.is_(reviewed))
    if start_date is not None:
        statement = statement.where(CanonicalTrade.entry_time >= datetime.combine(start_date, time.min, timezone.utc))
    if end_date is not None:
        statement = statement.where(CanonicalTrade.entry_time <= datetime.combine(end_date, time.max, timezone.utc))
    for tag_id in sorted(set(tag_ids)):
        statement = statement.where(
            CanonicalTrade.tag_links.any(CanonicalTradeTag.tag_id == tag_id)
        )
    if before_id is not None:
        statement = statement.where(CanonicalTrade.id < before_id)
    ordering = (CanonicalTrade.id.desc(),) if order == "id" else (CanonicalTrade.entry_time.desc(), CanonicalTrade.id.desc())
    rows = db.scalars(
        statement.order_by(*ordering)
        .offset(offset)
        .limit(limit)
    ).all()
    return [_trade_read(row) for row in rows]


def get_trade(db: Session, user_id: int, trade_id: int) -> CanonicalTradeRead:
    return _trade_read(_owned_trade(db, user_id, trade_id))


def update_trade_review(
    db: Session,
    user_id: int,
    trade_id: int,
    payload: CanonicalTradeReviewUpdate,
) -> CanonicalTradeRead:
    row = _owned_trade(db, user_id, trade_id)
    original_prices = (row.entry_price, row.exit_price)
    original_exit_time = row.exit_time
    fields = payload.model_fields_set
    if "tag_ids" in fields:
        tags = _owned_tags(db, user_id, payload.tag_ids or [])
        desired_ids = {tag.id for tag in tags}
        existing_ids = {link.tag_id for link in row.tag_links}
        for link in list(row.tag_links):
            if link.tag_id not in desired_ids:
                row.tag_links.remove(link)
        for tag in tags:
            if tag.id not in existing_ids:
                row.tag_links.append(CanonicalTradeTag(user_id=user_id, tag=tag))
    for field in (
        "rating",
        "setup_grade",
        "entry_price",
        "exit_price",
        "stop_loss",
        "take_profit",
        "strategy_name",
        "emotional_state",
    ):
        if field in fields:
            setattr(row, field, getattr(payload, field))
    if "entry_time" in fields and payload.entry_time is not None:
        row.entry_time = _normalize_datetime(payload.entry_time, row.source_timezone)
    if "exit_time" in fields:
        row.exit_time = (
            _normalize_datetime(payload.exit_time, row.source_timezone)
            if payload.exit_time is not None
            else None
        )
    if row.exit_time is not None and row.exit_time < row.entry_time:
        raise JournalServiceError("exit_time cannot precede entry_time")
    if "reviewed" in fields and payload.reviewed is not None:
        row.reviewed = payload.reviewed
        row.reviewed_at = utcnow() if payload.reviewed else None
    if "note" in fields:
        _add_trade_note(db, row, user_id, payload.note)
    if "screenshot_urls" in fields:
        row.screenshots.clear()
        for url in payload.screenshot_urls or []:
            _add_screenshot(db, row, user_id, url)
    if row.entry_type == "TAKEN" and row.status != "VOIDED":
        if row.exit_time != original_exit_time:
            row.status = (
                "CLOSED"
                if row.exit_time is not None and row.remaining_quantity == 0
                else "OPEN"
            )
        if (row.entry_price, row.exit_price) != original_prices:
            row.gross_pnl = _calculated_pnl(row.side, row.entry_price, row.exit_price, row.quantity)
            row.net_pnl = row.gross_pnl - row.commission - row.fees
    row.updated_at = utcnow()
    db.commit()
    return _trade_read(_owned_trade(db, user_id, row.id))


def upsert_daily_note(
    db: Session,
    user_id: int,
    note_date: date,
    payload: JournalDailyNoteUpsert,
) -> JournalDailyNoteRead:
    if payload.account_id is not None:
        _owned_account(db, user_id, payload.account_id)
    scope_key = str(payload.account_id) if payload.account_id is not None else "*"
    row = db.scalar(
        select(JournalDailyNote).where(
            JournalDailyNote.user_id == user_id,
            JournalDailyNote.note_date == note_date,
            JournalDailyNote.account_scope_key == scope_key,
        )
    )
    if row is None:
        row = JournalDailyNote(
            user_id=user_id,
            account_id=payload.account_id,
            account_scope_key=scope_key,
            note_date=note_date,
            body=payload.body,
        )
        db.add(row)
    else:
        row.body = payload.body
        row.updated_at = utcnow()
    db.commit()
    db.refresh(row)
    return JournalDailyNoteRead.model_validate(row)


def list_daily_notes(
    db: Session,
    user_id: int,
    *,
    start_date: date | None = None,
    end_date: date | None = None,
    account_id: int | None = None,
) -> list[JournalDailyNoteRead]:
    statement = select(JournalDailyNote).where(JournalDailyNote.user_id == user_id)
    if start_date is not None:
        statement = statement.where(JournalDailyNote.note_date >= start_date)
    if end_date is not None:
        statement = statement.where(JournalDailyNote.note_date <= end_date)
    if account_id is not None:
        _owned_account(db, user_id, account_id)
        statement = statement.where(JournalDailyNote.account_id == account_id)
    rows = db.scalars(statement.order_by(JournalDailyNote.note_date.desc(), JournalDailyNote.id.desc())).all()
    return [JournalDailyNoteRead.model_validate(row) for row in rows]


def _import_run_statement(user_id: int):
    return (
        select(JournalImportRun)
        .where(JournalImportRun.user_id == user_id)
        .options(
            selectinload(JournalImportRun.rows),
            selectinload(JournalImportRun.diagnostics),
        )
    )


def _owned_import_run(db: Session, user_id: int, run_id: int) -> JournalImportRun:
    row = db.scalar(_import_run_statement(user_id).where(JournalImportRun.id == run_id))
    if row is None:
        raise JournalNotFoundError("Journal import not found")
    return row


def _import_run_read(row: JournalImportRun) -> JournalImportRunRead:
    return JournalImportRunRead(
        **{
            column.name: getattr(row, column.name)
            for column in JournalImportRun.__table__.columns
            if column.name != "user_id"
        },
        rows=[JournalImportRowRead.model_validate(item) for item in row.rows],
        diagnostics=[
            JournalImportDiagnosticRead.model_validate(item)
            for item in row.diagnostics
        ],
    )


def _validate_import_mapping(
    headers: list[str],
    mapping: dict[str, str],
    grouping_column: str | None,
) -> dict[str, str]:
    clean_mapping: dict[str, str] = {}
    for field, column in mapping.items():
        if field not in VALID_IMPORT_MAPPING_FIELDS:
            allowed = ", ".join(sorted(VALID_IMPORT_MAPPING_FIELDS))
            raise JournalServiceError(f"Unknown mapped field '{field}'. Supported fields: {allowed}")
        clean_column = column.strip()
        if clean_column not in headers:
            raise JournalServiceError(f"Mapped column '{clean_column}' was not found in the CSV header")
        clean_mapping[field] = clean_column
    if grouping_column is not None and grouping_column not in headers:
        raise JournalServiceError(f"Grouping column '{grouping_column}' was not found in the CSV header")
    return clean_mapping


def _normalized_import_payload(parsed: dict[str, Any], source_timezone: str, currency: str, symbol: str) -> dict[str, Any]:
    normalized = dict(parsed)
    normalized["entry_time"] = _normalize_datetime(parsed["entry_time"], source_timezone)
    normalized["exit_time"] = _normalize_datetime(parsed["exit_time"], source_timezone)
    normalized["currency"] = currency
    normalized["source_symbol"] = parsed.get("symbol")
    normalized["symbol"] = normalize_symbol(parsed.get("symbol"), symbol)
    for field in (
        "entry_price",
        "exit_price",
        "quantity",
        "gross_pnl",
        "realized_pnl",
        "commission_amount",
        "fee_amount",
        "stop_loss",
        "take_profit",
        "r_multiple",
    ):
        if normalized.get(field) is not None:
            normalized[field] = _decimal(normalized[field])
    if normalized["entry_price"] <= 0:
        raise ValueError("entry price must be greater than zero")
    if normalized["exit_price"] <= 0:
        raise ValueError("exit price must be greater than zero")
    if normalized["quantity"] <= 0:
        raise ValueError("quantity must be greater than zero")
    if normalized["exit_time"] < normalized["entry_time"]:
        raise ValueError("exit time cannot precede entry time")
    return normalized


def _aggregate_import_group(items: list[tuple[int, dict[str, str], dict[str, Any], JournalImportRow]]) -> dict[str, Any]:
    parsed_rows = [item[2] for item in items]
    sides = {row["side"] for row in parsed_rows}
    symbols = {row["symbol"] for row in parsed_rows}
    currencies = {row["currency"] for row in parsed_rows}
    if len(sides) != 1:
        raise ValueError("group contains both LONG and SHORT rows")
    if len(symbols) != 1:
        raise ValueError("group contains multiple normalized symbols")
    if len(currencies) != 1:
        raise ValueError("group contains multiple currencies")
    quantity = sum((row["quantity"] for row in parsed_rows), Decimal("0"))
    if quantity <= 0:
        raise ValueError("grouped quantity must be greater than zero")
    entry_price = sum((row["entry_price"] * row["quantity"] for row in parsed_rows), Decimal("0")) / quantity
    exit_price = sum((row["exit_price"] * row["quantity"] for row in parsed_rows), Decimal("0")) / quantity
    notes = list(dict.fromkeys(row["notes"] for row in parsed_rows if row.get("notes")))
    tags: list[str] = []
    for row in parsed_rows:
        for tag in row.get("tags", []):
            if tag not in tags:
                tags.append(tag)
    first_non_null = lambda field: next((row[field] for row in parsed_rows if row.get(field) is not None), None)
    return {
        "side": parsed_rows[0]["side"],
        "symbol": parsed_rows[0]["symbol"],
        "source_symbol": first_non_null("source_symbol"),
        "currency": parsed_rows[0]["currency"],
        "entry_time": min(row["entry_time"] for row in parsed_rows),
        "exit_time": max(row["exit_time"] for row in parsed_rows),
        "entry_price": _quantize(entry_price),
        "exit_price": _quantize(exit_price),
        "quantity": _quantize(quantity),
        "gross_pnl": _quantize(sum((row["gross_pnl"] for row in parsed_rows), Decimal("0"))),
        "net_pnl": _quantize(sum((row["realized_pnl"] for row in parsed_rows), Decimal("0"))),
        "commission": _quantize(sum((row["commission_amount"] for row in parsed_rows), Decimal("0"))),
        "fees": _quantize(sum((row["fee_amount"] for row in parsed_rows), Decimal("0"))),
        "stop_loss": first_non_null("stop_loss"),
        "take_profit": first_non_null("take_profit"),
        "r_multiple": first_non_null("r_multiple"),
        "strategy_name": first_non_null("strategy_name"),
        "notes": "\n\n".join(notes) if notes else None,
        "tags": tags,
    }


def _import_duplicate_key(values: dict[str, Any]) -> str:
    return _digest(
        {
            key: values.get(key)
            for key in (
                "side",
                "symbol",
                "currency",
                "entry_time",
                "exit_time",
                "entry_price",
                "exit_price",
                "quantity",
                "gross_pnl",
                "net_pnl",
                "commission",
                "fees",
            )
        }
    )


def import_journal_csv(db: Session, user_id: int, payload: JournalImportCreate) -> JournalImportResult:
    try:
        rows, headers = _read_csv(payload.csv_text)
    except HTTPException as exc:
        raise JournalServiceError(str(exc.detail)) from exc
    if not rows:
        raise JournalServiceError("CSV did not contain any data rows")
    grouping_column = payload.grouping.column.strip() if payload.grouping.column else None
    mapping = _validate_import_mapping(headers, payload.column_mapping, grouping_column)

    if payload.destination_account_id is not None:
        account = _owned_account(db, user_id, payload.destination_account_id)
    else:
        assert payload.destination_account is not None
        account = _new_account(db, user_id, payload.destination_account)
    currency = normalize_currency(payload.currency, account.currency)
    fallback_symbol = normalize_symbol(payload.default_symbol, "IMPORTED")
    run = JournalImportRun(
        user_id=user_id,
        account_id=account.id,
        source_name=payload.source_name.strip(),
        source_digest=_digest(payload.csv_text),
        status="RUNNING",
        source_timezone=payload.source_timezone,
        currency=currency,
        default_symbol=fallback_symbol,
        column_mapping=mapping,
        grouping=payload.grouping.model_dump(),
        detected_columns=headers,
        total_rows=len(rows),
    )
    db.add(run)
    db.flush()

    parsed_groups: dict[str, list[tuple[int, dict[str, str], dict[str, Any], JournalImportRow]]] = defaultdict(list)
    for row_number, source_row in enumerate(rows, start=2):
        source_fingerprint = _digest(source_row)
        group_key = (
            f"row:{row_number}"
            if payload.grouping.mode == "ROW"
            else source_row.get(grouping_column or "", "").strip()
        )
        import_row = JournalImportRow(
            user_id=user_id,
            run_id=run.id,
            row_number=row_number,
            group_key=group_key or f"missing:{row_number}",
            status="SKIPPED",
            source_fingerprint=source_fingerprint,
            normalized_payload=None,
        )
        db.add(import_row)
        if not any(value.strip() for value in source_row.values()):
            run.skipped_rows += 1
            continue
        if payload.grouping.mode == "COLUMN" and not group_key:
            import_row.status = "ERROR"
            run.error_rows += 1
            db.add(
                JournalImportDiagnostic(
                    user_id=user_id,
                    run_id=run.id,
                    row_number=row_number,
                    severity="ERROR",
                    code="MISSING_GROUP_KEY",
                    field=grouping_column,
                    message=f"Row {row_number}: grouping column '{grouping_column}' is empty",
                )
            )
            continue
        try:
            parsed = _parse_trade_row(
                source_row,
                headers,
                mapping,
                row_number,
                payload.strategy_name,
                payload.default_commission_mode,
                payload.default_commission_value,
                payload.default_fee_mode,
                payload.default_fee_value,
            )
            parsed = _normalized_import_payload(parsed, payload.source_timezone, currency, fallback_symbol)
        except ValueError as exc:
            import_row.status = "ERROR"
            run.error_rows += 1
            db.add(
                JournalImportDiagnostic(
                    user_id=user_id,
                    run_id=run.id,
                    row_number=row_number,
                    severity="ERROR",
                    code="ROW_VALIDATION",
                    field=None,
                    message=str(exc)[:500],
                )
            )
            continue
        import_row.normalized_payload = _json_value(parsed)
        parsed_groups[group_key].append((row_number, source_row, parsed, import_row))

    imported_trades: list[int] = []
    for group_key, items in parsed_groups.items():
        try:
            values = _aggregate_import_group(items)
        except ValueError as exc:
            for row_number, _source, _parsed, import_row in items:
                import_row.status = "ERROR"
                run.error_rows += 1
                db.add(
                    JournalImportDiagnostic(
                        user_id=user_id,
                        run_id=run.id,
                        row_number=row_number,
                        severity="ERROR",
                        code="GROUP_VALIDATION",
                        field=grouping_column,
                        message=f"Group '{group_key}': {exc}"[:500],
                    )
                )
            continue
        duplicate_key = _import_duplicate_key(values)
        existing = db.scalar(
            select(CanonicalTrade).where(
                CanonicalTrade.user_id == user_id,
                CanonicalTrade.account_id == account.id,
                CanonicalTrade.duplicate_key == duplicate_key,
            )
        )
        if existing is not None:
            for _row_number, _source, _parsed, import_row in items:
                import_row.status = "DUPLICATE"
                import_row.duplicate_key = duplicate_key
                import_row.trade_id = existing.id
                run.duplicate_rows += 1
            continue

        source_ref = f"csv:{run.id}:{_digest(group_key)[:24]}"
        trade = CanonicalTrade(
            user_id=user_id,
            account_id=account.id,
            import_run_id=run.id,
            source_type="CSV_IMPORT",
            source_ref=source_ref,
            duplicate_key=duplicate_key,
            entry_type="TAKEN",
            status="CLOSED",
            symbol=values["symbol"],
            source_symbol=values["source_symbol"],
            currency=values["currency"],
            source_timezone=payload.source_timezone,
            side=values["side"],
            entry_time=values["entry_time"],
            exit_time=values["exit_time"],
            entry_price=values["entry_price"],
            exit_price=values["exit_price"],
            quantity=values["quantity"],
            remaining_quantity=Decimal("0"),
            gross_pnl=values["gross_pnl"],
            net_pnl=values["net_pnl"],
            commission=values["commission"],
            fees=values["fees"],
            stop_loss=values["stop_loss"],
            take_profit=values["take_profit"],
            r_multiple=values["r_multiple"],
            strategy_name=values["strategy_name"],
            reviewed=False,
        )
        db.add(trade)
        db.flush()
        imported_trades.append(trade.id)
        for tag_name in values["tags"]:
            tag, _created = _ensure_tag(db, user_id, "MISTAKE", tag_name)
            db.add(CanonicalTradeTag(user_id=user_id, trade=trade, tag=tag))
        _add_trade_note(db, trade, user_id, values["notes"], kind="IMPORT")
        sequence = 0
        for row_number, source_row, parsed, import_row in items:
            half_commission = parsed["commission_amount"] / Decimal("2")
            half_fees = parsed["fee_amount"] / Decimal("2")
            entry_side = "BUY" if parsed["side"] == "LONG" else "SELL"
            exit_side = "SELL" if parsed["side"] == "LONG" else "BUY"
            _append_execution(
                db,
                trade,
                user_id,
                "CSV_IMPORT",
                f"{source_ref}:row:{row_number}:entry",
                "ENTRY",
                entry_side,
                parsed["entry_time"],
                parsed["entry_price"],
                parsed["quantity"],
                half_commission,
                half_fees,
                sequence,
                raw_payload=source_row,
            )
            sequence += 1
            _append_execution(
                db,
                trade,
                user_id,
                "CSV_IMPORT",
                f"{source_ref}:row:{row_number}:exit",
                "EXIT",
                exit_side,
                parsed["exit_time"],
                parsed["exit_price"],
                parsed["quantity"],
                parsed["commission_amount"] - half_commission,
                parsed["fee_amount"] - half_fees,
                sequence,
                raw_payload=source_row,
            )
            sequence += 1
            import_row.status = "IMPORTED"
            import_row.duplicate_key = duplicate_key
            import_row.trade_id = trade.id
            run.imported_rows += 1

    run.status = "COMPLETED"
    run.completed_at = utcnow()
    db.commit()
    refreshed_run = _owned_import_run(db, user_id, run.id)
    trades = [_trade_read(_owned_trade(db, user_id, trade_id)) for trade_id in imported_trades]
    return JournalImportResult(run=_import_run_read(refreshed_run), trades=trades)


def list_import_runs(
    db: Session,
    user_id: int,
    *,
    account_id: int | None = None,
    offset: int = 0,
    limit: int = 50,
) -> list[JournalImportRunRead]:
    statement = _import_run_statement(user_id)
    if account_id is not None:
        _owned_account(db, user_id, account_id)
        statement = statement.where(JournalImportRun.account_id == account_id)
    rows = db.scalars(
        statement.order_by(JournalImportRun.created_at.desc(), JournalImportRun.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    return [_import_run_read(row) for row in rows]


def get_import_run(db: Session, user_id: int, run_id: int) -> JournalImportRunRead:
    return _import_run_read(_owned_import_run(db, user_id, run_id))


def rollback_import(db: Session, user_id: int, run_id: int) -> JournalImportRunRead:
    run = _owned_import_run(db, user_id, run_id)
    if run.status == "ROLLED_BACK":
        return _import_run_read(run)
    if run.status != "COMPLETED":
        raise JournalConflictError("Only a completed Journal import can be rolled back")
    imported_trade_ids = list(
        db.scalars(
            select(CanonicalTrade.id).where(
                CanonicalTrade.user_id == user_id,
                CanonicalTrade.import_run_id == run.id,
            )
        ).all()
    )
    for import_row in run.rows:
        if import_row.trade_id in imported_trade_ids and import_row.status == "IMPORTED":
            import_row.trade_id = None
            import_row.status = "ROLLED_BACK"
    db.flush()
    if imported_trade_ids:
        db.execute(
            update(JournalImportRow)
            .where(
                JournalImportRow.user_id == user_id,
                JournalImportRow.trade_id.in_(imported_trade_ids),
            )
            .values(trade_id=None)
        )
        imported_trades = db.scalars(
            _trade_statement(user_id).where(CanonicalTrade.id.in_(imported_trade_ids))
        ).all()
        for trade in imported_trades:
            db.delete(trade)
    run.status = "ROLLED_BACK"
    run.rolled_back_at = utcnow()
    db.commit()
    return _import_run_read(_owned_import_run(db, user_id, run.id))


def _ensure_source_account(
    db: Session,
    user_id: int,
    *,
    source_type: str,
    source_key: str,
    name: str,
    provider: str,
    currency: str | None,
    timezone_name: str | None,
    initial_balance: Any = 0,
    color: str | None = None,
    notes: str | None = None,
    status: str = "ACTIVE",
    broker_account_id: int | None = None,
) -> tuple[JournalAccount, bool]:
    row = None
    if broker_account_id is not None:
        row = db.scalar(
            select(JournalAccount).where(
                JournalAccount.user_id == user_id,
                JournalAccount.broker_account_id == broker_account_id,
            )
        )
    if row is None:
        row = db.scalar(
            select(JournalAccount).where(
                JournalAccount.user_id == user_id,
                JournalAccount.source_key == source_key,
            )
        )
    if row is not None:
        return row, False
    timezone_value = timezone_name or "UTC"
    try:
        ZoneInfo(timezone_value)
    except Exception:
        timezone_value = "UTC"
    row = JournalAccount(
        user_id=user_id,
        broker_account_id=broker_account_id,
        source_type=source_type,
        source_key=source_key,
        name=(name or "Journal Account")[:160],
        provider=(provider or "Manual")[:80],
        currency=normalize_currency(currency),
        timezone=timezone_value,
        initial_balance=max(_decimal(initial_balance), Decimal("0")),
        color=color,
        notes=notes,
        status="ARCHIVED" if status == "ARCHIVED" else "ACTIVE",
    )
    db.add(row)
    db.flush()
    return row, True


def _backfilled_trade_exists(db: Session, user_id: int, source_type: str, source_ref: str) -> bool:
    return db.scalar(
        select(CanonicalTrade.id).where(
            CanonicalTrade.user_id == user_id,
            CanonicalTrade.source_type == source_type,
            CanonicalTrade.source_ref == source_ref,
        )
    ) is not None


def _add_backfilled_trade(
    db: Session,
    user_id: int,
    account: JournalAccount,
    *,
    source_type: str,
    source_ref: str,
    entry_type: str,
    status: str,
    symbol: str | None,
    source_symbol: str | None,
    currency: str | None,
    source_timezone: str,
    side: str,
    entry_time: datetime,
    exit_time: datetime | None,
    entry_price: Decimal,
    exit_price: Decimal | None,
    quantity: Decimal,
    remaining_quantity: Decimal,
    gross_pnl: Decimal,
    net_pnl: Decimal,
    commission: Decimal,
    fees: Decimal,
    stop_loss: Decimal | None = None,
    take_profit: Decimal | None = None,
    planned_entry_price: Decimal | None = None,
    planned_exit_price: Decimal | None = None,
    planned_stop_loss: Decimal | None = None,
    planned_take_profit: Decimal | None = None,
    r_multiple: Decimal | None = None,
    strategy_name: str | None = None,
    emotional_state: str | None = None,
    missed_reason: str | None = None,
    reviewed: bool = False,
    rating: int | None = None,
    setup_grade: str | None = None,
    tag_names: Iterable[str] = (),
    note_values: Iterable[tuple[str, str | None]] = (),
    screenshot_urls: Iterable[str | None] = (),
) -> tuple[CanonicalTrade, int, int, int, int]:
    trade = CanonicalTrade(
        user_id=user_id,
        account_id=account.id,
        source_type=source_type,
        source_ref=source_ref,
        duplicate_key=_digest(source_ref),
        entry_type=entry_type,
        status=status,
        symbol=normalize_symbol(symbol),
        source_symbol=source_symbol,
        currency=normalize_currency(currency, account.currency),
        source_timezone=source_timezone,
        side="SHORT" if str(side).upper() == "SHORT" else "LONG",
        entry_time=entry_time,
        exit_time=exit_time,
        entry_price=entry_price,
        exit_price=exit_price,
        quantity=max(quantity, Decimal("0")),
        remaining_quantity=max(remaining_quantity, Decimal("0")),
        gross_pnl=gross_pnl,
        net_pnl=net_pnl,
        commission=max(commission, Decimal("0")),
        fees=max(fees, Decimal("0")),
        stop_loss=stop_loss,
        take_profit=take_profit,
        planned_entry_price=planned_entry_price,
        planned_exit_price=planned_exit_price,
        planned_stop_loss=planned_stop_loss,
        planned_take_profit=planned_take_profit,
        r_multiple=r_multiple,
        strategy_name=strategy_name,
        emotional_state=emotional_state,
        missed_reason=missed_reason,
        reviewed=reviewed,
        reviewed_at=utcnow() if reviewed else None,
        rating=rating if rating in {1, 2, 3, 4, 5} else None,
        setup_grade=setup_grade if setup_grade in {"A+", "A", "B", "C", "D", "F"} else None,
    )
    db.add(trade)
    db.flush()
    tag_count = 0
    for tag_name in dict.fromkeys(str(value).strip() for value in tag_names if str(value).strip()):
        tag, created = _ensure_tag(db, user_id, "MISTAKE", tag_name)
        db.add(CanonicalTradeTag(user_id=user_id, trade=trade, tag=tag))
        tag_count += int(created)
    note_count = sum(
        int(_add_trade_note(db, trade, user_id, body, kind=kind))
        for kind, body in note_values
    )
    screenshot_count = sum(
        int(_add_screenshot(db, trade, user_id, url))
        for url in screenshot_urls
    )
    execution_count = 0
    if entry_type == "TAKEN" and quantity > 0 and entry_price > 0:
        entry_side = "BUY" if trade.side == "LONG" else "SELL"
        exit_side = "SELL" if trade.side == "LONG" else "BUY"
        _append_execution(
            db,
            trade,
            user_id,
            source_type,
            f"{source_ref}:entry",
            "ENTRY",
            entry_side,
            entry_time,
            entry_price,
            quantity,
            commission / 2,
            fees / 2,
            0,
            raw_payload={"migrated_from": source_ref},
        )
        execution_count += 1
        closed_quantity = max(quantity - remaining_quantity, Decimal("0"))
        if exit_time is not None and exit_price is not None and closed_quantity > 0:
            _append_execution(
                db,
                trade,
                user_id,
                source_type,
                f"{source_ref}:exit",
                "EXIT",
                exit_side,
                exit_time,
                exit_price,
                closed_quantity,
                commission - commission / 2,
                fees - fees / 2,
                1,
                raw_payload={"migrated_from": source_ref},
            )
            execution_count += 1
    return trade, execution_count, note_count, screenshot_count, tag_count


def _checkpoint(
    db: Session,
    user_id: int,
    source_key: str,
    source_digest: str,
    stats: JournalBackfillResult,
) -> None:
    row = db.scalar(
        select(JournalBackfillCheckpoint).where(
            JournalBackfillCheckpoint.user_id == user_id,
            JournalBackfillCheckpoint.source_key == source_key,
        )
    )
    if row is None:
        row = JournalBackfillCheckpoint(
            user_id=user_id,
            source_key=source_key,
            source_digest=source_digest,
        )
        db.add(row)
    elif row.source_digest == source_digest:
        stats.sources_unchanged += 1
    row.source_digest = source_digest
    row.accounts_created = stats.accounts_created
    row.trades_created = stats.trades_created
    row.diagnostics = list(stats.diagnostics)
    row.completed_at = utcnow()


def _legacy_tag_names(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip()[:80] for item in value if str(item).strip()]
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except Exception:
            decoded = re.split(r"[;,|]", value)
        if isinstance(decoded, list):
            return [str(item).strip()[:80] for item in decoded if str(item).strip()]
    return []


def _backfill_live_journal(
    db: Session,
    user_id: int,
    value: Any,
    stats: JournalBackfillResult,
) -> None:
    if not isinstance(value, dict):
        stats.diagnostics.append("Legacy live-journal storage is not an object; no rows were migrated")
        return
    raw_accounts = value.get("accounts") if isinstance(value.get("accounts"), list) else []
    raw_sessions = value.get("sessions") if isinstance(value.get("sessions"), list) else []
    raw_trades = value.get("trades") if isinstance(value.get("trades"), list) else []
    account_by_legacy_id: dict[str, JournalAccount] = {}
    for raw_account in raw_accounts:
        if not isinstance(raw_account, dict) or raw_account.get("id") is None:
            continue
        legacy_id = str(raw_account["id"])
        account, created = _ensure_source_account(
            db,
            user_id,
            source_type="APP_STORAGE",
            source_key=f"app-storage:account:{legacy_id}",
            name=str(raw_account.get("name") or f"Journal Account {legacy_id}"),
            provider=str(raw_account.get("broker") or "Manual"),
            currency=str(raw_account.get("currency") or "USD"),
            timezone_name="UTC",
            initial_balance=raw_account.get("initial_balance", 0),
            color=raw_account.get("color"),
            notes=raw_account.get("notes"),
            status=str(raw_account.get("status") or "ACTIVE"),
        )
        account_by_legacy_id[legacy_id] = account
        stats.accounts_created += int(created)

    session_by_id = {
        str(row.get("id")): row
        for row in raw_sessions
        if isinstance(row, dict) and row.get("id") is not None
    }
    for raw_trade in raw_trades:
        if not isinstance(raw_trade, dict) or raw_trade.get("id") is None:
            continue
        legacy_trade_id = str(raw_trade["id"])
        session = session_by_id.get(str(raw_trade.get("session_id")), {})
        raw_account_ids = raw_trade.get("account_ids")
        account_ids = [str(value) for value in raw_account_ids] if isinstance(raw_account_ids, list) else []
        target_accounts = [account_by_legacy_id[item] for item in account_ids if item in account_by_legacy_id]
        if not target_accounts:
            fallback_key = f"app-storage:session:{raw_trade.get('session_id', 'unassigned')}"
            fallback, created = _ensure_source_account(
                db,
                user_id,
                source_type="APP_STORAGE",
                source_key=fallback_key,
                name=str(session.get("name") or session.get("account") or "Legacy Journal"),
                provider=str(session.get("account") or "Manual"),
                currency=str(session.get("currency") or "USD"),
                timezone_name="UTC",
                initial_balance=session.get("initial_balance", 0),
                notes=session.get("notes"),
                status=str(session.get("status") or "ACTIVE"),
            )
            target_accounts = [fallback]
            stats.accounts_created += int(created)
        for account in target_accounts:
            source_ref = f"app-storage:trade:{legacy_trade_id}:account:{account.source_key}"
            if _backfilled_trade_exists(db, user_id, "APP_STORAGE", source_ref):
                continue
            entry_type = "MISSED" if raw_trade.get("journal_entry_type") == "MISSED" else "TAKEN"
            entry_price = _decimal(raw_trade.get("entry_price") or raw_trade.get("planned_entry_price"))
            exit_price = _optional_decimal(raw_trade.get("exit_price") or raw_trade.get("planned_exit_price"))
            quantity = _decimal(raw_trade.get("quantity"))
            remaining = _decimal(raw_trade.get("remaining_quantity"))
            entry_time = _parse_legacy_datetime(raw_trade.get("entry_time"))
            exit_time = (
                _parse_legacy_datetime(raw_trade.get("exit_time"), entry_time)
                if raw_trade.get("exit_time")
                else None
            )
            gross = _decimal(raw_trade.get("gross_pnl"), _decimal(raw_trade.get("realized_pnl")))
            net = _decimal(raw_trade.get("realized_pnl"))
            commission = max(_decimal(raw_trade.get("commission_amount")), Decimal("0"))
            fees = max(_decimal(raw_trade.get("fee_amount")), Decimal("0"))
            _trade, executions, notes, screenshots, tags = _add_backfilled_trade(
                db,
                user_id,
                account,
                source_type="APP_STORAGE",
                source_ref=source_ref,
                entry_type=entry_type,
                status="MISSED" if entry_type == "MISSED" else "CLOSED" if exit_time else "OPEN",
                symbol=str(session.get("instrument") or session.get("symbol") or "MANUAL"),
                source_symbol=str(session.get("instrument") or "") or None,
                currency=str(session.get("currency") or account.currency),
                source_timezone="UTC",
                side=str(raw_trade.get("side") or "LONG"),
                entry_time=entry_time,
                exit_time=exit_time,
                entry_price=entry_price,
                exit_price=exit_price,
                quantity=quantity,
                remaining_quantity=remaining,
                gross_pnl=Decimal("0") if entry_type == "MISSED" else gross,
                net_pnl=Decimal("0") if entry_type == "MISSED" else net,
                commission=commission,
                fees=fees,
                stop_loss=_optional_decimal(raw_trade.get("stop_loss")),
                take_profit=_optional_decimal(raw_trade.get("take_profit")),
                planned_entry_price=_optional_decimal(raw_trade.get("planned_entry_price")),
                planned_exit_price=_optional_decimal(raw_trade.get("planned_exit_price")),
                planned_stop_loss=_optional_decimal(raw_trade.get("planned_stop_loss")),
                planned_take_profit=_optional_decimal(raw_trade.get("planned_take_profit")),
                r_multiple=_optional_decimal(raw_trade.get("r_multiple")),
                strategy_name=raw_trade.get("strategy_name") or session.get("strategy_name"),
                emotional_state=raw_trade.get("emotional_state"),
                missed_reason=raw_trade.get("missed_reason"),
                reviewed=bool(raw_trade.get("reviewed", False)),
                rating=raw_trade.get("rating"),
                setup_grade=raw_trade.get("setup_grade"),
                tag_names=_legacy_tag_names(raw_trade.get("mistake_tags")),
                note_values=(("LEGACY", raw_trade.get("notes")),),
                screenshot_urls=(raw_trade.get("screenshot_url"),),
            )
            stats.trades_created += 1
            stats.executions_created += executions
            stats.notes_created += notes
            stats.screenshots_created += screenshots
            stats.tags_created += tags


def _backfill_backtests(db: Session, user_id: int, stats: JournalBackfillResult) -> None:
    sessions = db.scalars(
        select(BacktestSession)
        .where(BacktestSession.user_id == user_id)
        .order_by(BacktestSession.id.asc())
    ).all()
    for session in sessions:
        account, created = _ensure_source_account(
            db,
            user_id,
            source_type="BACKTEST",
            source_key=f"backtest-session:{session.id}",
            name=session.name,
            provider="Backtest",
            currency=session.currency or "USD",
            timezone_name=session.timezone or "UTC",
            initial_balance=session.initial_balance,
            status="ARCHIVED" if session.status == "COMPLETE" else "ACTIVE",
        )
        stats.accounts_created += int(created)
        trades = db.scalars(
            select(Trade)
            .where(Trade.user_id == user_id, Trade.session_id == session.id)
            .order_by(Trade.id.asc())
        ).all()
        for legacy in trades:
            source_ref = f"backtest-trade:{legacy.id}"
            if _backfilled_trade_exists(db, user_id, "BACKTEST", source_ref):
                continue
            note_values: list[tuple[str, str | None]] = [("BACKTEST", legacy.notes)]
            note_values.extend(
                ("BACKTEST_HISTORY", note.notes)
                for note in db.scalars(
                    select(TradeNote).where(
                        TradeNote.user_id == user_id,
                        TradeNote.trade_id == legacy.id,
                    )
                ).all()
            )
            gross = _decimal(legacy.gross_pnl, _decimal(legacy.realized_pnl))
            _trade, executions, notes, screenshots, tags = _add_backfilled_trade(
                db,
                user_id,
                account,
                source_type="BACKTEST",
                source_ref=source_ref,
                entry_type="TAKEN",
                status="CLOSED" if legacy.status == "CLOSED" else "OPEN",
                symbol=session.symbol,
                source_symbol=session.symbol,
                currency=session.currency or account.currency,
                source_timezone=session.timezone or "UTC",
                side=legacy.side,
                entry_time=_parse_legacy_datetime(legacy.entry_time),
                exit_time=_parse_legacy_datetime(legacy.exit_time) if legacy.exit_time else None,
                entry_price=_decimal(legacy.entry_price),
                exit_price=_optional_decimal(legacy.exit_price),
                quantity=_decimal(legacy.quantity),
                remaining_quantity=_decimal(legacy.remaining_quantity),
                gross_pnl=gross,
                net_pnl=_decimal(legacy.realized_pnl),
                commission=_decimal(legacy.commission_amount),
                fees=_decimal(legacy.fee_amount),
                stop_loss=_optional_decimal(legacy.stop_loss),
                take_profit=_optional_decimal(legacy.take_profit),
                r_multiple=_optional_decimal(legacy.r_multiple),
                strategy_name=legacy.strategy_name or session.strategy_name,
                emotional_state=legacy.emotional_state,
                tag_names=_legacy_tag_names(legacy.mistake_tags),
                note_values=note_values,
                screenshot_urls=(legacy.screenshot_url,),
            )
            stats.trades_created += 1
            stats.executions_created += executions
            stats.notes_created += notes
            stats.screenshots_created += screenshots
            stats.tags_created += tags


def _broker_fill_cycles(fills: list[BrokerFill]) -> list[list[dict[str, Any]]]:
    cycles: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    signed_position = Decimal("0")
    for fill in fills:
        full_quantity = _decimal(fill.quantity)
        remaining = full_quantity
        direction = Decimal("1") if fill.side == "BUY" else Decimal("-1")
        part = 0
        while remaining > 0:
            if signed_position == 0 or (signed_position > 0) == (direction > 0):
                piece_quantity = remaining
            else:
                piece_quantity = min(abs(signed_position), remaining)
            fraction = piece_quantity / full_quantity
            current.append(
                {
                    "fill": fill,
                    "part": part,
                    "side": fill.side,
                    "quantity": piece_quantity,
                    "price": _decimal(fill.price),
                    "commission": _decimal(fill.commission) * fraction,
                    "fees": _decimal(fill.fees) * fraction,
                }
            )
            signed_position += direction * piece_quantity
            remaining -= piece_quantity
            part += 1
            if signed_position == 0:
                cycles.append(current)
                current = []
    if current:
        cycles.append(current)
    return cycles


def _broker_cycle_values(pieces: list[dict[str, Any]]) -> dict[str, Any]:
    first_direction = Decimal("1") if pieces[0]["side"] == "BUY" else Decimal("-1")
    signed_position = Decimal("0")
    average_entry: Decimal | None = None
    gross = Decimal("0")
    for piece in pieces:
        piece_direction = Decimal("1") if piece["side"] == "BUY" else Decimal("-1")
        quantity = piece["quantity"]
        price = piece["price"]
        if signed_position == 0 or (signed_position > 0) == (piece_direction > 0):
            old_quantity = abs(signed_position)
            new_quantity = old_quantity + quantity
            average_entry = (
                ((average_entry or Decimal("0")) * old_quantity + price * quantity)
                / new_quantity
            )
            signed_position += piece_direction * quantity
        else:
            closing = min(abs(signed_position), quantity)
            position_direction = Decimal("1") if signed_position > 0 else Decimal("-1")
            gross += (price - (average_entry or Decimal("0"))) * closing * position_direction
            signed_position += piece_direction * closing
            if signed_position == 0:
                average_entry = None
    entry_pieces = [
        piece
        for piece in pieces
        if (Decimal("1") if piece["side"] == "BUY" else Decimal("-1")) == first_direction
    ]
    exit_pieces = [piece for piece in pieces if piece not in entry_pieces]
    entry_quantity = sum((piece["quantity"] for piece in entry_pieces), Decimal("0"))
    exit_quantity = sum((piece["quantity"] for piece in exit_pieces), Decimal("0"))
    weighted_entry = sum((piece["price"] * piece["quantity"] for piece in entry_pieces), Decimal("0")) / entry_quantity
    weighted_exit = (
        sum((piece["price"] * piece["quantity"] for piece in exit_pieces), Decimal("0")) / exit_quantity
        if exit_quantity > 0
        else None
    )
    commission = sum((piece["commission"] for piece in pieces), Decimal("0"))
    fees = sum((piece["fees"] for piece in pieces), Decimal("0"))
    return {
        "side": "LONG" if first_direction > 0 else "SHORT",
        "entry_time": pieces[0]["fill"].executed_at,
        "exit_time": pieces[-1]["fill"].executed_at if signed_position == 0 else None,
        "entry_price": _quantize(weighted_entry),
        "exit_price": _quantize(weighted_exit) if weighted_exit is not None else None,
        "quantity": _quantize(entry_quantity),
        "remaining_quantity": _quantize(abs(signed_position)),
        "gross_pnl": _quantize(gross),
        "commission": _quantize(commission),
        "fees": _quantize(fees),
        "net_pnl": _quantize(gross - commission - fees),
        "status": "CLOSED" if signed_position == 0 else "OPEN",
    }


def sync_broker_connection(
    db: Session,
    user_id: int,
    connection_id: int,
    *,
    commit: bool = True,
) -> tuple[int, int]:
    connection = db.scalar(
        select(BrokerConnection).where(
            BrokerConnection.id == connection_id,
            BrokerConnection.user_id == user_id,
        )
    )
    if connection is None:
        raise JournalNotFoundError("Broker connection not found")
    broker_accounts = db.scalars(
        select(BrokerAccount).where(
            BrokerAccount.user_id == user_id,
            BrokerAccount.connection_id == connection.id,
        )
    ).all()
    trade_count = 0
    execution_count = 0
    seen_refs: set[str] = set()
    for broker_account in broker_accounts:
        account, _created = _ensure_source_account(
            db,
            user_id,
            source_type="BROKER",
            source_key=f"broker-account:{broker_account.id}",
            name=broker_account.display_name,
            provider=connection.provider,
            currency=broker_account.currency,
            timezone_name="UTC",
            broker_account_id=broker_account.id,
            status="ARCHIVED" if broker_account.status != "ACTIVE" else "ACTIVE",
        )
        fills = db.scalars(
            select(BrokerFill)
            .where(
                BrokerFill.user_id == user_id,
                BrokerFill.connection_id == connection.id,
                BrokerFill.account_id == broker_account.id,
                BrokerFill.cancelled.is_(False),
            )
            .order_by(BrokerFill.symbol.asc(), BrokerFill.executed_at.asc(), BrokerFill.external_fill_id.asc())
        ).all()
        by_symbol: dict[str, list[BrokerFill]] = defaultdict(list)
        for fill in fills:
            by_symbol[fill.symbol].append(fill)
        for symbol, symbol_fills in by_symbol.items():
            for cycle_index, pieces in enumerate(_broker_fill_cycles(symbol_fills)):
                values = _broker_cycle_values(pieces)
                first_fill = pieces[0]["fill"]
                source_ref = (
                    f"broker:{connection.id}:{broker_account.id}:{normalize_symbol(symbol)}:"
                    f"{first_fill.external_fill_id}:{cycle_index}"
                )
                seen_refs.add(source_ref)
                trade = db.scalar(
                    select(CanonicalTrade).where(
                        CanonicalTrade.user_id == user_id,
                        CanonicalTrade.source_type == "BROKER",
                        CanonicalTrade.source_ref == source_ref,
                    )
                )
                if trade is None:
                    trade = CanonicalTrade(
                        user_id=user_id,
                        account_id=account.id,
                        source_type="BROKER",
                        source_ref=source_ref,
                        duplicate_key=_digest(source_ref),
                        entry_type="TAKEN",
                        symbol=normalize_symbol(symbol),
                        source_symbol=symbol,
                        currency=account.currency,
                        source_timezone="UTC",
                        reviewed=False,
                        **values,
                    )
                    db.add(trade)
                    db.flush()
                    trade_count += 1
                else:
                    for field, value in values.items():
                        setattr(trade, field, value)
                    trade.status = values["status"]
                    trade.updated_at = utcnow()
                existing_fingerprints = set(
                    db.scalars(
                        select(CanonicalExecution.fingerprint).where(
                            CanonicalExecution.user_id == user_id,
                            CanonicalExecution.trade_id == trade.id,
                        )
                    ).all()
                )
                for sequence, piece in enumerate(pieces):
                    fill = piece["fill"]
                    fingerprint = _digest(
                        {
                            "provider_fingerprint": fill.fingerprint,
                            "revision": fill.source_revision,
                            "part": piece["part"],
                            "quantity": piece["quantity"],
                            "commission": piece["commission"],
                            "fees": piece["fees"],
                        }
                    )
                    if fingerprint in existing_fingerprints:
                        continue
                    _append_execution(
                        db,
                        trade,
                        user_id,
                        "BROKER",
                        f"broker-fill:{fill.external_fill_id}:r{fill.source_revision}:p{piece['part']}",
                        "FILL",
                        fill.side,
                        fill.executed_at,
                        piece["price"],
                        piece["quantity"],
                        piece["commission"],
                        piece["fees"],
                        sequence,
                        fill.source_revision,
                        raw_payload={
                            "external_fill_id": fill.external_fill_id,
                            "external_order_id": fill.external_order_id,
                            "provider_updated_at": fill.provider_updated_at.isoformat(),
                            "cancelled": fill.cancelled,
                        },
                        fingerprint=fingerprint,
                    )
                    execution_count += 1
    prefix = f"broker:{connection.id}:"
    existing_broker_trades = db.scalars(
        select(CanonicalTrade).where(
            CanonicalTrade.user_id == user_id,
            CanonicalTrade.source_type == "BROKER",
            CanonicalTrade.source_ref.like(f"{prefix}%"),
        )
    ).all()
    for trade in existing_broker_trades:
        if trade.source_ref not in seen_refs:
            trade.status = "VOIDED"
            trade.updated_at = utcnow()
    if commit:
        db.commit()
    else:
        db.flush()
    return trade_count, execution_count


def backfill_legacy_journal(db: Session, user_id: int) -> JournalBackfillResult:
    stats = JournalBackfillResult()
    storage = db.scalar(
        select(AppStorageItem).where(
            AppStorageItem.user_id == user_id,
            AppStorageItem.namespace == LIVE_JOURNAL_NAMESPACE,
            AppStorageItem.key == LIVE_JOURNAL_KEY,
        )
    )
    if storage is not None and storage.value is not None:
        digest = _digest(storage.value)
        _backfill_live_journal(db, user_id, storage.value, stats)
        _checkpoint(db, user_id, f"app-storage:{LIVE_JOURNAL_NAMESPACE}:{LIVE_JOURNAL_KEY}", digest, stats)

    backtest_fingerprint = [
        (row.id, row.updated_at.isoformat() if row.updated_at else None)
        for row in db.scalars(
            select(BacktestSession)
            .where(BacktestSession.user_id == user_id)
            .order_by(BacktestSession.id.asc())
        ).all()
    ]
    _backfill_backtests(db, user_id, stats)
    _checkpoint(db, user_id, "backtest-sessions", _digest(backtest_fingerprint), stats)
    connection_ids = db.scalars(
        select(BrokerConnection.id).where(BrokerConnection.user_id == user_id)
    ).all()
    for connection_id in connection_ids:
        trades, executions = sync_broker_connection(
            db,
            user_id,
            connection_id,
            commit=False,
        )
        stats.trades_created += trades
        stats.executions_created += executions
    db.commit()
    return stats
