from __future__ import annotations

from collections import defaultdict, deque
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR
from hashlib import sha256
import json
from threading import RLock
from typing import Any, Protocol
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    ContinuousContractRule,
    ExchangeCalendar,
    MarketAlertEvent,
    MarketAlertRule,
    MarketBackfillRun,
    MarketContract,
    MarketDataDiagnostic,
    MarketDataEntitlement,
    MarketInstrument,
    MarketInstrumentIdentifier,
    MarketProviderState,
    MarketTradeTick,
    NormalizedCandle,
    OrderBookLevel,
    OrderBookSnapshot,
    PersistedFootprint,
    PersistedFootprintLevel,
    utcnow,
)
from app.schemas import (
    ContinuousContractRuleCreate,
    ContinuousContractRuleRead,
    ExchangeCalendarCreate,
    ExchangeCalendarRead,
    ExchangeSessionTemplate,
    FootprintLevelRead,
    FootprintRead,
    MarketAlertEventRead,
    MarketAlertRuleCreate,
    MarketAlertRuleRead,
    MarketBackfillCreate,
    MarketBackfillRead,
    MarketContractCreate,
    MarketContractRead,
    MarketDiagnosticRead,
    MarketEntitlementRead,
    MarketInstrumentCreate,
    MarketInstrumentRead,
    MarketIdentifierRead,
    MarketProviderRead,
    MarketProviderStateRead,
    MarketStreamEventRead,
    MarketSubscriptionCreate,
    MarketSubscriptionRead,
    MarketTradeTickRead,
    NormalizedCandleRead,
    OrderBookLevelInput,
    OrderBookLevelRead,
    OrderBookRead,
)
from app.services.order_flow import AggressorSide, OrderFlowTrade, aggregate_order_flow


UTC = timezone.utc
FREE_ORDER_FLOW_CLASSES = frozenset({"CRYPTO", "EQUITY", "ETF"})
ORDER_FLOW_CAPABILITIES = frozenset({"TRADES", "DEPTH", "FOOTPRINT"})
ALL_CAPABILITIES = ("CANDLES", "TRADES", "DEPTH", "FOOTPRINT")


class MarketInfrastructureError(Exception):
    status_code = 400
    public_message = "Market-data request could not be completed"

    def __init__(self, public_message: str | None = None):
        super().__init__(public_message or self.public_message)
        if public_message:
            self.public_message = public_message


class MarketNotFoundError(MarketInfrastructureError):
    status_code = 404
    public_message = "Market-data record not found"


class MarketConflictError(MarketInfrastructureError):
    status_code = 409


class MarketEntitlementError(MarketInfrastructureError):
    status_code = 403


class MarketProviderUnavailableError(MarketInfrastructureError):
    status_code = 503


@dataclass(frozen=True, slots=True)
class ProviderCapabilities:
    provider_id: str
    display_name: str
    availability: str
    capabilities: tuple[str, ...]
    asset_classes: tuple[str, ...]
    live: bool
    licensed: bool
    message: str


@dataclass(frozen=True, slots=True)
class ProviderInstrument:
    canonical_symbol: str
    provider_symbol: str
    display_name: str
    asset_class: str
    instrument_type: str
    exchange: str | None
    currency: str
    timezone: str
    tick_size: Decimal
    tick_value: Decimal
    contract_multiplier: Decimal = Decimal("1")


@dataclass(frozen=True, slots=True)
class CandleRecord:
    start_at: datetime
    interval_seconds: int
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal
    sequence_start: int | None = None
    sequence_end: int | None = None
    source_revision: int = 1
    complete: bool = True


@dataclass(frozen=True, slots=True)
class TradeTickRecord:
    external_trade_id: str
    sequence: int
    exchange_timestamp: datetime
    price: Decimal
    size: Decimal
    aggressor_side: str = "UNKNOWN"
    source_revision: int = 1
    cancelled: bool = False


@dataclass(frozen=True, slots=True)
class DepthSnapshotRecord:
    sequence: int
    captured_at: datetime
    levels: tuple[OrderBookLevelInput, ...]
    complete: bool = True


class MarketDataProviderAdapter(Protocol):
    capabilities: ProviderCapabilities

    def instruments(self) -> Sequence[ProviderInstrument]: ...

    def historical_candles(
        self, provider_symbol: str, from_at: datetime, to_at: datetime, interval_seconds: int
    ) -> Sequence[CandleRecord]: ...

    def historical_trades(
        self, provider_symbol: str, from_at: datetime, to_at: datetime
    ) -> Sequence[TradeTickRecord]: ...

    def historical_depth(
        self, provider_symbol: str, from_at: datetime, to_at: datetime
    ) -> Sequence[DepthSnapshotRecord]: ...


class OfflineFixtureAdapter:
    """Deterministic local adapter. It never represents a live or licensed feed."""

    capabilities = ProviderCapabilities(
        provider_id="offline-fixture",
        display_name="Offline deterministic fixture",
        availability="AVAILABLE_OFFLINE",
        capabilities=ALL_CAPABILITIES,
        asset_classes=("CRYPTO", "EQUITY", "ETF", "FUTURE"),
        live=False,
        licensed=False,
        message="Deterministic local records for development and tests; no live market connectivity.",
    )

    def __init__(
        self,
        *,
        instruments: Sequence[ProviderInstrument] | None = None,
        candles: Mapping[str, Sequence[CandleRecord]] | None = None,
        trades: Mapping[str, Sequence[TradeTickRecord]] | None = None,
        depth: Mapping[str, Sequence[DepthSnapshotRecord]] | None = None,
    ) -> None:
        self._instruments = tuple(instruments or ())
        self._candles = {key: tuple(value) for key, value in (candles or {}).items()}
        self._trades = {key: tuple(value) for key, value in (trades or {}).items()}
        self._depth = {key: tuple(value) for key, value in (depth or {}).items()}

    def instruments(self) -> Sequence[ProviderInstrument]:
        return self._instruments

    def historical_candles(
        self, provider_symbol: str, from_at: datetime, to_at: datetime, interval_seconds: int
    ) -> Sequence[CandleRecord]:
        return tuple(
            row
            for row in self._candles.get(provider_symbol, ())
            if row.interval_seconds == interval_seconds and from_at <= _utc_naive(row.start_at) < to_at
        )

    def historical_trades(
        self, provider_symbol: str, from_at: datetime, to_at: datetime
    ) -> Sequence[TradeTickRecord]:
        return tuple(
            row
            for row in self._trades.get(provider_symbol, ())
            if from_at <= _utc_naive(row.exchange_timestamp) < to_at
        )

    def historical_depth(
        self, provider_symbol: str, from_at: datetime, to_at: datetime
    ) -> Sequence[DepthSnapshotRecord]:
        return tuple(
            row
            for row in self._depth.get(provider_symbol, ())
            if from_at <= _utc_naive(row.captured_at) < to_at
        )


class UnavailableProviderAdapter:
    def __init__(self, provider_id: str, display_name: str, message: str) -> None:
        self.capabilities = ProviderCapabilities(
            provider_id=provider_id,
            display_name=display_name,
            availability="CONFIGURATION_REQUIRED",
            capabilities=(),
            asset_classes=(),
            live=False,
            licensed=False,
            message=message,
        )

    def instruments(self) -> Sequence[ProviderInstrument]:
        raise MarketProviderUnavailableError(self.capabilities.message)

    def historical_candles(self, *_args) -> Sequence[CandleRecord]:
        raise MarketProviderUnavailableError(self.capabilities.message)

    def historical_trades(self, *_args) -> Sequence[TradeTickRecord]:
        raise MarketProviderUnavailableError(self.capabilities.message)

    def historical_depth(self, *_args) -> Sequence[DepthSnapshotRecord]:
        raise MarketProviderUnavailableError(self.capabilities.message)


class MarketProviderRegistry:
    def __init__(self, adapters: Iterable[MarketDataProviderAdapter] = ()) -> None:
        self._adapters = {adapter.capabilities.provider_id: adapter for adapter in adapters}

    def register(self, adapter: MarketDataProviderAdapter) -> None:
        self._adapters[adapter.capabilities.provider_id] = adapter

    def get(self, provider_id: str) -> MarketDataProviderAdapter:
        adapter = self._adapters.get(provider_id)
        if adapter is None:
            raise MarketProviderUnavailableError(
                f"Provider '{provider_id}' is not configured. Configure a licensed adapter before requesting live data."
            )
        return adapter

    def catalog(self) -> list[MarketProviderRead]:
        return [
            MarketProviderRead(
                provider_id=adapter.capabilities.provider_id,
                display_name=adapter.capabilities.display_name,
                availability=adapter.capabilities.availability,
                capabilities=list(adapter.capabilities.capabilities),
                asset_classes=list(adapter.capabilities.asset_classes),
                live=adapter.capabilities.live,
                licensed=adapter.capabilities.licensed,
                message=adapter.capabilities.message,
            )
            for adapter in sorted(self._adapters.values(), key=lambda value: value.capabilities.provider_id)
        ]


provider_registry = MarketProviderRegistry(
    (
        OfflineFixtureAdapter(),
        UnavailableProviderAdapter(
            "licensed-futures",
            "Licensed futures feed",
            "No licensed futures adapter is configured; CME and other exchange feeds remain unavailable.",
        ),
    )
)


def _utc_naive(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def _decimal(value: Any) -> Decimal:
    try:
        result = Decimal(str(value))
    except Exception as exc:
        raise MarketInfrastructureError(f"Invalid decimal value '{value}'") from exc
    if not result.is_finite():
        raise MarketInfrastructureError("Market-data numeric values must be finite")
    return result


def _hash(value: Any) -> str:
    return sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    ).hexdigest()


def _canonical_symbol(value: str) -> str:
    clean = "".join(character for character in value.strip().upper() if character.isalnum() or character in ".:_-")
    if not clean:
        raise MarketInfrastructureError("canonical_symbol cannot be blank")
    return clean[:96]


def _owned_calendar(db: Session, user_id: int, calendar_id: int) -> ExchangeCalendar:
    row = db.scalar(
        select(ExchangeCalendar).where(
            ExchangeCalendar.id == calendar_id,
            ExchangeCalendar.user_id == user_id,
        )
    )
    if row is None:
        raise MarketNotFoundError("Exchange calendar not found")
    return row


def _owned_instrument(db: Session, user_id: int, instrument_id: int) -> MarketInstrument:
    row = db.scalar(
        select(MarketInstrument)
        .where(MarketInstrument.id == instrument_id, MarketInstrument.user_id == user_id)
        .options(selectinload(MarketInstrument.identifiers), selectinload(MarketInstrument.contracts))
    )
    if row is None:
        raise MarketNotFoundError("Market instrument not found")
    return row


def _instrument_read(row: MarketInstrument) -> MarketInstrumentRead:
    return MarketInstrumentRead(
        id=row.id,
        canonical_symbol=row.canonical_symbol,
        display_name=row.display_name,
        asset_class=row.asset_class,
        instrument_type=row.instrument_type,
        exchange=row.exchange,
        base_asset=row.base_asset,
        quote_asset=row.quote_asset,
        currency=row.currency,
        timezone=row.timezone,
        calendar_id=row.calendar_id,
        tick_size=row.tick_size,
        tick_value=row.tick_value,
        contract_multiplier=row.contract_multiplier,
        continuous=row.continuous,
        active=row.active,
        metadata=dict(row.metadata_json or {}),
        identifiers=[
            MarketIdentifierRead(
                id=item.id,
                provider=item.provider,
                provider_symbol=item.provider_symbol,
                metadata=dict(item.metadata_json or {}),
            )
            for item in row.identifiers
        ],
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def create_exchange_calendar(
    db: Session, user_id: int, payload: ExchangeCalendarCreate
) -> ExchangeCalendarRead:
    code = payload.code.strip().upper()
    if db.scalar(select(ExchangeCalendar.id).where(ExchangeCalendar.user_id == user_id, ExchangeCalendar.code == code)):
        raise MarketConflictError(f"Exchange calendar '{code}' already exists")
    row = ExchangeCalendar(
        user_id=user_id,
        code=code,
        exchange=payload.exchange.strip().upper(),
        timezone=payload.timezone,
        holidays=[value.isoformat() for value in sorted(set(payload.holidays))],
        session_templates=[item.model_dump() for item in payload.session_templates],
        version=1,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _calendar_read(row)


def _calendar_read(row: ExchangeCalendar) -> ExchangeCalendarRead:
    return ExchangeCalendarRead(
        id=row.id,
        code=row.code,
        exchange=row.exchange,
        timezone=row.timezone,
        weekmask=row.weekmask,
        holidays=list(row.holidays or []),
        session_templates=[ExchangeSessionTemplate.model_validate(item) for item in row.session_templates or []],
        version=row.version,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def list_exchange_calendars(db: Session, user_id: int) -> list[ExchangeCalendarRead]:
    return [
        _calendar_read(row)
        for row in db.scalars(
            select(ExchangeCalendar)
            .where(ExchangeCalendar.user_id == user_id)
            .order_by(ExchangeCalendar.code.asc())
        ).all()
    ]


def market_session_at(
    db: Session, user_id: int, calendar_id: int, timestamp: datetime, template_name: str = "RTH"
) -> dict[str, Any]:
    calendar = _owned_calendar(db, user_id, calendar_id)
    local = (timestamp if timestamp.tzinfo else timestamp.replace(tzinfo=UTC)).astimezone(ZoneInfo(calendar.timezone))
    holiday = local.date().isoformat() in set(calendar.holidays or [])
    template = next(
        (item for item in calendar.session_templates or [] if str(item.get("name", "")).upper() == template_name.upper()),
        None,
    )
    if template is None:
        raise MarketNotFoundError(f"Session template '{template_name}' was not found")
    opens = time.fromisoformat(template["opens_at"])
    closes = time.fromisoformat(template["closes_at"])
    weekday_allowed = local.weekday() in set(template.get("weekdays", []))
    if template.get("crosses_midnight"):
        time_allowed = local.time() >= opens or local.time() < closes
    else:
        time_allowed = opens <= local.time() < closes
    return {
        "calendar": calendar.code,
        "template": template["name"],
        "timezone": calendar.timezone,
        "local_timestamp": local.isoformat(),
        "is_holiday": holiday,
        "is_open": bool(not holiday and weekday_allowed and time_allowed),
    }


def create_instrument(db: Session, user_id: int, payload: MarketInstrumentCreate) -> MarketInstrumentRead:
    symbol = _canonical_symbol(payload.canonical_symbol)
    if payload.calendar_id is not None:
        _owned_calendar(db, user_id, payload.calendar_id)
    if db.scalar(select(MarketInstrument.id).where(MarketInstrument.user_id == user_id, MarketInstrument.canonical_symbol == symbol)):
        raise MarketConflictError(f"Instrument '{symbol}' already exists")
    row = MarketInstrument(
        user_id=user_id,
        canonical_symbol=symbol,
        display_name=payload.display_name.strip(),
        asset_class=payload.asset_class,
        instrument_type=payload.instrument_type.strip().upper(),
        exchange=payload.exchange.strip().upper() if payload.exchange else None,
        base_asset=payload.base_asset.strip().upper() if payload.base_asset else None,
        quote_asset=payload.quote_asset.strip().upper() if payload.quote_asset else None,
        currency=payload.currency.strip().upper(),
        timezone=payload.timezone,
        calendar_id=payload.calendar_id,
        tick_size=payload.tick_size,
        tick_value=payload.tick_value,
        contract_multiplier=payload.contract_multiplier,
        continuous=payload.continuous,
        metadata_json=payload.metadata,
    )
    db.add(row)
    db.flush()
    for identifier in payload.identifiers:
        db.add(
            MarketInstrumentIdentifier(
                user_id=user_id,
                instrument=row,
                provider=identifier.provider.strip().lower(),
                provider_symbol=identifier.provider_symbol.strip(),
                metadata_json=identifier.metadata,
            )
        )
    db.commit()
    return _instrument_read(_owned_instrument(db, user_id, row.id))


def list_instruments(
    db: Session, user_id: int, *, asset_class: str | None = None, search: str | None = None
) -> list[MarketInstrumentRead]:
    statement = select(MarketInstrument).where(MarketInstrument.user_id == user_id).options(
        selectinload(MarketInstrument.identifiers), selectinload(MarketInstrument.contracts)
    )
    if asset_class:
        statement = statement.where(MarketInstrument.asset_class == asset_class)
    if search:
        pattern = f"%{search.strip()}%"
        statement = statement.where(
            MarketInstrument.canonical_symbol.ilike(pattern) | MarketInstrument.display_name.ilike(pattern)
        )
    rows = db.scalars(statement.order_by(MarketInstrument.canonical_symbol.asc())).all()
    return [_instrument_read(row) for row in rows]


def create_contract(
    db: Session, user_id: int, instrument_id: int, payload: MarketContractCreate
) -> MarketContractRead:
    instrument = _owned_instrument(db, user_id, instrument_id)
    if instrument.asset_class != "FUTURE":
        raise MarketConflictError("Expiry contracts can only be attached to FUTURE instruments")
    if payload.first_notice_on and payload.first_notice_on > payload.expires_on:
        raise MarketInfrastructureError("first_notice_on cannot be after expires_on")
    if payload.last_trade_on and payload.last_trade_on > payload.expires_on:
        raise MarketInfrastructureError("last_trade_on cannot be after expires_on")
    if payload.roll_on and payload.roll_on > payload.expires_on:
        raise MarketInfrastructureError("roll_on cannot be after expires_on")
    contract_symbol = _canonical_symbol(payload.contract_symbol)
    provider = payload.provider.strip().lower()
    exists = db.scalar(
        select(MarketContract.id).where(
            MarketContract.user_id == user_id,
            MarketContract.instrument_id == instrument_id,
            MarketContract.contract_symbol == contract_symbol,
        )
    )
    if exists:
        raise MarketConflictError(f"Contract '{contract_symbol}' already exists")
    row = MarketContract(
        user_id=user_id,
        instrument_id=instrument_id,
        contract_symbol=contract_symbol,
        provider=provider,
        provider_symbol=payload.provider_symbol.strip(),
        expires_on=payload.expires_on,
        first_notice_on=payload.first_notice_on,
        last_trade_on=payload.last_trade_on,
        roll_on=payload.roll_on,
        metadata_json=payload.metadata,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return MarketContractRead.model_validate(row)


def list_contracts(db: Session, user_id: int, instrument_id: int) -> list[MarketContractRead]:
    _owned_instrument(db, user_id, instrument_id)
    rows = db.scalars(
        select(MarketContract)
        .where(MarketContract.user_id == user_id, MarketContract.instrument_id == instrument_id)
        .order_by(MarketContract.expires_on.asc(), MarketContract.id.asc())
    ).all()
    return [MarketContractRead.model_validate(row) for row in rows]


def set_continuous_contract_rule(
    db: Session,
    user_id: int,
    instrument_id: int,
    payload: ContinuousContractRuleCreate,
) -> ContinuousContractRuleRead:
    instrument = _owned_instrument(db, user_id, instrument_id)
    if instrument.asset_class != "FUTURE" or not instrument.continuous:
        raise MarketConflictError("A continuous-contract rule requires a continuous FUTURE instrument")
    row = db.scalar(
        select(ContinuousContractRule).where(
            ContinuousContractRule.user_id == user_id,
            ContinuousContractRule.instrument_id == instrument_id,
        )
    )
    if row is None:
        row = ContinuousContractRule(user_id=user_id, instrument_id=instrument_id)
        db.add(row)
    row.method = payload.method
    row.days_before_expiry = payload.days_before_expiry
    row.adjustment = payload.adjustment
    db.commit()
    db.refresh(row)
    return ContinuousContractRuleRead.model_validate(row)


def resolve_continuous_contract(
    db: Session, user_id: int, instrument_id: int, *, as_of: date
) -> dict[str, Any]:
    instrument = _owned_instrument(db, user_id, instrument_id)
    if not instrument.continuous:
        raise MarketConflictError("Instrument is not configured as a continuous contract")
    rule = db.scalar(
        select(ContinuousContractRule).where(
            ContinuousContractRule.user_id == user_id,
            ContinuousContractRule.instrument_id == instrument_id,
        )
    )
    if rule is None:
        raise MarketNotFoundError("Continuous-contract rule not found")
    contracts = db.scalars(
        select(MarketContract)
        .where(
            MarketContract.user_id == user_id,
            MarketContract.instrument_id == instrument_id,
            MarketContract.status == "LISTED",
        )
        .order_by(MarketContract.expires_on.asc(), MarketContract.id.asc())
    ).all()
    if not contracts:
        raise MarketNotFoundError("No listed contracts are available")

    def roll_date(contract: MarketContract) -> date:
        return contract.roll_on or (contract.expires_on - timedelta(days=rule.days_before_expiry))

    active_index = next(
        (index for index, contract in enumerate(contracts) if as_of < roll_date(contract)),
        len(contracts) - 1,
    )
    active = contracts[active_index]
    following = contracts[active_index + 1] if active_index + 1 < len(contracts) else None
    rule.active_contract_id = active.id
    rule.next_contract_id = following.id if following else None
    rule.last_evaluated_at = utcnow()
    db.commit()
    return {
        "instrument_id": instrument_id,
        "as_of": as_of.isoformat(),
        "method": rule.method,
        "adjustment": rule.adjustment,
        "active_contract": MarketContractRead.model_validate(active),
        "next_contract": MarketContractRead.model_validate(following) if following else None,
        "roll_on": roll_date(active).isoformat(),
    }


def grant_entitlement(
    db: Session,
    user_id: int,
    *,
    asset_class: str,
    capability: str,
    source: str,
    expires_at: datetime | None = None,
) -> MarketDataEntitlement:
    """Internal billing/admin hook; intentionally not exposed as a self-service route."""

    asset_class = asset_class.upper()
    capability = capability.upper()
    if capability not in ALL_CAPABILITIES:
        raise MarketInfrastructureError(f"Unsupported capability '{capability}'")
    row = db.scalar(
        select(MarketDataEntitlement).where(
            MarketDataEntitlement.user_id == user_id,
            MarketDataEntitlement.asset_class == asset_class,
            MarketDataEntitlement.capability == capability,
        )
    )
    if row is None:
        row = MarketDataEntitlement(
            user_id=user_id,
            asset_class=asset_class,
            capability=capability,
            source=source,
        )
        db.add(row)
    row.status = "ACTIVE"
    row.tier = "PAID"
    row.source = source
    row.expires_at = _utc_naive(expires_at) if expires_at else None
    row.revoked_at = None
    db.flush()
    return row


def effective_entitlement(
    db: Session, user_id: int, *, asset_class: str, capability: str, now: datetime | None = None
) -> MarketEntitlementRead:
    asset_class = asset_class.upper()
    capability = capability.upper()
    current = _utc_naive(now or utcnow())
    if capability == "CANDLES":
        return MarketEntitlementRead(
            asset_class=asset_class,
            capability=capability,
            allowed=True,
            tier="FREE",
            reason="Normalized candle access is included.",
        )
    if capability in ORDER_FLOW_CAPABILITIES and asset_class in FREE_ORDER_FLOW_CLASSES:
        return MarketEntitlementRead(
            asset_class=asset_class,
            capability=capability,
            allowed=True,
            tier="FREE",
            reason=f"{asset_class.title()} order flow is included when a provider supplies it.",
        )
    row = db.scalar(
        select(MarketDataEntitlement).where(
            MarketDataEntitlement.user_id == user_id,
            MarketDataEntitlement.asset_class == asset_class,
            MarketDataEntitlement.capability == capability,
            MarketDataEntitlement.status == "ACTIVE",
            MarketDataEntitlement.revoked_at.is_(None),
        )
    )
    allowed = bool(row and (row.expires_at is None or row.expires_at > current))
    if allowed:
        return MarketEntitlementRead(
            asset_class=asset_class,
            capability=capability,
            allowed=True,
            tier="PAID",
            reason="An active licensed-data entitlement is present.",
            expires_at=row.expires_at,
        )
    reason = (
        "Futures order flow requires an active licensed-data entitlement and a configured licensed provider."
        if asset_class == "FUTURE" and capability in ORDER_FLOW_CAPABILITIES
        else f"{asset_class} {capability.lower()} access is not available for this account."
    )
    return MarketEntitlementRead(
        asset_class=asset_class,
        capability=capability,
        allowed=False,
        tier="UNAVAILABLE",
        reason=reason,
    )


def list_entitlements(db: Session, user_id: int, *, asset_class: str | None = None) -> list[MarketEntitlementRead]:
    classes = [asset_class.upper()] if asset_class else ["CRYPTO", "EQUITY", "ETF", "FUTURE"]
    return [
        effective_entitlement(db, user_id, asset_class=item, capability=capability)
        for item in classes
        for capability in ALL_CAPABILITIES
    ]


def require_entitlement(db: Session, user_id: int, instrument: MarketInstrument, capability: str) -> None:
    entitlement = effective_entitlement(
        db, user_id, asset_class=instrument.asset_class, capability=capability
    )
    if not entitlement.allowed:
        raise MarketEntitlementError(entitlement.reason)


def _provider_state(
    db: Session,
    user_id: int,
    provider: str,
    instrument_id: int | None,
    *,
    channel: str | None = None,
    registry: MarketProviderRegistry = provider_registry,
) -> MarketProviderState:
    provider = provider.strip().lower()
    scope = (
        f"{instrument_id}:{channel.upper() if channel else '*'}"
        if instrument_id is not None
        else "*"
    )
    row = db.scalar(
        select(MarketProviderState).where(
            MarketProviderState.user_id == user_id,
            MarketProviderState.provider == provider,
            MarketProviderState.instrument_scope == scope,
        )
    )
    if row is None:
        adapter = registry.get(provider)
        capabilities = adapter.capabilities
        row = MarketProviderState(
            user_id=user_id,
            provider=provider,
            instrument_id=instrument_id,
            instrument_scope=scope,
            availability=capabilities.availability,
            health="HEALTHY" if capabilities.availability == "AVAILABLE_OFFLINE" else "UNAVAILABLE",
            licensed=capabilities.licensed,
            capabilities=list(capabilities.capabilities),
            error_code=None if capabilities.availability == "AVAILABLE_OFFLINE" else "PROVIDER_NOT_CONFIGURED",
            error_message=None if capabilities.availability == "AVAILABLE_OFFLINE" else capabilities.message,
        )
        db.add(row)
        db.flush()
    return row


def record_diagnostic(
    db: Session,
    user_id: int,
    *,
    provider: str,
    instrument_id: int | None,
    code: str,
    severity: str,
    message: str,
    recovery_action: str | None = None,
    details: Mapping[str, Any] | None = None,
    deduplicate: bool = True,
) -> MarketDataDiagnostic:
    safe_details = json.loads(json.dumps(dict(details or {}), default=str))
    if deduplicate:
        existing = db.scalar(
            select(MarketDataDiagnostic)
            .where(
                MarketDataDiagnostic.user_id == user_id,
                MarketDataDiagnostic.provider == provider,
                MarketDataDiagnostic.instrument_id == instrument_id,
                MarketDataDiagnostic.code == code,
                MarketDataDiagnostic.state == "OPEN",
            )
            .order_by(MarketDataDiagnostic.created_at.desc(), MarketDataDiagnostic.id.desc())
        )
        if existing is not None:
            existing.message = message
            existing.recovery_action = recovery_action
            existing.details = safe_details
            return existing
    row = MarketDataDiagnostic(
        user_id=user_id,
        provider=provider,
        instrument_id=instrument_id,
        code=code,
        severity=severity,
        message=message,
        recovery_action=recovery_action,
        details=safe_details,
    )
    db.add(row)
    db.flush()
    return row


def _resolve_diagnostic(
    db: Session, user_id: int, provider: str, instrument_id: int | None, code: str
) -> None:
    current = utcnow()
    for row in db.scalars(
        select(MarketDataDiagnostic).where(
            MarketDataDiagnostic.user_id == user_id,
            MarketDataDiagnostic.provider == provider,
            MarketDataDiagnostic.instrument_id == instrument_id,
            MarketDataDiagnostic.code == code,
            MarketDataDiagnostic.state == "OPEN",
        )
    ).all():
        row.state = "RESOLVED"
        row.resolved_at = current


def list_provider_states(db: Session, user_id: int) -> list[MarketProviderStateRead]:
    rows = db.scalars(
        select(MarketProviderState)
        .where(MarketProviderState.user_id == user_id)
        .order_by(MarketProviderState.provider.asc(), MarketProviderState.instrument_scope.asc())
    ).all()
    return [MarketProviderStateRead.model_validate(row) for row in rows]


def list_diagnostics(
    db: Session, user_id: int, *, state: str | None = "OPEN", limit: int = 100
) -> list[MarketDiagnosticRead]:
    statement = select(MarketDataDiagnostic).where(MarketDataDiagnostic.user_id == user_id)
    if state:
        statement = statement.where(MarketDataDiagnostic.state == state.upper())
    rows = db.scalars(
        statement.order_by(MarketDataDiagnostic.created_at.desc(), MarketDataDiagnostic.id.desc()).limit(limit)
    ).all()
    return [MarketDiagnosticRead.model_validate(row) for row in rows]


def check_provider_health(
    db: Session, user_id: int, *, now: datetime | None = None
) -> list[MarketProviderStateRead]:
    current = _utc_naive(now or utcnow())
    rows = db.scalars(
        select(MarketProviderState).where(MarketProviderState.user_id == user_id)
    ).all()
    for row in rows:
        if row.last_heartbeat_at and current - row.last_heartbeat_at > timedelta(seconds=row.stale_after_seconds):
            row.health = "STALE"
            row.error_code = "STALE_FEED"
            row.error_message = "No provider heartbeat arrived within the configured stale window."
            record_diagnostic(
                db,
                user_id,
                provider=row.provider,
                instrument_id=row.instrument_id,
                code="STALE_FEED",
                severity="WARNING",
                message=row.error_message,
                recovery_action="Reconnect the provider and backfill the missing interval.",
                details={"last_heartbeat_at": row.last_heartbeat_at, "stale_after_seconds": row.stale_after_seconds},
            )
            evaluate_provider_alerts(
                db,
                user_id,
                alert_type="PROVIDER_STALE",
                provider=row.provider,
                instrument_id=row.instrument_id,
                observed_at=current,
                payload={"code": "STALE_FEED"},
            )
    db.commit()
    return list_provider_states(db, user_id)


def reconnect_provider(
    db: Session,
    user_id: int,
    *,
    provider: str,
    instrument_id: int | None = None,
    registry: MarketProviderRegistry = provider_registry,
) -> MarketProviderStateRead:
    if instrument_id is not None:
        _owned_instrument(db, user_id, instrument_id)
    provider = provider.strip().lower()
    adapter = registry.get(provider)
    state = _provider_state(db, user_id, provider, instrument_id, registry=registry)
    state.reconnect_count += 1
    if adapter.capabilities.availability != "AVAILABLE_OFFLINE" and not adapter.capabilities.live:
        state.health = "UNAVAILABLE"
        state.error_code = "PROVIDER_NOT_CONFIGURED"
        state.error_message = adapter.capabilities.message
        record_diagnostic(
            db,
            user_id,
            provider=provider,
            instrument_id=instrument_id,
            code="PROVIDER_NOT_CONFIGURED",
            severity="ERROR",
            message=adapter.capabilities.message,
            recovery_action="Configure an authorized provider adapter and retry the connection.",
        )
        db.commit()
        raise MarketProviderUnavailableError(adapter.capabilities.message)
    state.availability = adapter.capabilities.availability
    state.health = "HEALTHY"
    state.last_heartbeat_at = utcnow()
    state.error_code = None
    state.error_message = None
    _resolve_diagnostic(db, user_id, provider, instrument_id, "PROVIDER_NOT_CONFIGURED")
    db.commit()
    db.refresh(state)
    return MarketProviderStateRead.model_validate(state)


def _validate_candle(record: CandleRecord) -> tuple[Decimal, Decimal, Decimal, Decimal, Decimal]:
    values = tuple(_decimal(value) for value in (record.open, record.high, record.low, record.close, record.volume))
    open_price, high, low, close, volume = values
    if min(open_price, high, low, close) <= 0:
        raise MarketInfrastructureError("Candle prices must be greater than zero")
    if volume < 0:
        raise MarketInfrastructureError("Candle volume cannot be negative")
    if high < max(open_price, close, low) or low > min(open_price, close, high):
        raise MarketInfrastructureError("Candle OHLC values are inconsistent")
    if record.interval_seconds <= 0:
        raise MarketInfrastructureError("Candle interval_seconds must be positive")
    return values


def ingest_candles(
    db: Session,
    user_id: int,
    instrument_id: int,
    provider: str,
    records: Sequence[CandleRecord],
    *,
    contract_id: int | None = None,
) -> tuple[int, int]:
    instrument = _owned_instrument(db, user_id, instrument_id)
    require_entitlement(db, user_id, instrument, "CANDLES")
    provider = provider.strip().lower()
    inserted = duplicates = 0
    for record in records:
        open_price, high, low, close, volume = _validate_candle(record)
        start = _utc_naive(record.start_at)
        end = start + timedelta(seconds=record.interval_seconds)
        fingerprint = _hash(
            [start, record.interval_seconds, open_price, high, low, close, volume, record.sequence_start,
             record.sequence_end, record.source_revision, record.complete]
        )
        row = db.scalar(
            select(NormalizedCandle).where(
                NormalizedCandle.user_id == user_id,
                NormalizedCandle.instrument_id == instrument_id,
                NormalizedCandle.contract_scope == (str(contract_id) if contract_id else "*"),
                NormalizedCandle.provider == provider,
                NormalizedCandle.interval_seconds == record.interval_seconds,
                NormalizedCandle.start_at == start,
            )
        )
        if row is not None:
            if row.fingerprint == fingerprint:
                duplicates += 1
                continue
            if record.source_revision <= row.source_revision:
                raise MarketConflictError(
                    f"Candle {start.isoformat()} conflicts with revision {row.source_revision}; provide a higher source_revision"
                )
            row.contract_id = contract_id
            row.end_at = end
            row.open, row.high, row.low, row.close, row.volume = open_price, high, low, close, volume
            row.sequence_start, row.sequence_end = record.sequence_start, record.sequence_end
            row.source_revision, row.complete, row.fingerprint = record.source_revision, record.complete, fingerprint
            inserted += 1
        else:
            db.add(
                NormalizedCandle(
                    user_id=user_id,
                    instrument_id=instrument_id,
                    contract_id=contract_id,
                    contract_scope=str(contract_id) if contract_id else "*",
                    provider=provider,
                    interval_seconds=record.interval_seconds,
                    start_at=start,
                    end_at=end,
                    open=open_price,
                    high=high,
                    low=low,
                    close=close,
                    volume=volume,
                    sequence_start=record.sequence_start,
                    sequence_end=record.sequence_end,
                    source_revision=record.source_revision,
                    complete=record.complete,
                    fingerprint=fingerprint,
                )
            )
            inserted += 1
        fanout_hub.publish(
            user_id,
            "CANDLES",
            instrument_id,
            {"start_at": start.isoformat(), "interval_seconds": record.interval_seconds, "close": str(close)},
        )
    if records:
        state = _provider_state(db, user_id, provider, instrument_id, channel="CANDLES")
        state.last_heartbeat_at = utcnow()
        state.health = "HEALTHY"
        state.availability = "AVAILABLE_OFFLINE" if provider == "offline-fixture" else "AVAILABLE"
    db.flush()
    return inserted, duplicates


def _observe_sequence(
    db: Session,
    user_id: int,
    state: MarketProviderState,
    *,
    sequence: int,
    timestamp: datetime,
) -> int:
    gaps = 0
    if state.last_sequence is not None and sequence > state.last_sequence + 1:
        missing_from, missing_to = state.last_sequence + 1, sequence - 1
        gaps = missing_to - missing_from + 1
        state.gap_count += gaps
        state.incomplete = True
        state.health = "DEGRADED"
        state.error_code = "SEQUENCE_GAP"
        state.error_message = f"Missing provider sequences {missing_from}-{missing_to}."
        record_diagnostic(
            db,
            user_id,
            provider=state.provider,
            instrument_id=state.instrument_id,
            code="SEQUENCE_GAP",
            severity="ERROR",
            message=state.error_message,
            recovery_action="Backfill the missing sequence or timestamp interval before trusting derived data.",
            details={
                "missing_from": missing_from,
                "missing_to": missing_to,
                "received": sequence,
                "channel": state.instrument_scope.rsplit(":", 1)[-1],
            },
            deduplicate=False,
        )
        evaluate_provider_alerts(
            db,
            user_id,
            alert_type="SEQUENCE_GAP",
            provider=state.provider,
            instrument_id=state.instrument_id,
            observed_at=timestamp,
            payload={"missing_from": missing_from, "missing_to": missing_to},
        )
    elif state.last_sequence is not None and sequence <= state.last_sequence:
        record_diagnostic(
            db,
            user_id,
            provider=state.provider,
            instrument_id=state.instrument_id,
            code="OUT_OF_ORDER_SEQUENCE",
            severity="INFO",
            message=f"Received sequence {sequence} after {state.last_sequence}; record retained idempotently.",
            recovery_action="No action is required unless gaps remain open.",
            details={"received": sequence, "last_sequence": state.last_sequence},
        )
    if state.last_exchange_timestamp and timestamp < state.last_exchange_timestamp:
        record_diagnostic(
            db,
            user_id,
            provider=state.provider,
            instrument_id=state.instrument_id,
            code="OUT_OF_ORDER_TIMESTAMP",
            severity="INFO",
            message="An exchange timestamp arrived out of order; durable ordering uses timestamp and sequence.",
            recovery_action="No action is required unless a sequence gap is also reported.",
            details={"received": timestamp, "last_timestamp": state.last_exchange_timestamp},
        )
    state.last_sequence = max(sequence, state.last_sequence or sequence)
    state.last_exchange_timestamp = max(timestamp, state.last_exchange_timestamp or timestamp)
    state.last_heartbeat_at = utcnow()
    if not state.incomplete:
        state.health = "HEALTHY"
        state.error_code = None
        state.error_message = None
    return gaps


def _reconcile_sequence_gaps(
    db: Session,
    user_id: int,
    state: MarketProviderState,
    model: type[MarketTradeTick] | type[OrderBookSnapshot],
) -> None:
    channel = state.instrument_scope.rsplit(":", 1)[-1]
    open_rows = db.scalars(
        select(MarketDataDiagnostic).where(
            MarketDataDiagnostic.user_id == user_id,
            MarketDataDiagnostic.provider == state.provider,
            MarketDataDiagnostic.instrument_id == state.instrument_id,
            MarketDataDiagnostic.code == "SEQUENCE_GAP",
            MarketDataDiagnostic.state == "OPEN",
        )
    ).all()
    current = utcnow()
    for diagnostic in open_rows:
        details = dict(diagnostic.details or {})
        if details.get("channel") != channel:
            continue
        missing_from = int(details["missing_from"])
        missing_to = int(details["missing_to"])
        present = set(
            db.scalars(
                select(model.sequence).where(
                    model.user_id == user_id,
                    model.provider == state.provider,
                    model.instrument_id == state.instrument_id,
                    model.sequence >= missing_from,
                    model.sequence <= missing_to,
                )
            ).all()
        )
        if len(present) == missing_to - missing_from + 1:
            diagnostic.state = "RESOLVED"
            diagnostic.resolved_at = current
    db.flush()
    unresolved = any(
        row.state == "OPEN" and dict(row.details or {}).get("channel") == channel
        for row in open_rows
    )
    if not unresolved:
        state.incomplete = False
        state.health = "HEALTHY"
        state.error_code = None
        state.error_message = None


def ingest_trade_ticks(
    db: Session,
    user_id: int,
    instrument_id: int,
    provider: str,
    records: Sequence[TradeTickRecord],
    *,
    contract_id: int | None = None,
) -> tuple[int, int, int]:
    instrument = _owned_instrument(db, user_id, instrument_id)
    require_entitlement(db, user_id, instrument, "TRADES")
    provider = provider.strip().lower()
    state = _provider_state(db, user_id, provider, instrument_id, channel="TRADES")
    inserted = duplicates = gaps = 0
    for record in records:
        timestamp = _utc_naive(record.exchange_timestamp)
        price, size = _decimal(record.price), _decimal(record.size)
        if price <= 0 or size <= 0:
            raise MarketInfrastructureError("Trade price and size must be greater than zero")
        side = record.aggressor_side.strip().upper()
        if side not in {"BID", "ASK", "UNKNOWN"}:
            raise MarketInfrastructureError("aggressor_side must be BID, ASK, or UNKNOWN")
        if record.sequence < 0:
            raise MarketInfrastructureError("Trade sequence cannot be negative")
        external_id = record.external_trade_id.strip()
        if not external_id:
            raise MarketInfrastructureError("external_trade_id cannot be blank")
        fingerprint = _hash(
            [external_id, record.source_revision, record.sequence, timestamp, price, size, side, record.cancelled]
        )
        existing = db.scalar(
            select(MarketTradeTick).where(
                MarketTradeTick.user_id == user_id,
                MarketTradeTick.provider == provider,
                MarketTradeTick.instrument_id == instrument_id,
                MarketTradeTick.external_trade_id == external_id,
                MarketTradeTick.source_revision == record.source_revision,
            )
        )
        if existing is not None:
            if existing.fingerprint != fingerprint:
                raise MarketConflictError(
                    f"Trade '{external_id}' revision {record.source_revision} was reused with different data"
                )
            duplicates += 1
            continue
        gaps += _observe_sequence(db, user_id, state, sequence=record.sequence, timestamp=timestamp)
        db.add(
            MarketTradeTick(
                user_id=user_id,
                instrument_id=instrument_id,
                contract_id=contract_id,
                provider=provider,
                external_trade_id=external_id,
                source_revision=record.source_revision,
                sequence=record.sequence,
                exchange_timestamp=timestamp,
                received_timestamp=utcnow(),
                price=price,
                size=size,
                aggressor_side=side,
                cancelled=record.cancelled,
                fingerprint=fingerprint,
            )
        )
        inserted += 1
        fanout_hub.publish(
            user_id,
            "TRADES",
            instrument_id,
            {
                "external_trade_id": external_id,
                "sequence": record.sequence,
                "exchange_timestamp": timestamp.isoformat(),
                "price": str(price),
                "size": str(size),
                "aggressor_side": side,
                "cancelled": record.cancelled,
            },
        )
        evaluate_numeric_alerts(
            db,
            user_id,
            instrument_id=instrument_id,
            metric="PRICE",
            value=price,
            observed_at=timestamp,
        )
    db.flush()
    _reconcile_sequence_gaps(db, user_id, state, MarketTradeTick)
    return inserted, duplicates, gaps


def ingest_depth_snapshots(
    db: Session,
    user_id: int,
    instrument_id: int,
    provider: str,
    records: Sequence[DepthSnapshotRecord],
    *,
    contract_id: int | None = None,
) -> tuple[int, int, int]:
    instrument = _owned_instrument(db, user_id, instrument_id)
    require_entitlement(db, user_id, instrument, "DEPTH")
    provider = provider.strip().lower()
    state = _provider_state(db, user_id, provider, instrument_id, channel="DEPTH")
    inserted = duplicates = gaps = 0
    for record in records:
        timestamp = _utc_naive(record.captured_at)
        canonical_levels = sorted(
            (
                level.side,
                str(_decimal(level.price)),
                str(_decimal(level.size)),
                level.order_count,
            )
            for level in record.levels
        )
        checksum = _hash(canonical_levels)
        existing = db.scalar(
            select(OrderBookSnapshot).where(
                OrderBookSnapshot.user_id == user_id,
                OrderBookSnapshot.provider == provider,
                OrderBookSnapshot.instrument_id == instrument_id,
                OrderBookSnapshot.sequence == record.sequence,
            )
        )
        if existing is not None:
            if existing.checksum != checksum:
                raise MarketConflictError(
                    f"Depth sequence {record.sequence} was reused with different levels"
                )
            duplicates += 1
            continue
        gaps += _observe_sequence(db, user_id, state, sequence=record.sequence, timestamp=timestamp)
        snapshot = OrderBookSnapshot(
            user_id=user_id,
            instrument_id=instrument_id,
            contract_id=contract_id,
            provider=provider,
            sequence=record.sequence,
            captured_at=timestamp,
            complete=record.complete,
            checksum=checksum,
        )
        db.add(snapshot)
        db.flush()
        for level in record.levels:
            db.add(
                OrderBookLevel(
                    user_id=user_id,
                    snapshot_id=snapshot.id,
                    side=level.side,
                    price=level.price,
                    size=level.size,
                    order_count=level.order_count,
                )
            )
        inserted += 1
        fanout_hub.publish(
            user_id,
            "DEPTH",
            instrument_id,
            {"sequence": record.sequence, "captured_at": timestamp.isoformat(), "complete": record.complete},
        )
    db.flush()
    _reconcile_sequence_gaps(db, user_id, state, OrderBookSnapshot)
    return inserted, duplicates, gaps


def list_candles(
    db: Session,
    user_id: int,
    instrument_id: int,
    *,
    from_at: datetime,
    to_at: datetime,
    interval_seconds: int,
    provider: str | None = None,
    limit: int = 5000,
) -> list[NormalizedCandleRead]:
    instrument = _owned_instrument(db, user_id, instrument_id)
    require_entitlement(db, user_id, instrument, "CANDLES")
    statement = select(NormalizedCandle).where(
        NormalizedCandle.user_id == user_id,
        NormalizedCandle.instrument_id == instrument_id,
        NormalizedCandle.interval_seconds == interval_seconds,
        NormalizedCandle.start_at >= _utc_naive(from_at),
        NormalizedCandle.start_at < _utc_naive(to_at),
    )
    if provider:
        statement = statement.where(NormalizedCandle.provider == provider.strip().lower())
    rows = db.scalars(statement.order_by(NormalizedCandle.start_at.asc()).limit(limit)).all()
    return [NormalizedCandleRead.model_validate(row) for row in rows]


def list_trade_ticks(
    db: Session,
    user_id: int,
    instrument_id: int,
    *,
    from_at: datetime,
    to_at: datetime,
    provider: str | None = None,
    limit: int = 10000,
) -> list[MarketTradeTickRead]:
    instrument = _owned_instrument(db, user_id, instrument_id)
    require_entitlement(db, user_id, instrument, "TRADES")
    statement = select(MarketTradeTick).where(
        MarketTradeTick.user_id == user_id,
        MarketTradeTick.instrument_id == instrument_id,
        MarketTradeTick.exchange_timestamp >= _utc_naive(from_at),
        MarketTradeTick.exchange_timestamp < _utc_naive(to_at),
    )
    if provider:
        statement = statement.where(MarketTradeTick.provider == provider.strip().lower())
    rows = db.scalars(
        statement.order_by(MarketTradeTick.exchange_timestamp.asc(), MarketTradeTick.sequence.asc(), MarketTradeTick.id.asc())
        .limit(limit)
    ).all()
    return [MarketTradeTickRead.model_validate(row) for row in rows]


def build_footprints(
    db: Session,
    user_id: int,
    instrument_id: int,
    *,
    provider: str,
    from_at: datetime,
    to_at: datetime,
    interval_seconds: int,
    tick_size: Decimal | None = None,
    contract_id: int | None = None,
    include_empty: bool = False,
) -> list[FootprintRead]:
    instrument = _owned_instrument(db, user_id, instrument_id)
    require_entitlement(db, user_id, instrument, "FOOTPRINT")
    provider = provider.strip().lower()
    start, end = _utc_naive(from_at), _utc_naive(to_at)
    if end <= start:
        raise MarketInfrastructureError("to_at must be after from_at")
    effective_tick = _decimal(tick_size if tick_size is not None else instrument.tick_size)
    if effective_tick <= 0:
        raise MarketInfrastructureError("tick_size must be greater than zero")
    statement = select(MarketTradeTick).where(
        MarketTradeTick.user_id == user_id,
        MarketTradeTick.instrument_id == instrument_id,
        MarketTradeTick.provider == provider,
        MarketTradeTick.exchange_timestamp >= start,
        MarketTradeTick.exchange_timestamp < end,
        MarketTradeTick.cancelled.is_(False),
    )
    if contract_id is not None:
        statement = statement.where(MarketTradeTick.contract_id == contract_id)
    ticks = db.scalars(
        statement.order_by(MarketTradeTick.exchange_timestamp.asc(), MarketTradeTick.sequence.asc(), MarketTradeTick.id.asc())
    ).all()
    trades = [
        OrderFlowTrade(
            trade_id=f"{tick.external_trade_id}:{tick.source_revision}",
            timestamp=tick.exchange_timestamp,
            price=tick.price,
            size=tick.size,
            aggressor_side={
                "BID": AggressorSide.BID,
                "ASK": AggressorSide.ASK,
                "UNKNOWN": AggressorSide.UNKNOWN,
            }[tick.aggressor_side],
        )
        for tick in ticks
    ]
    bars = aggregate_order_flow(
        trades,
        interval=timedelta(seconds=interval_seconds),
        tick_size=effective_tick,
        start=start,
        end=end,
        include_empty=include_empty,
    )
    state = db.scalar(
        select(MarketProviderState).where(
            MarketProviderState.user_id == user_id,
            MarketProviderState.provider == provider,
            MarketProviderState.instrument_scope == f"{instrument_id}:TRADES",
        )
    )
    complete = not bool(state and state.incomplete)
    results: list[FootprintRead] = []
    for bar in bars:
        bar_start, bar_end = _utc_naive(bar.start), _utc_naive(bar.end)
        fingerprint = _hash(
            [bar_start, bar_end, effective_tick, bar.bid_volume, bar.ask_volume, bar.unknown_volume,
             bar.total_volume, bar.delta, bar.trade_count,
             [(level.price, level.bid_volume, level.ask_volume, level.unknown_volume, level.trade_count) for level in bar.levels]]
        )
        row = db.scalar(
            select(PersistedFootprint)
            .where(
                PersistedFootprint.user_id == user_id,
                PersistedFootprint.instrument_id == instrument_id,
                PersistedFootprint.contract_scope == (str(contract_id) if contract_id else "*"),
                PersistedFootprint.provider == provider,
                PersistedFootprint.interval_seconds == interval_seconds,
                PersistedFootprint.start_at == bar_start,
                PersistedFootprint.tick_size == effective_tick,
            )
            .options(selectinload(PersistedFootprint.levels))
        )
        if row is None:
            row = PersistedFootprint(
                user_id=user_id,
                instrument_id=instrument_id,
                contract_id=contract_id,
                contract_scope=str(contract_id) if contract_id else "*",
                provider=provider,
                interval_seconds=interval_seconds,
                start_at=bar_start,
                end_at=bar_end,
                tick_size=effective_tick,
                bid_volume=bar.bid_volume,
                ask_volume=bar.ask_volume,
                unknown_volume=bar.unknown_volume,
                total_volume=bar.total_volume,
                delta=bar.delta,
                trade_count=bar.trade_count,
                average_trade_size=bar.average_trade_size,
                complete=complete,
                fingerprint=fingerprint,
            )
            db.add(row)
            db.flush()
        elif row.fingerprint != fingerprint or row.complete != complete:
            row.end_at = bar_end
            row.bid_volume, row.ask_volume = bar.bid_volume, bar.ask_volume
            row.unknown_volume, row.total_volume, row.delta = bar.unknown_volume, bar.total_volume, bar.delta
            row.trade_count, row.average_trade_size = bar.trade_count, bar.average_trade_size
            row.complete, row.fingerprint = complete, fingerprint
            row.levels.clear()
            db.flush()
        if not row.levels:
            row.levels.extend(
                PersistedFootprintLevel(
                    user_id=user_id,
                    price=level.price,
                    bid_volume=level.bid_volume,
                    ask_volume=level.ask_volume,
                    unknown_volume=level.unknown_volume,
                    total_volume=level.total_volume,
                    delta=level.delta,
                    trade_count=level.trade_count,
                    average_trade_size=level.average_trade_size,
                )
                for level in bar.levels
            )
        db.flush()
        results.append(_footprint_read(row))
        fanout_hub.publish(
            user_id,
            "FOOTPRINT",
            instrument_id,
            {"start_at": bar_start.isoformat(), "delta": str(bar.delta), "total_volume": str(bar.total_volume)},
        )
        evaluate_numeric_alerts(
            db,
            user_id,
            instrument_id=instrument_id,
            metric="VOLUME",
            value=bar.total_volume,
            observed_at=bar_end,
        )
        evaluate_numeric_alerts(
            db,
            user_id,
            instrument_id=instrument_id,
            metric="DELTA",
            value=bar.delta,
            observed_at=bar_end,
        )
    db.commit()
    return results


def _footprint_read(row: PersistedFootprint) -> FootprintRead:
    return FootprintRead(
        id=row.id,
        instrument_id=row.instrument_id,
        contract_id=row.contract_id,
        provider=row.provider,
        interval_seconds=row.interval_seconds,
        start_at=row.start_at,
        end_at=row.end_at,
        tick_size=row.tick_size,
        bid_volume=row.bid_volume,
        ask_volume=row.ask_volume,
        unknown_volume=row.unknown_volume,
        total_volume=row.total_volume,
        delta=row.delta,
        trade_count=row.trade_count,
        average_trade_size=row.average_trade_size,
        complete=row.complete,
        levels=[
            FootprintLevelRead(
                price=level.price,
                bid_volume=level.bid_volume,
                ask_volume=level.ask_volume,
                unknown_volume=level.unknown_volume,
                total_volume=level.total_volume,
                delta=level.delta,
                trade_count=level.trade_count,
                average_trade_size=level.average_trade_size,
            )
            for level in sorted(row.levels, key=lambda item: item.price)
        ],
    )


def list_footprints(
    db: Session,
    user_id: int,
    instrument_id: int,
    *,
    from_at: datetime,
    to_at: datetime,
    interval_seconds: int,
    provider: str | None = None,
    limit: int = 5000,
) -> list[FootprintRead]:
    instrument = _owned_instrument(db, user_id, instrument_id)
    require_entitlement(db, user_id, instrument, "FOOTPRINT")
    statement = (
        select(PersistedFootprint)
        .where(
            PersistedFootprint.user_id == user_id,
            PersistedFootprint.instrument_id == instrument_id,
            PersistedFootprint.interval_seconds == interval_seconds,
            PersistedFootprint.start_at >= _utc_naive(from_at),
            PersistedFootprint.start_at < _utc_naive(to_at),
        )
        .options(selectinload(PersistedFootprint.levels))
    )
    if provider:
        statement = statement.where(PersistedFootprint.provider == provider.strip().lower())
    rows = db.scalars(statement.order_by(PersistedFootprint.start_at.asc()).limit(limit)).all()
    return [_footprint_read(row) for row in rows]


def _provider_symbol(instrument: MarketInstrument, provider: str) -> str:
    identifier = next((item for item in instrument.identifiers if item.provider == provider), None)
    if identifier is not None:
        return identifier.provider_symbol
    if provider == "offline-fixture":
        return instrument.canonical_symbol
    raise MarketNotFoundError(
        f"Instrument '{instrument.canonical_symbol}' has no identifier for provider '{provider}'"
    )


def run_historical_backfill(
    db: Session,
    user_id: int,
    payload: MarketBackfillCreate,
    *,
    registry: MarketProviderRegistry = provider_registry,
) -> MarketBackfillRead:
    instrument = _owned_instrument(db, user_id, payload.instrument_id)
    require_entitlement(db, user_id, instrument, payload.data_type)
    provider = payload.provider.strip().lower()
    from_at, to_at = _utc_naive(payload.from_at), _utc_naive(payload.to_at)
    key = payload.idempotency_key or _hash(
        [provider, payload.instrument_id, payload.data_type, from_at, to_at, payload.interval_seconds]
    )[:64]
    existing = db.scalar(
        select(MarketBackfillRun).where(
            MarketBackfillRun.user_id == user_id,
            MarketBackfillRun.idempotency_key == key,
        )
    )
    if existing is not None:
        return MarketBackfillRead.model_validate(existing)
    run = MarketBackfillRun(
        user_id=user_id,
        idempotency_key=key,
        provider=provider,
        instrument_id=payload.instrument_id,
        data_type=payload.data_type,
        from_at=from_at,
        to_at=to_at,
    )
    db.add(run)
    db.commit()
    try:
        adapter = registry.get(provider)
        state = _provider_state(
            db,
            user_id,
            provider,
            payload.instrument_id,
            channel=payload.data_type,
            registry=registry,
        )
        if adapter.capabilities.availability != "AVAILABLE_OFFLINE" and not adapter.capabilities.live:
            raise MarketProviderUnavailableError(adapter.capabilities.message)
        symbol = _provider_symbol(instrument, provider)
        if payload.data_type == "CANDLES":
            records = adapter.historical_candles(symbol, from_at, to_at, payload.interval_seconds)
            inserted, duplicates = ingest_candles(db, user_id, instrument.id, provider, records)
            gaps = 0
        elif payload.data_type == "TRADES":
            records = adapter.historical_trades(symbol, from_at, to_at)
            inserted, duplicates, gaps = ingest_trade_ticks(db, user_id, instrument.id, provider, records)
        else:
            records = adapter.historical_depth(symbol, from_at, to_at)
            inserted, duplicates, gaps = ingest_depth_snapshots(db, user_id, instrument.id, provider, records)
        run.received_count = len(records)
        run.inserted_count = inserted
        run.duplicate_count = duplicates
        run.gap_count = gaps
        run.status = "COMPLETED_WITH_GAPS" if gaps else "COMPLETED"
        run.completed_at = utcnow()
        state.last_heartbeat_at = utcnow()
        if gaps == 0:
            state.health = "HEALTHY"
            state.incomplete = False
            state.error_code = None
            state.error_message = None
            _resolve_diagnostic(db, user_id, provider, instrument.id, "STALE_FEED")
        db.commit()
        db.refresh(run)
        return MarketBackfillRead.model_validate(run)
    except MarketInfrastructureError as exc:
        run = db.get(MarketBackfillRun, run.id)
        run.status = "FAILED"
        run.error_code = type(exc).__name__.replace("Market", "").replace("Error", "").upper()
        run.error_message = exc.public_message
        run.completed_at = utcnow()
        try:
            state = _provider_state(
                db,
                user_id,
                provider,
                payload.instrument_id,
                channel=payload.data_type,
                registry=registry,
            )
            state.health = "UNAVAILABLE"
            state.error_code = "PROVIDER_UNAVAILABLE"
            state.error_message = exc.public_message
        except MarketInfrastructureError:
            pass
        record_diagnostic(
            db,
            user_id,
            provider=provider,
            instrument_id=payload.instrument_id,
            code="PROVIDER_UNAVAILABLE",
            severity="ERROR",
            message=exc.public_message,
            recovery_action="Configure an authorized provider adapter, then retry this backfill.",
        )
        db.commit()
        raise


def list_backfill_runs(db: Session, user_id: int, *, limit: int = 100) -> list[MarketBackfillRead]:
    rows = db.scalars(
        select(MarketBackfillRun)
        .where(MarketBackfillRun.user_id == user_id)
        .order_by(MarketBackfillRun.created_at.desc(), MarketBackfillRun.id.desc())
        .limit(limit)
    ).all()
    return [MarketBackfillRead.model_validate(row) for row in rows]


@dataclass(slots=True)
class _Subscription:
    subscription_id: str
    user_id: int
    pane_id: str
    instrument_id: int
    channels: tuple[str, ...]
    queue: deque[MarketStreamEventRead]
    dropped_events: int = 0


class MarketFanoutHub:
    """Process-local bounded fan-out; durable rows remain the recovery source."""

    def __init__(self, *, max_panes_per_user: int = 16, max_queue_depth: int = 256) -> None:
        if max_panes_per_user < 1 or max_queue_depth < 1:
            raise ValueError("Fan-out limits must be positive")
        self.max_panes_per_user = max_panes_per_user
        self.max_queue_depth = max_queue_depth
        self._lock = RLock()
        self._subscriptions: dict[str, _Subscription] = {}
        self._sequence = 0

    def subscribe(self, user_id: int, payload: MarketSubscriptionCreate) -> MarketSubscriptionRead:
        with self._lock:
            existing = next(
                (
                    item for item in self._subscriptions.values()
                    if item.user_id == user_id and item.pane_id == payload.pane_id
                ),
                None,
            )
            if existing:
                existing.instrument_id = payload.instrument_id
                existing.channels = tuple(dict.fromkeys(payload.channels))
                return self._read(existing)
            user_panes = sum(item.user_id == user_id for item in self._subscriptions.values())
            if user_panes >= self.max_panes_per_user:
                raise MarketConflictError(
                    f"At most {self.max_panes_per_user} live panes may be subscribed per user"
                )
            subscription = _Subscription(
                subscription_id=uuid4().hex,
                user_id=user_id,
                pane_id=payload.pane_id,
                instrument_id=payload.instrument_id,
                channels=tuple(dict.fromkeys(payload.channels)),
                queue=deque(maxlen=self.max_queue_depth),
            )
            self._subscriptions[subscription.subscription_id] = subscription
            return self._read(subscription)

    def unsubscribe(self, user_id: int, subscription_id: str) -> bool:
        with self._lock:
            item = self._subscriptions.get(subscription_id)
            if item is None or item.user_id != user_id:
                return False
            del self._subscriptions[subscription_id]
            return True

    def publish(self, user_id: int, channel: str, instrument_id: int, payload: Mapping[str, Any]) -> None:
        with self._lock:
            self._sequence += 1
            event = MarketStreamEventRead(
                sequence=self._sequence,
                channel=channel,
                instrument_id=instrument_id,
                occurred_at=utcnow(),
                payload=dict(payload),
            )
            for item in self._subscriptions.values():
                if item.user_id != user_id or item.instrument_id != instrument_id or channel not in item.channels:
                    continue
                if len(item.queue) == item.queue.maxlen:
                    item.dropped_events += 1
                item.queue.append(event)

    def poll(self, user_id: int, subscription_id: str, *, limit: int = 100) -> list[MarketStreamEventRead]:
        with self._lock:
            item = self._subscriptions.get(subscription_id)
            if item is None or item.user_id != user_id:
                raise MarketNotFoundError("Market-data subscription not found")
            values: list[MarketStreamEventRead] = []
            while item.queue and len(values) < limit:
                values.append(item.queue.popleft())
            return values

    def list(self, user_id: int) -> list[MarketSubscriptionRead]:
        with self._lock:
            return [
                self._read(item)
                for item in sorted(self._subscriptions.values(), key=lambda row: (row.pane_id, row.subscription_id))
                if item.user_id == user_id
            ]

    @staticmethod
    def _read(item: _Subscription) -> MarketSubscriptionRead:
        return MarketSubscriptionRead(
            subscription_id=item.subscription_id,
            pane_id=item.pane_id,
            instrument_id=item.instrument_id,
            channels=list(item.channels),
            queued_events=len(item.queue),
            dropped_events=item.dropped_events,
        )


fanout_hub = MarketFanoutHub()


def subscribe_market_stream(
    db: Session, user_id: int, payload: MarketSubscriptionCreate
) -> MarketSubscriptionRead:
    instrument = _owned_instrument(db, user_id, payload.instrument_id)
    for channel in payload.channels:
        if channel in ORDER_FLOW_CAPABILITIES:
            require_entitlement(db, user_id, instrument, channel)
    return fanout_hub.subscribe(user_id, payload)


def get_order_book(
    db: Session,
    user_id: int,
    instrument_id: int,
    *,
    provider: str | None = None,
    aggregation_ticks: int = 1,
    depth: int = 20,
    now: datetime | None = None,
) -> OrderBookRead:
    instrument = _owned_instrument(db, user_id, instrument_id)
    aggregation_tick_size = instrument.tick_size * aggregation_ticks
    entitlement = effective_entitlement(
        db, user_id, asset_class=instrument.asset_class, capability="DEPTH"
    )
    if not entitlement.allowed:
        return OrderBookRead(
            instrument_id=instrument_id,
            contract_id=None,
            provider=provider,
            sequence=None,
            captured_at=None,
            status="ENTITLEMENT_REQUIRED",
            aggregation_tick_size=aggregation_tick_size,
            message=entitlement.reason,
        )
    statement = (
        select(OrderBookSnapshot)
        .where(OrderBookSnapshot.user_id == user_id, OrderBookSnapshot.instrument_id == instrument_id)
        .options(selectinload(OrderBookSnapshot.levels))
    )
    if provider:
        statement = statement.where(OrderBookSnapshot.provider == provider.strip().lower())
    snapshot = db.scalar(
        statement.order_by(OrderBookSnapshot.captured_at.desc(), OrderBookSnapshot.sequence.desc()).limit(1)
    )
    if snapshot is None:
        return OrderBookRead(
            instrument_id=instrument_id,
            contract_id=None,
            provider=provider,
            sequence=None,
            captured_at=None,
            status="UNAVAILABLE",
            aggregation_tick_size=aggregation_tick_size,
            message="No order-book snapshot is available from the selected provider.",
        )
    buckets: dict[tuple[str, Decimal], list[Any]] = defaultdict(lambda: [Decimal("0"), 0])
    for level in snapshot.levels:
        rounding = ROUND_FLOOR if level.side == "BID" else ROUND_CEILING
        price = (level.price / aggregation_tick_size).to_integral_value(rounding=rounding) * aggregation_tick_size
        bucket = buckets[(level.side, price)]
        bucket[0] += level.size
        bucket[1] += level.order_count
    bids = sorted(
        (
            OrderBookLevelRead(side=side, price=price, size=value[0], order_count=value[1])
            for (side, price), value in buckets.items() if side == "BID"
        ),
        key=lambda item: item.price,
        reverse=True,
    )[:depth]
    asks = sorted(
        (
            OrderBookLevelRead(side=side, price=price, size=value[0], order_count=value[1])
            for (side, price), value in buckets.items() if side == "ASK"
        ),
        key=lambda item: item.price,
    )[:depth]
    state = db.scalar(
        select(MarketProviderState).where(
            MarketProviderState.user_id == user_id,
            MarketProviderState.provider == snapshot.provider,
            MarketProviderState.instrument_scope == f"{instrument_id}:DEPTH",
        )
    )
    current = _utc_naive(now or utcnow())
    stale_after = state.stale_after_seconds if state else 30
    if current - snapshot.captured_at > timedelta(seconds=stale_after):
        status, message = "STALE", "Latest order-book snapshot is stale; reconnect and backfill before relying on it."
    elif not snapshot.complete or (state and state.incomplete):
        status, message = "INCOMPLETE", "A sequence gap makes this order-book snapshot incomplete."
    else:
        status, message = "AVAILABLE", None
    return OrderBookRead(
        instrument_id=instrument_id,
        contract_id=snapshot.contract_id,
        provider=snapshot.provider,
        sequence=snapshot.sequence,
        captured_at=snapshot.captured_at,
        status=status,
        aggregation_tick_size=aggregation_tick_size,
        levels=[*bids, *asks],
        message=message,
    )


def create_alert_rule(
    db: Session, user_id: int, payload: MarketAlertRuleCreate
) -> MarketAlertRuleRead:
    if payload.instrument_id is not None:
        _owned_instrument(db, user_id, payload.instrument_id)
    condition: dict[str, Any] = {}
    if payload.threshold is not None:
        condition["threshold"] = str(payload.threshold)
    if payload.provider:
        condition["provider"] = payload.provider.strip().lower()
    row = MarketAlertRule(
        user_id=user_id,
        instrument_id=payload.instrument_id,
        name=payload.name.strip(),
        alert_type=payload.alert_type,
        condition=condition,
        cooldown_seconds=payload.cooldown_seconds,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _alert_rule_read(row)


def _alert_rule_read(row: MarketAlertRule) -> MarketAlertRuleRead:
    return MarketAlertRuleRead(
        id=row.id,
        instrument_id=row.instrument_id,
        name=row.name,
        alert_type=row.alert_type,
        condition=dict(row.condition or {}),
        enabled=row.enabled,
        cooldown_seconds=row.cooldown_seconds,
        last_value=row.last_value,
        last_evaluated_at=row.last_evaluated_at,
        last_triggered_at=row.last_triggered_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def list_alert_rules(db: Session, user_id: int) -> list[MarketAlertRuleRead]:
    rows = db.scalars(
        select(MarketAlertRule)
        .where(MarketAlertRule.user_id == user_id)
        .order_by(MarketAlertRule.created_at.desc(), MarketAlertRule.id.desc())
    ).all()
    return [_alert_rule_read(row) for row in rows]


def delete_alert_rule(db: Session, user_id: int, rule_id: int) -> None:
    row = db.scalar(
        select(MarketAlertRule).where(MarketAlertRule.user_id == user_id, MarketAlertRule.id == rule_id)
    )
    if row is None:
        raise MarketNotFoundError("Market alert rule not found")
    db.delete(row)
    db.commit()


def _emit_alert(
    db: Session,
    rule: MarketAlertRule,
    *,
    observed_at: datetime,
    observed_value: Decimal | None,
    message: str,
    payload: Mapping[str, Any],
) -> MarketAlertEvent | None:
    if rule.last_triggered_at and observed_at - rule.last_triggered_at < timedelta(seconds=rule.cooldown_seconds):
        return None
    event_key = _hash([rule.id, observed_at, observed_value, payload])
    existing = db.scalar(
        select(MarketAlertEvent.id).where(
            MarketAlertEvent.user_id == rule.user_id,
            MarketAlertEvent.rule_id == rule.id,
            MarketAlertEvent.event_key == event_key,
        )
    )
    if existing:
        return None
    event = MarketAlertEvent(
        user_id=rule.user_id,
        rule_id=rule.id,
        instrument_id=rule.instrument_id,
        event_key=event_key,
        observed_at=observed_at,
        observed_value=observed_value,
        message=message,
        payload=dict(payload),
    )
    db.add(event)
    rule.last_triggered_at = observed_at
    fanout_hub.publish(
        rule.user_id,
        "DIAGNOSTICS",
        rule.instrument_id or 0,
        {"alert_rule_id": rule.id, "message": message, **dict(payload)},
    )
    return event


def evaluate_numeric_alerts(
    db: Session,
    user_id: int,
    *,
    instrument_id: int,
    metric: str,
    value: Decimal,
    observed_at: datetime,
) -> list[MarketAlertEvent]:
    metric = metric.upper()
    relevant = {
        "PRICE": {"PRICE_ABOVE", "PRICE_BELOW", "PRICE_CROSSES_ABOVE", "PRICE_CROSSES_BELOW"},
        "VOLUME": {"VOLUME_ABOVE"},
        "DELTA": {"DELTA_ABOVE", "DELTA_BELOW"},
    }.get(metric, set())
    rows = db.scalars(
        select(MarketAlertRule).where(
            MarketAlertRule.user_id == user_id,
            MarketAlertRule.instrument_id == instrument_id,
            MarketAlertRule.enabled.is_(True),
            MarketAlertRule.alert_type.in_(relevant),
        )
    ).all()
    emitted: list[MarketAlertEvent] = []
    for rule in rows:
        threshold = _decimal(dict(rule.condition or {}).get("threshold"))
        previous = rule.last_value
        triggered = {
            "PRICE_ABOVE": value > threshold,
            "PRICE_BELOW": value < threshold,
            "PRICE_CROSSES_ABOVE": previous is not None and previous <= threshold < value,
            "PRICE_CROSSES_BELOW": previous is not None and previous >= threshold > value,
            "VOLUME_ABOVE": value > threshold,
            "DELTA_ABOVE": value > threshold,
            "DELTA_BELOW": value < threshold,
        }[rule.alert_type]
        rule.last_value = value
        rule.last_evaluated_at = observed_at
        if triggered:
            event = _emit_alert(
                db,
                rule,
                observed_at=observed_at,
                observed_value=value,
                message=f"{rule.name}: {metric.lower()} {value} matched {rule.alert_type.lower()} {threshold}.",
                payload={"metric": metric, "threshold": str(threshold)},
            )
            if event:
                emitted.append(event)
    return emitted


def evaluate_provider_alerts(
    db: Session,
    user_id: int,
    *,
    alert_type: str,
    provider: str,
    instrument_id: int | None,
    observed_at: datetime,
    payload: Mapping[str, Any],
) -> list[MarketAlertEvent]:
    rows = db.scalars(
        select(MarketAlertRule).where(
            MarketAlertRule.user_id == user_id,
            MarketAlertRule.enabled.is_(True),
            MarketAlertRule.alert_type == alert_type,
        )
    ).all()
    emitted: list[MarketAlertEvent] = []
    for rule in rows:
        condition_provider = dict(rule.condition or {}).get("provider")
        if condition_provider and condition_provider != provider:
            continue
        if rule.instrument_id is not None and rule.instrument_id != instrument_id:
            continue
        rule.last_evaluated_at = observed_at
        event = _emit_alert(
            db,
            rule,
            observed_at=observed_at,
            observed_value=None,
            message=f"{rule.name}: provider '{provider}' reported {alert_type.lower()}.",
            payload={"provider": provider, **dict(payload)},
        )
        if event:
            emitted.append(event)
    return emitted


def list_alert_events(
    db: Session, user_id: int, *, acknowledged: bool | None = None, limit: int = 200
) -> list[MarketAlertEventRead]:
    statement = select(MarketAlertEvent).where(MarketAlertEvent.user_id == user_id)
    if acknowledged is True:
        statement = statement.where(MarketAlertEvent.acknowledged_at.is_not(None))
    elif acknowledged is False:
        statement = statement.where(MarketAlertEvent.acknowledged_at.is_(None))
    rows = db.scalars(
        statement.order_by(MarketAlertEvent.observed_at.desc(), MarketAlertEvent.id.desc()).limit(limit)
    ).all()
    return [MarketAlertEventRead.model_validate(row) for row in rows]


def acknowledge_alert_event(
    db: Session, user_id: int, event_id: int
) -> MarketAlertEventRead:
    row = db.scalar(
        select(MarketAlertEvent).where(
            MarketAlertEvent.user_id == user_id, MarketAlertEvent.id == event_id
        )
    )
    if row is None:
        raise MarketNotFoundError("Market alert event not found")
    if row.acknowledged_at is None:
        row.acknowledged_at = utcnow()
        db.commit()
        db.refresh(row)
    return MarketAlertEventRead.model_validate(row)
