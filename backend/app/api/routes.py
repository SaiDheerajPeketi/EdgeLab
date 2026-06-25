import asyncio
import json
import logging
import re
from secrets import token_urlsafe
import struct
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import DateTime, func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.auth import (
    AuthenticatedUser,
    api_token_is_valid,
    authenticate_websocket,
    create_session_token,
    require_auth,
)
from app.config import settings
from app.db import SessionLocal, get_db
from app.models import (
    AppStorageItem,
    BacktestSession,
    BetaSession,
    BetaUser,
    DatasetAsset,
    DatasetSettings,
    DatasetTimeframe,
    Execution,
    Order,
    Playbook,
    Position,
    Trade,
    TradeNote,
    utcnow,
)
from app.schemas import (
    AppDataBundle,
    AppBootstrapResponse,
    AppDataImportResult,
    AppStoragePayload,
    AppStorageRead,
    AngelOneInstrument,
    AngelOneInstrumentsResponse,
    BetaAccessRequest,
    BetaAccessResponse,
    BetaAuthConfig,
    BetaAuthSessionRead,
    BetaAuthUser,
    BetaProgramStatus,
    BacktestAdvanceRequest,
    BacktestCreate,
    BacktestJumpRequest,
    BacktestSessionRead,
    BacktestSessionUpdate,
    BacktestState,
    BacktestTradeImport,
    BacktestTradeImportResult,
    BarsResponse,
    BinanceInstrument,
    BinanceInstrumentsResponse,
    DatasetAssetUpdate,
    DatasetCatalogResponse,
    DatasetMeta,
    DatasetRefreshResponse,
    DatasetRefreshStatus,
    DatasetSettingsRead,
    DatasetSettingsUpdate,
    DukascopyCandlesResponse,
    DukascopyInstrument,
    DukascopyInstrumentsResponse,
    EconomicCalendarEvent,
    EconomicCalendarResponse,
    GoogleAuthExchangeRequest,
    JournalUpdate,
    MetricsResponse,
    OrderCreate,
    OrderUpdate,
    PlaybookCreate,
    PlaybookRead,
    PlaybookUpdate,
    PositionUpdate,
    TradeRead,
    TradeStrategyUpdate,
)
from app.services.backtester import BacktestService, list_latest_session
from app.services.datasets import DatasetCatalogService, DatasetRefreshInProgress
from app.services.market_data import MarketDataService
from app.services.metrics import get_metrics
from app.services.trade_imports import import_trade_csv


router = APIRouter()
logger = logging.getLogger(__name__)
DATASET_STREAM_INTERVAL_SECONDS = 3
BOOTSTRAP_SESSION_LIMIT = 25
BOOTSTRAP_TRADE_LIMIT = 100
market_data = (
    MarketDataService(settings.csv_path, cache=settings.cache_market_data)
    if settings.csv_path is not None
    else None
)
dataset_catalog = DatasetCatalogService(settings.datasets_root, SessionLocal)
backtester = BacktestService(market_data, dataset_catalog)

BINANCE_REST_URLS = (
    "https://data-api.binance.vision/api/v3",
    "https://api.binance.com/api/v3",
)
DUKASCOPY_URL = "https://freeserv.dukascopy.com/2.0/index.php"
DUKASCOPY_HEADERS = {
    "User-Agent": "edgelab-local-datafeed",
    "Referer": "https://freeserv.dukascopy.com/2.0/?path=chart/index&instrument=EUR/USD",
}
DUKASCOPY_INTERVALS = {"1MIN", "5MIN", "15MIN", "1HOUR", "1DAY"}
ANGELONE_SCRIP_MASTER_URL = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json"
ANGELONE_WS_URL = "wss://smartapisocket.angelone.in/smart-stream"
ANGELONE_CATALOG_CACHE_TTL_SECONDS = 60 * 60 * 12
ANGELONE_EXCHANGE_TYPES = {
    "NSE": 1,
    "NFO": 2,
    "BSE": 3,
    "BFO": 4,
    "MCX": 5,
    "NCDEX": 7,
    "CDS": 13,
}
ANGELONE_HEADERS = {
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; EdgeLab/0.1; +https://github.com/SaiDheerajPeketi/EdgeLab)",
}
FOREX_FACTORY_CALENDAR_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
FOREX_FACTORY_CACHE_TTL_SECONDS = 180
FOREX_FACTORY_HEADERS = {
    "Accept": "application/json",
    "Referer": "https://www.forexfactory.com/calendar",
    "User-Agent": "Mozilla/5.0 (compatible; EdgeLab/0.1; +https://github.com/SaiDheerajPeketi/EdgeLab)",
}
forex_factory_calendar_cache: tuple[datetime, list[EconomicCalendarEvent]] | None = None
angelone_instrument_cache: tuple[datetime, list[AngelOneInstrument]] | None = None


APP_DATA_TABLES = [
    ("dataset_settings", DatasetSettings),
    ("dataset_assets", DatasetAsset),
    ("dataset_timeframes", DatasetTimeframe),
    ("app_storage", AppStorageItem),
    ("playbooks", Playbook),
    ("backtest_sessions", BacktestSession),
    ("positions", Position),
    ("orders", Order),
    ("trades", Trade),
    ("executions", Execution),
    ("trade_notes", TradeNote),
]
APP_DATA_TABLE_NAMES = {table_name for table_name, _model in APP_DATA_TABLES}
APP_DATA_IMPORT_BATCH_SIZE = 1000
BETA_SESSION_TTL = timedelta(days=7)


def serialize_bundle_row(row: object) -> dict[str, object]:
    payload: dict[str, object] = {}
    for column in row.__table__.columns:
        value = getattr(row, column.name)
        payload[column.name] = value.isoformat() if isinstance(value, datetime) else value
    return payload


def parse_bundle_datetime(value: object) -> datetime | object:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return value
    return value


def bundle_row_to_model(model: type, payload: dict[str, object]) -> object:
    values: dict[str, object] = {}
    for column in model.__table__.columns:
        if column.name not in payload:
            continue
        value = payload[column.name]
        if value is not None and isinstance(column.type, DateTime):
            value = parse_bundle_datetime(value)
        values[column.name] = value
    return model(**values)


def validate_app_data_bundle(bundle: AppDataBundle) -> None:
    unknown_tables = sorted(set(bundle.tables) - APP_DATA_TABLE_NAMES)
    if unknown_tables:
        raise HTTPException(
            status_code=400,
            detail=f"Import bundle contains unknown tables: {', '.join(unknown_tables)}",
        )

    total_rows = sum(len(rows) for rows in bundle.tables.values())
    if total_rows > settings.max_app_data_rows:
        raise HTTPException(
            status_code=413,
            detail=f"Import bundle exceeds the {settings.max_app_data_rows} row limit",
        )


def dataset_error_response(exc: Exception) -> HTTPException:
    if isinstance(exc, DatasetRefreshInProgress):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, OperationalError) and "database is locked" in str(exc).lower():
        return HTTPException(
            status_code=409,
            detail="Dataset database is busy. Wait for the active refresh to finish, then try again.",
        )
    if isinstance(exc, (FileNotFoundError, ValueError)):
        return HTTPException(status_code=400, detail=str(exc))
    return HTTPException(status_code=500, detail="Dataset operation failed")


def normalize_beta_email(email: str) -> str:
    normalized = email.strip().lower()
    if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
        raise HTTPException(status_code=400, detail="Valid email required")
    return normalized


def normalize_db_datetime(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def purge_expired_beta_sessions(db: Session) -> None:
    current_time = utcnow()
    expired_sessions = db.scalars(select(BetaSession)).all()
    for session in expired_sessions:
        if normalize_db_datetime(session.expires_at) <= current_time:
            db.delete(session)


def sync_beta_program(db: Session) -> BetaProgramStatus:
    purge_expired_beta_sessions(db)
    approved_users = db.scalars(
        select(BetaUser)
        .where(BetaUser.status == "APPROVED")
        .order_by(BetaUser.beta_position.asc(), BetaUser.created_at.asc(), BetaUser.id.asc())
    ).all()
    approved_count = len(approved_users)

    for index, user in enumerate(approved_users, start=1):
        if user.beta_position != index:
            user.beta_position = index

    available_slots = max(settings.beta_seats_total - approved_count, 0)
    if available_slots > 0:
        waitlisted_to_promote = db.scalars(
            select(BetaUser)
            .where(BetaUser.status == "WAITLISTED")
            .order_by(BetaUser.created_at.asc(), BetaUser.id.asc())
            .limit(available_slots)
        ).all()
        next_position = approved_count + 1
        for user in waitlisted_to_promote:
            user.status = "APPROVED"
            user.beta_position = next_position
            next_position += 1
        approved_count += len(waitlisted_to_promote)

    waitlisted_users = db.scalars(
        select(BetaUser)
        .where(BetaUser.status == "WAITLISTED")
        .order_by(BetaUser.created_at.asc(), BetaUser.id.asc())
    ).all()
    for index, user in enumerate(waitlisted_users, start=1):
        if user.beta_position != index:
            user.beta_position = index

    db.flush()
    waitlist_count = len(waitlisted_users)
    seats_taken = min(approved_count, settings.beta_seats_total)
    return BetaProgramStatus(
        seats_total=settings.beta_seats_total,
        seats_taken=seats_taken,
        seats_remaining=max(settings.beta_seats_total - seats_taken, 0),
        waitlist_count=waitlist_count,
    )


def serialize_beta_user(user: BetaUser) -> BetaAuthUser:
    return BetaAuthUser(
        id=user.id,
        email=user.email,
        name=user.name,
        provider="google" if user.provider == "google" else "email",
        approved=user.status == "APPROVED",
        beta_position=user.beta_position,
    )


def issue_beta_session(db: Session, user: BetaUser) -> BetaAuthSessionRead:
    session = BetaSession(
        id=token_urlsafe(24),
        user_id=user.id,
        expires_at=utcnow() + BETA_SESSION_TTL,
    )
    db.add(session)
    db.flush()
    token = create_session_token(user.id, session.id, session.expires_at)
    return BetaAuthSessionRead(
        token=token,
        created_at=session.created_at,
        expires_at=session.expires_at,
        user=serialize_beta_user(user),
    )


def grant_beta_access_response(
    db: Session,
    *,
    email: str,
    name: str,
    provider: str,
) -> BetaAccessResponse:
    user = db.scalar(select(BetaUser).where(BetaUser.email == email))
    if user is None:
        user = BetaUser(
            email=email,
            name=name,
            provider=provider,
            status="WAITLISTED",
        )
        db.add(user)
        db.flush()
    else:
        user.name = name or user.name
        user.provider = provider

    program = sync_beta_program(db)
    user.last_login_at = utcnow()
    session = issue_beta_session(db, user)
    return BetaAccessResponse(session=session, program=program)


def market_data_error_response(exc: Exception) -> HTTPException:
    if isinstance(exc, FileNotFoundError):
        logger.warning("Market data CSV is unavailable: %s", exc)
        return HTTPException(
            status_code=503,
            detail=(
                "Market data is unavailable. Add market data in the app before starting a replay."
            ),
        )
    return HTTPException(status_code=400, detail=str(exc))


def default_market_data_reference(db: Session, user_id: int) -> tuple[Path, int]:
    if market_data is not None:
        return market_data.csv_path, market_data.get_metadata().rows
    resolution = dataset_catalog.resolve_default_dataset(db, user_id)
    metadata = backtester.market_data_for_path(
        str(resolution.csv_path),
        resolution.timezone or "UTC",
    ).get_metadata()
    return resolution.csv_path, metadata.rows


def list_listable_backtest_sessions(
    db: Session,
    user_id: int,
    limit: int | None = None,
) -> list[BacktestSessionRead]:
    candidate_limit = None if limit is None else max(limit * 3, limit)
    sessions = [
        BacktestSessionRead.model_validate(session)
        for session in backtester.list_sessions(db, user_id, limit=candidate_limit)
        if backtester.session_is_listable(session)
    ]
    return sessions[:limit] if limit is not None else sessions


def fetch_json_url(url: str, headers: dict[str, str] | None = None) -> object:
    request = Request(url, headers=headers or {"User-Agent": "edgelab-local-datafeed"})
    try:
        with urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Market catalog returned invalid data") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Market catalog request failed") from exc


def google_oauth_enabled() -> bool:
    return bool(settings.google_client_id and settings.google_client_secret)


def beta_manual_access_enabled() -> bool:
    return bool(getattr(settings, "beta_manual_access_enabled", False))


def fetch_google_token_payload(code: str, redirect_uri: str) -> dict[str, object]:
    if not google_oauth_enabled():
        raise HTTPException(status_code=503, detail="Google OAuth not configured")

    payload = urlencode(
        {
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        }
    ).encode("utf-8")
    request = Request(
        "https://oauth2.googleapis.com/token",
        data=payload,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "EdgeLab/0.1",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            result = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Google token exchange failed") from exc

    if not isinstance(result, dict) or not clean_text(result.get("access_token")):
        raise HTTPException(status_code=502, detail="Google token exchange returned invalid data")
    return result


def fetch_google_userinfo(access_token: str) -> dict[str, object]:
    request = Request(
        "https://openidconnect.googleapis.com/v1/userinfo",
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {access_token}",
            "User-Agent": "EdgeLab/0.1",
        },
    )
    try:
        with urlopen(request, timeout=20) as response:
            result = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Google userinfo request failed") from exc

    email = clean_text(result.get("email")) if isinstance(result, dict) else ""
    if not email:
        raise HTTPException(status_code=502, detail="Google userinfo missing email")
    return result


def fetch_binance_exchange_info() -> object:
    last_error: HTTPException | None = None
    for base_url in BINANCE_REST_URLS:
        try:
            return fetch_json_url(f"{base_url}/exchangeInfo")
        except HTTPException as exc:
            last_error = exc
    raise last_error or HTTPException(status_code=502, detail="Binance instrument catalog is unavailable")


def fetch_dukascopy_json(path: str, params: dict[str, str]) -> object:
    query = urlencode({"path": path, "jsonp": "_edgelab", **params})
    request = Request(f"{DUKASCOPY_URL}?{query}", headers=DUKASCOPY_HEADERS)
    try:
        with urlopen(request, timeout=15) as response:
            body = response.read().decode("utf-8")
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Dukascopy datafeed request failed") from exc

    match = re.match(r"^[^(]*\((.*)\);?$", body, re.S)
    payload = match.group(1) if match else body
    try:
        return json.loads(payload)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Dukascopy returned invalid data") from exc


def clean_text(value: object) -> str:
    return str(value or "").strip()


def clean_int(value: object) -> int | None:
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return None


def clean_float(value: object) -> float | None:
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def angelone_asset_class(exchange: str, instrument_type: str, symbol: str, name: str, token: str) -> str:
    normalized_exchange = exchange.upper()
    normalized_type = instrument_type.upper()
    if normalized_type in {"AMXIDX", "IDX"} or token.startswith("999"):
        return "index"
    if normalized_exchange in {"NSE", "BSE"} and normalized_type in {"", "EQ"}:
        return "equity"
    if normalized_exchange == "MCX":
        return "commodity"
    if normalized_exchange == "CDS":
        return "forex"
    if normalized_exchange in {"NFO", "BFO"} or normalized_type.startswith(("FUT", "OPT")):
        return "derivative"
    return "other"


def normalize_angelone_instrument(value: object) -> AngelOneInstrument | None:
    if not isinstance(value, dict):
        return None
    token = clean_text(value.get("token"))
    symbol = clean_text(value.get("symbol"))
    name = clean_text(value.get("name"))
    exchange = clean_text(value.get("exch_seg")).upper()
    exchange_type = ANGELONE_EXCHANGE_TYPES.get(exchange)
    if not token or not symbol or exchange_type is None:
        return None

    instrument_type = clean_text(value.get("instrumenttype")).upper()
    expiry = clean_text(value.get("expiry")) or None
    lot_size = clean_int(value.get("lotsize"))
    tick_size = clean_float(value.get("tick_size"))
    asset_class = angelone_asset_class(exchange, instrument_type, symbol, name, token)
    label = symbol if not name or name.upper() == symbol.upper() else f"{name} · {symbol}"
    detail_parts = [exchange, instrument_type, expiry or "", f"Lot {lot_size}" if lot_size else ""]
    description = " · ".join(part for part in detail_parts if part)
    return AngelOneInstrument(
        token=token,
        symbol=symbol,
        label=label,
        description=description or exchange,
        exchange=exchange,
        exchange_type=exchange_type,
        asset_class=asset_class,
        name=name or symbol,
        expiry=expiry,
        instrument_type=instrument_type,
        lot_size=lot_size,
        tick_size=tick_size,
    )


def angelone_sort_key(instrument: AngelOneInstrument) -> tuple[int, int, int, str, str]:
    featured_rank = {"99926000": -3, "99926009": -2, "99919000": -1}.get(instrument.token, 0)
    exchange_rank = {"NSE": 0, "BSE": 1, "NFO": 2, "BFO": 3, "MCX": 4, "CDS": 5}.get(instrument.exchange, 9)
    asset_rank = {"index": 0, "equity": 1, "derivative": 2, "commodity": 3, "forex": 4, "other": 5}.get(instrument.asset_class, 9)
    return (exchange_rank, asset_rank, featured_rank, instrument.name, instrument.symbol)


def fetch_angelone_instrument_catalog(refresh: bool = False) -> list[AngelOneInstrument]:
    global angelone_instrument_cache
    now = datetime.now(tz=timezone.utc)
    if angelone_instrument_cache is not None and not refresh:
        fetched_at, cached_instruments = angelone_instrument_cache
        if now - fetched_at < timedelta(seconds=ANGELONE_CATALOG_CACHE_TTL_SECONDS):
            return cached_instruments

    request = Request(ANGELONE_SCRIP_MASTER_URL, headers=ANGELONE_HEADERS)
    try:
        with urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Angel One scrip master returned invalid data") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Angel One scrip master request failed") from exc
    if not isinstance(payload, list):
        raise HTTPException(status_code=502, detail="Angel One scrip master is unavailable")

    instruments = [
        instrument
        for instrument in (normalize_angelone_instrument(row) for row in payload)
        if instrument is not None
    ]
    instruments.sort(key=angelone_sort_key)
    angelone_instrument_cache = (now, instruments)
    return instruments


def angelone_price(value: int | float | None) -> float | None:
    if value is None:
        return None
    return float(value) / 100


def angelone_token(raw_token: bytes) -> str:
    return raw_token.split(b"\x00", 1)[0].decode("ascii", errors="ignore").strip()


def parse_angelone_binary_tick(payload: bytes) -> dict[str, object] | None:
    if len(payload) < 43:
        return None
    mode = payload[0]
    exchange_type = payload[1]
    token = angelone_token(payload[2:27])
    if not token:
        return None

    if mode == 1 and len(payload) >= 51:
        sequence_number, exchange_timestamp, last_traded_price = struct.unpack_from("<qqi", payload, 27)
        last = angelone_price(last_traded_price)
        return {
            "mode": mode,
            "exchangeType": exchange_type,
            "token": token,
            "sequenceNumber": sequence_number,
            "timestamp": exchange_timestamp,
            "last": last,
            "high": last,
            "low": last,
            "close": last,
            "volume": 0,
        }

    if mode in {2, 3} and len(payload) >= 123:
        (
            sequence_number,
            exchange_timestamp,
            last_traded_price,
            last_traded_quantity,
            average_traded_price,
            volume_traded,
            total_buy_quantity,
            total_sell_quantity,
            open_price,
            high_price,
            low_price,
            close_price,
        ) = struct.unpack_from("<QQQqqqd d qqqq".replace(" ", ""), payload, 27)
        return {
            "mode": mode,
            "exchangeType": exchange_type,
            "token": token,
            "sequenceNumber": sequence_number,
            "timestamp": exchange_timestamp,
            "last": angelone_price(last_traded_price),
            "lastQuantity": last_traded_quantity,
            "average": angelone_price(average_traded_price),
            "volume": volume_traded,
            "totalBuyQuantity": total_buy_quantity,
            "totalSellQuantity": total_sell_quantity,
            "open": angelone_price(open_price),
            "high": angelone_price(high_price),
            "low": angelone_price(low_price),
            "close": angelone_price(close_price),
        }

    return None


def parse_forex_factory_datetime(value: object) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Missing event date")
    parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)


def clean_calendar_value(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def normalize_forex_factory_event(value: object) -> EconomicCalendarEvent | None:
    if not isinstance(value, dict):
        return None
    title = str(value.get("title") or "").strip()
    currency = str(value.get("country") or value.get("currency") or "").strip().upper()
    if not title or not currency:
        return None
    try:
        starts_at = parse_forex_factory_datetime(value.get("date"))
    except (TypeError, ValueError):
        return None
    impact = str(value.get("impact") or "Unknown").strip() or "Unknown"
    return EconomicCalendarEvent(
        title=title,
        currency=currency,
        starts_at=starts_at,
        impact=impact,
        forecast=clean_calendar_value(value.get("forecast")),
        previous=clean_calendar_value(value.get("previous")),
        actual=clean_calendar_value(value.get("actual")),
    )


def fetch_forex_factory_calendar() -> list[EconomicCalendarEvent]:
    request = Request(FOREX_FACTORY_CALENDAR_URL, headers=FOREX_FACTORY_HEADERS)
    try:
        with urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Forex Factory calendar returned invalid data") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Forex Factory calendar request failed") from exc
    if not isinstance(payload, list):
        raise HTTPException(status_code=502, detail="Forex Factory calendar is unavailable")
    events = [
        event
        for event in (normalize_forex_factory_event(row) for row in payload)
        if event is not None
    ]
    events.sort(key=lambda item: item.starts_at)
    return events


def forex_factory_calendar_response(events: list[EconomicCalendarEvent], updated_at: datetime, stale: bool) -> EconomicCalendarResponse:
    return EconomicCalendarResponse(
        source_url=FOREX_FACTORY_CALENDAR_URL,
        updated_at=updated_at,
        cache_expires_at=updated_at + timedelta(seconds=FOREX_FACTORY_CACHE_TTL_SECONDS),
        stale=stale,
        events=events,
    )


def dukascopy_asset_class(symbol: str, payload: dict[str, object]) -> str:
    description = str(payload.get("description") or "").lower()
    tags = [str(tag) for tag in payload.get("tag_list") or []]
    base_currency = str(payload.get("base_currency") or "")
    if "/" in symbol and "." not in symbol and symbol.startswith(("XAU", "XAG", "XPD", "XPT")):
        return "commodity"
    if symbol.startswith(("E_", "CHI.IDX", "DOLLAR.IDX")) or ".IDX/" in symbol or "index" in description:
        return "index"
    if symbol.endswith(".CMD/USD") or "oil" in description or "gold" in description or "silver" in description:
        return "commodity"
    if "ETF" in description.upper():
        return "etf"
    if "." in base_currency or ".US/" in symbol or ".HK/" in symbol or ".GB/" in symbol:
        return "equity"
    if "/" in symbol and "FX_CFD_ALL" in tags:
        return "forex"
    return "other"


def dukascopy_label(symbol: str, payload: dict[str, object]) -> str:
    base_currency = str(payload.get("base_currency") or "")
    description = str(payload.get("description") or "")
    if symbol == "E_SandP-500":
        return "S&P 500"
    if symbol == "E_NQ-100":
        return "NASDAQ 100"
    if symbol == "E_D&J-Ind":
        return "DOW 30"
    if symbol == "E_DAAX":
        return "DAX 40"
    if symbol == "E_Brent":
        return "BRENT"
    if symbol == "E_Light":
        return "WTI"
    if base_currency:
        return base_currency.replace(".US", "").replace(".GB", "").replace(".DE", "")
    return description or symbol


def dukascopy_row_to_candle(row: object) -> dict[str, object] | None:
    if not isinstance(row, list) or len(row) < 5 or row[0] is None:
        return None
    timestamp_ms = int(row[0])
    return {
        "time": timestamp_ms // 1000,
        "timestamp": datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc),
        "open": float(row[1]),
        "high": float(row[2]),
        "low": float(row[3]),
        "close": float(row[4]),
        "volume": float(row[5]) if len(row) > 5 and row[5] is not None else 0.0,
        "ema_20": None,
        "ema_50": None,
        "rsi_14": None,
    }


@router.get("/health")
def health(db: Session = Depends(get_db)) -> dict[str, str]:
    db.execute(select(1)).scalar_one()
    return {"status": "ok", "database": "ok"}


@router.get("/ready")
def ready(db: Session = Depends(get_db)) -> dict[str, str]:
    db.execute(select(1)).scalar_one()
    datasets_root = settings.datasets_root
    asset_dirs = [item for item in datasets_root.iterdir() if item.is_dir()] if datasets_root.exists() else []
    timeframes = sum(len(list(directory.glob("*.csv"))) for directory in asset_dirs)
    return {
        "status": "ok",
        "database": "ok",
        "datasets_root": str(datasets_root),
        "dataset_assets": str(len(asset_dirs)),
        "dataset_timeframes": str(timeframes),
    }


@router.get("/auth/beta/status", response_model=BetaProgramStatus)
def beta_program_status(db: Session = Depends(get_db)) -> BetaProgramStatus:
    try:
        status = sync_beta_program(db)
        db.commit()
        return status
    except OperationalError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Beta access status unavailable") from exc


@router.get("/auth/config", response_model=BetaAuthConfig)
def beta_auth_config() -> BetaAuthConfig:
    return BetaAuthConfig(
        google_enabled=google_oauth_enabled(),
        google_client_id=settings.google_client_id or None,
        google_redirect_uri=settings.google_redirect_uri or None,
        manual_access_enabled=beta_manual_access_enabled(),
    )


@router.post("/auth/beta/access", response_model=BetaAccessResponse)
def beta_access(
    payload: BetaAccessRequest,
    db: Session = Depends(get_db),
) -> BetaAccessResponse:
    if not beta_manual_access_enabled():
        raise HTTPException(status_code=403, detail="Manual beta access disabled. Use Google sign-in.")

    email = normalize_beta_email(payload.email)
    name = clean_text(payload.name) or "Beta Trader"

    try:
        response = grant_beta_access_response(
            db,
            email=email,
            name=name,
            provider=payload.provider,
        )
        db.commit()
        return response
    except OperationalError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Beta access request failed") from exc


@router.post("/auth/google/exchange", response_model=BetaAccessResponse)
def exchange_google_auth_code(
    payload: GoogleAuthExchangeRequest,
    db: Session = Depends(get_db),
) -> BetaAccessResponse:
    try:
        token_payload = fetch_google_token_payload(payload.code, payload.redirect_uri)
        userinfo = fetch_google_userinfo(clean_text(token_payload.get("access_token")))
        email = normalize_beta_email(clean_text(userinfo.get("email")))
        name = clean_text(userinfo.get("name")) or email.split("@", 1)[0]
        response = grant_beta_access_response(
            db,
            email=email,
            name=name,
            provider="google",
        )
        db.commit()
        return response
    except OperationalError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Google sign-in failed") from exc


@router.get("/auth/session", response_model=BetaAuthSessionRead)
def read_beta_session(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> BetaAuthSessionRead:
    try:
        sync_beta_program(db)
        db.commit()
        return BetaAuthSessionRead(
            token=create_session_token(
                current_user.id,
                current_user.session_id,
                current_user.session_expires_at,
            ),
            created_at=current_user.session_created_at,
            expires_at=current_user.session_expires_at,
            user=BetaAuthUser(
                id=current_user.id,
                email=current_user.email,
                name=current_user.name,
                provider="google" if current_user.provider == "google" else "email",
                approved=current_user.approved,
                beta_position=current_user.beta_position,
            ),
        )
    except OperationalError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Beta session unavailable") from exc


@router.delete("/auth/session", response_model=dict[str, bool])
def delete_beta_session(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> dict[str, bool]:
    try:
        deleted = db.query(BetaSession).filter(
            BetaSession.id == current_user.session_id,
            BetaSession.user_id == current_user.id,
        ).delete(synchronize_session=False)
        db.commit()
        if deleted == 0:
            raise HTTPException(status_code=401, detail="Valid beta session required")
        return {"ok": True}
    except OperationalError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to clear beta session") from exc


@router.get("/market-data/meta", response_model=DatasetMeta)
def market_data_meta(
    session_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> DatasetMeta:
    try:
        if session_id is not None:
            session = backtester.get_session(db, current_user.id, session_id)
            return backtester.market_data_for_session(session).get_metadata()
        if market_data is None:
            resolution = dataset_catalog.resolve_default_dataset(db, current_user.id)
            return backtester.market_data_for_path(
                str(resolution.csv_path),
                resolution.timezone or "UTC",
            ).get_metadata()
        return market_data.get_metadata()
    except (FileNotFoundError, ValueError) as exc:
        raise market_data_error_response(exc) from exc


@router.get("/datasets", response_model=DatasetCatalogResponse)
def datasets(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> DatasetCatalogResponse:
    try:
        return dataset_catalog.list_catalog(db, current_user.id)
    except (DatasetRefreshInProgress, FileNotFoundError, OperationalError, ValueError) as exc:
        raise dataset_error_response(exc) from exc


@router.get("/datasets/settings", response_model=DatasetSettingsRead)
def dataset_settings(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> DatasetSettingsRead:
    try:
        return dataset_catalog.get_settings(db, current_user.id)
    except (DatasetRefreshInProgress, FileNotFoundError, OperationalError, ValueError) as exc:
        raise dataset_error_response(exc) from exc


@router.patch("/datasets/settings", response_model=DatasetCatalogResponse)
def update_dataset_settings(
    payload: DatasetSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> DatasetCatalogResponse:
    try:
        return dataset_catalog.update_settings(db, current_user.id, payload)
    except (DatasetRefreshInProgress, FileNotFoundError, OperationalError, ValueError) as exc:
        db.rollback()
        raise dataset_error_response(exc) from exc


@router.post("/datasets/refresh", response_model=DatasetRefreshResponse)
def refresh_datasets(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> DatasetRefreshResponse:
    try:
        return dataset_catalog.start_refresh(db, current_user.id)
    except (DatasetRefreshInProgress, FileNotFoundError, OperationalError, ValueError) as exc:
        db.rollback()
        raise dataset_error_response(exc) from exc


@router.get("/datasets/refresh/status", response_model=DatasetRefreshStatus)
def dataset_refresh_status(
    current_user: AuthenticatedUser = Depends(require_auth),
) -> DatasetRefreshStatus:
    return dataset_catalog.refresh_status(current_user.id)


@router.websocket("/datasets/stream")
async def dataset_stream(websocket: WebSocket) -> None:
    db = SessionLocal()
    try:
        current_user = authenticate_websocket(websocket, db)
    except HTTPException:
        db.close()
        await websocket.close(code=4401)
        return

    await websocket.accept()
    last_signature: str | None = None
    try:
        while True:
            payload = await asyncio.to_thread(dataset_catalog_stream_payload, current_user.id)
            signature = json.dumps(payload, sort_keys=True, separators=(",", ":"))
            if signature != last_signature:
                await websocket.send_json(payload)
                last_signature = signature
            try:
                await asyncio.wait_for(
                    websocket.receive_text(),
                    timeout=DATASET_STREAM_INTERVAL_SECONDS,
                )
            except asyncio.TimeoutError:
                continue
    except WebSocketDisconnect:
        return
    finally:
        db.close()


def dataset_catalog_stream_payload(user_id: int) -> dict[str, object]:
    db = SessionLocal()
    try:
        catalog = dataset_catalog.list_catalog(db, user_id)
        return {
            "type": "catalog",
            "catalog": catalog.model_dump(mode="json"),
        }
    except (DatasetRefreshInProgress, FileNotFoundError, OperationalError, ValueError) as exc:
        return {
            "type": "error",
            "message": str(exc),
        }
    finally:
        db.close()


@router.patch("/datasets/assets/{asset_id}", response_model=DatasetCatalogResponse)
def update_dataset_asset(
    asset_id: str,
    payload: DatasetAssetUpdate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> DatasetCatalogResponse:
    try:
        return dataset_catalog.update_asset(db, current_user.id, asset_id, payload)
    except (DatasetRefreshInProgress, FileNotFoundError, OperationalError, ValueError) as exc:
        db.rollback()
        raise dataset_error_response(exc) from exc


@router.get("/app-data/export", response_model=AppDataBundle)
def export_app_data(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> AppDataBundle:
    row_counts = {
        table_name: db.scalar(
            select(func.count()).select_from(model).where(model.user_id == current_user.id)
        )
        or 0
        for table_name, model in APP_DATA_TABLES
    }
    total_rows = sum(row_counts.values())
    if total_rows > settings.max_app_data_rows:
        raise HTTPException(
            status_code=413,
            detail=f"Export exceeds the {settings.max_app_data_rows} row limit",
        )

    tables = {}
    for table_name, model in APP_DATA_TABLES:
        tables[table_name] = [
            serialize_bundle_row(row)
            for row in db.scalars(
                select(model).where(model.user_id == current_user.id)
            ).all()
        ]
    return AppDataBundle(exported_at=utcnow(), tables=tables)


@router.post("/app-data/import", response_model=AppDataImportResult)
def import_app_data(
    bundle: AppDataBundle,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> AppDataImportResult:
    if bundle.app != "edgelab":
        raise HTTPException(status_code=400, detail="Import file is not an EdgeLab data bundle")
    if bundle.version > 1:
        raise HTTPException(status_code=400, detail="Import bundle version is newer than this app supports")
    validate_app_data_bundle(bundle)

    try:
        for _table_name, model in reversed(APP_DATA_TABLES):
            db.query(model).filter(model.user_id == current_user.id).delete(synchronize_session=False)
        db.flush()

        summary: dict[str, int] = {}
        for table_name, model in APP_DATA_TABLES:
            rows = bundle.tables.get(table_name, [])
            summary[table_name] = len(rows)
            batch = []
            for index, row in enumerate(rows, start=1):
                model_row = bundle_row_to_model(model, row)
                if hasattr(model_row, "user_id"):
                    model_row.user_id = current_user.id
                batch.append(model_row)
                if index % APP_DATA_IMPORT_BATCH_SIZE == 0:
                    db.add_all(batch)
                    db.flush()
                    batch = []
            if batch:
                db.add_all(batch)
                db.flush()
        db.commit()
        return AppDataImportResult(imported_at=utcnow(), summary=summary)
    except Exception as exc:
        db.rollback()
        logger.exception("App data import failed")
        raise HTTPException(status_code=400, detail="Import failed") from exc


@router.get("/app-storage/{namespace}/{key}", response_model=AppStorageRead)
def get_app_storage_item(
    namespace: str,
    key: str,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> AppStorageRead:
    item = db.scalar(
        select(AppStorageItem).where(
            AppStorageItem.user_id == current_user.id,
            AppStorageItem.namespace == namespace,
            AppStorageItem.key == key,
        )
    )
    if item is None:
        return AppStorageRead(namespace=namespace, key=key, value=None, updated_at=None)
    return AppStorageRead(
        namespace=item.namespace,
        key=item.key,
        value=item.value,
        updated_at=item.updated_at,
    )


@router.put("/app-storage/{namespace}/{key}", response_model=AppStorageRead)
def put_app_storage_item(
    namespace: str,
    key: str,
    payload: AppStoragePayload,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> AppStorageRead:
    item = db.scalar(
        select(AppStorageItem).where(
            AppStorageItem.user_id == current_user.id,
            AppStorageItem.namespace == namespace,
            AppStorageItem.key == key,
        )
    )
    if item is None:
        item = AppStorageItem(
            user_id=current_user.id,
            namespace=namespace,
            key=key,
            value=payload.value,
        )
        db.add(item)
    else:
        item.value = payload.value
        item.updated_at = utcnow()
    db.commit()
    db.refresh(item)
    return AppStorageRead(
        namespace=item.namespace,
        key=item.key,
        value=item.value,
        updated_at=item.updated_at,
    )


@router.delete("/app-storage/{namespace}/{key}", response_model=AppStorageRead)
def delete_app_storage_item(
    namespace: str,
    key: str,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> AppStorageRead:
    item = db.scalar(
        select(AppStorageItem).where(
            AppStorageItem.user_id == current_user.id,
            AppStorageItem.namespace == namespace,
            AppStorageItem.key == key,
        )
    )
    if item is None:
        return AppStorageRead(namespace=namespace, key=key, value=None, updated_at=None)
    db.delete(item)
    db.commit()
    return AppStorageRead(namespace=namespace, key=key, value=None, updated_at=None)


@router.get("/market-data/bars", response_model=BarsResponse)
def market_data_bars(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=300, ge=1, le=5000),
    warmup: int = Query(default=120, ge=0, le=1000),
    session_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> BarsResponse:
    try:
        service = market_data
        if session_id is not None:
            session = backtester.get_session(db, current_user.id, session_id)
            service = backtester.market_data_for_session(session)
        elif service is None:
            resolution = dataset_catalog.resolve_default_dataset(db, current_user.id)
            service = backtester.market_data_for_path(
                str(resolution.csv_path),
                resolution.timezone or "UTC",
            )
        return service.get_bars(offset=offset, limit=limit, warmup=warmup)
    except (FileNotFoundError, ValueError) as exc:
        raise market_data_error_response(exc) from exc


@router.get("/live/dukascopy/instruments", response_model=DukascopyInstrumentsResponse)
def dukascopy_instruments(
    search: str | None = Query(default=None, max_length=80),
    limit: int = Query(default=120, ge=1, le=5000),
) -> DukascopyInstrumentsResponse:
    data = fetch_dukascopy_json("common/instruments", {})
    if not isinstance(data, dict) or not isinstance(data.get("instruments"), dict):
        raise HTTPException(status_code=502, detail="Dukascopy instrument catalog is unavailable")

    needle = (search or "").strip().lower()
    instruments: list[DukascopyInstrument] = []
    for symbol, raw_payload in data["instruments"].items():
        if not isinstance(symbol, str) or not isinstance(raw_payload, dict):
            continue
        payload = raw_payload
        description = str(payload.get("description") or symbol)
        label = dukascopy_label(symbol, payload)
        haystack = " ".join([symbol, label, description]).lower()
        if needle and needle not in haystack:
            continue
        instruments.append(
            DukascopyInstrument(
                symbol=symbol,
                label=label,
                description=description,
                asset_class=dukascopy_asset_class(symbol, payload),
                base_currency=str(payload.get("base_currency") or ""),
                quote_currency=str(payload.get("quote_currency") or ""),
                tags=[str(tag) for tag in payload.get("tag_list") or []],
            )
        )

    instruments.sort(key=lambda item: (0 if item.asset_class in {"forex", "commodity", "index"} else 1, item.label))
    return DukascopyInstrumentsResponse(instruments=instruments[:limit])


@router.get("/live/binance/instruments", response_model=BinanceInstrumentsResponse)
def binance_instruments(
    search: str | None = Query(default=None, max_length=80),
    limit: int = Query(default=3000, ge=1, le=5000),
) -> BinanceInstrumentsResponse:
    data = fetch_binance_exchange_info()
    if not isinstance(data, dict) or not isinstance(data.get("symbols"), list):
        raise HTTPException(status_code=502, detail="Binance instrument catalog is unavailable")

    needle = (search or "").strip().lower()
    quote_rank = {
        "USDT": 0,
        "USDC": 1,
        "FDUSD": 2,
        "BTC": 3,
        "ETH": 4,
        "BNB": 5,
        "EUR": 6,
        "TRY": 7,
    }
    instruments: list[BinanceInstrument] = []
    for raw_payload in data["symbols"]:
        if not isinstance(raw_payload, dict):
            continue
        symbol = str(raw_payload.get("symbol") or "").strip().upper()
        base_asset = str(raw_payload.get("baseAsset") or "").strip().upper()
        quote_asset = str(raw_payload.get("quoteAsset") or "").strip().upper()
        status = str(raw_payload.get("status") or "").strip().upper()
        if not symbol or not base_asset or not quote_asset or status != "TRADING":
            continue
        if raw_payload.get("isSpotTradingAllowed") is False:
            continue
        label = f"{base_asset}/{quote_asset}"
        description = f"{base_asset} / {quote_asset} spot pair"
        haystack = " ".join([symbol, label, description, base_asset, quote_asset]).lower()
        if needle and needle not in haystack:
            continue
        instruments.append(
            BinanceInstrument(
                symbol=symbol,
                label=label,
                description=description,
                asset_class="crypto",
                base_asset=base_asset,
                quote_asset=quote_asset,
                status=status,
            )
        )

    instruments.sort(key=lambda item: (quote_rank.get(item.quote_asset, 99), item.base_asset, item.symbol))
    return BinanceInstrumentsResponse(instruments=instruments[:limit])


@router.get("/live/angelone/instruments", response_model=AngelOneInstrumentsResponse)
def angelone_instruments(
    search: str | None = Query(default=None, max_length=80),
    limit: int = Query(default=12000, ge=1, le=50000),
    refresh: bool = Query(default=False),
) -> AngelOneInstrumentsResponse:
    instruments = fetch_angelone_instrument_catalog(refresh=refresh)
    words = [word for word in re.split(r"\s+", (search or "").strip().lower()) if word]
    if words:
        instruments = [
            instrument
            for instrument in instruments
            if all(
                word in " ".join(
                    [
                        instrument.token,
                        instrument.symbol,
                        instrument.label,
                        instrument.description,
                        instrument.exchange,
                        instrument.name,
                        instrument.instrument_type,
                        instrument.asset_class,
                    ]
                ).lower()
                for word in words
            )
        ]
    return AngelOneInstrumentsResponse(instruments=instruments[:limit])


@router.get("/live/dukascopy/candles", response_model=DukascopyCandlesResponse)
def dukascopy_candles(
    instrument: str = Query(min_length=1, max_length=80),
    interval: str = Query(default="1HOUR", max_length=12),
    limit: int = Query(default=260, ge=1, le=1000),
) -> DukascopyCandlesResponse:
    normalized_interval = interval.upper()
    if normalized_interval not in DUKASCOPY_INTERVALS:
        raise HTTPException(status_code=400, detail="Unsupported Dukascopy interval")

    data = fetch_dukascopy_json(
        "chart/json3",
        {
            "splits": "true",
            "stocks": "true",
            "time_direction": "P",
            "last_update": str(int(datetime.now(tz=timezone.utc).timestamp() * 1000)),
            "offer_side": "B",
            "instrument": instrument,
            "interval": normalized_interval,
            "limit": str(limit),
        },
    )
    if not isinstance(data, list):
        raise HTTPException(status_code=502, detail="Dukascopy candle feed is unavailable")

    candles = [
        candle
        for candle in (dukascopy_row_to_candle(row) for row in data)
        if candle is not None
    ]
    candles.sort(key=lambda item: int(item["time"]))
    return DukascopyCandlesResponse(candles=candles)


@router.websocket("/live/angelone/stream")
async def angelone_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        initial = await websocket.receive_json()
    except WebSocketDisconnect:
        return
    except Exception:
        await websocket.send_json({"type": "error", "message": "Invalid Angel One stream request"})
        await websocket.close()
        return

    if not isinstance(initial, dict):
        await websocket.send_json({"type": "error", "message": "Invalid Angel One stream request"})
        await websocket.close()
        return

    if not api_token_is_valid(clean_text(initial.get("apiToken"))):
        await websocket.send_json({"type": "error", "message": "Valid API token required"})
        await websocket.close()
        return

    credentials = initial.get("credentials") if isinstance(initial.get("credentials"), dict) else {}
    client_code = clean_text(credentials.get("clientCode"))
    jwt_token = clean_text(credentials.get("jwtToken"))
    api_key = clean_text(credentials.get("apiKey"))
    feed_token = clean_text(credentials.get("feedToken"))
    symbols = initial.get("symbols")
    if not client_code or not jwt_token or not api_key or not feed_token:
        await websocket.send_json({"type": "error", "message": "SmartAPI client code, JWT token, API key, and feed token are required"})
        await websocket.close()
        return
    if not isinstance(symbols, list) or not symbols:
        await websocket.send_json({"type": "error", "message": "Choose at least one Angel One instrument"})
        await websocket.close()
        return

    token_groups: dict[int, list[str]] = {}
    for item in symbols:
        if not isinstance(item, dict):
            continue
        exchange_type = clean_int(item.get("exchangeType"))
        token = clean_text(item.get("token"))
        if exchange_type is None or not token:
            continue
        token_groups.setdefault(exchange_type, [])
        if token not in token_groups[exchange_type]:
            token_groups[exchange_type].append(token)

    if not token_groups:
        await websocket.send_json({"type": "error", "message": "Angel One instruments are missing token metadata"})
        await websocket.close()
        return

    try:
        import websockets
    except Exception:
        await websocket.send_json({"type": "error", "message": "Live streaming is not available right now."})
        await websocket.close()
        return

    headers = {
        "x-client-code": client_code,
        "Authorization": jwt_token,
        "x-api-key": api_key,
        "x-feed-token": feed_token,
    }
    subscribe_payload = {
        "correlationID": "edgelab-angelone-live",
        "action": 1,
        "params": {
            "mode": 2,
            "tokenList": [
                {"exchangeType": exchange_type, "tokens": tokens[:50]}
                for exchange_type, tokens in token_groups.items()
            ],
        },
    }

    try:
        try:
            upstream_connection = websockets.connect(ANGELONE_WS_URL, additional_headers=headers, ping_interval=None)
        except TypeError:
            upstream_connection = websockets.connect(ANGELONE_WS_URL, extra_headers=headers, ping_interval=None)

        async with upstream_connection as upstream:
            await upstream.send(json.dumps(subscribe_payload))
            await websocket.send_json({"type": "status", "status": "subscribed"})

            async def pump_upstream() -> None:
                async for message in upstream:
                    if isinstance(message, bytes):
                        tick = parse_angelone_binary_tick(message)
                        if tick is not None:
                            await websocket.send_json({"type": "tick", "tick": tick})
                    elif isinstance(message, str) and message.lower() not in {"pong", "ping"}:
                        await websocket.send_json({"type": "message", "message": message})

            async def ping_upstream() -> None:
                while True:
                    await asyncio.sleep(10)
                    await upstream.send("ping")

            async def watch_client() -> None:
                while True:
                    await websocket.receive_text()

            tasks = {
                asyncio.create_task(pump_upstream()),
                asyncio.create_task(ping_upstream()),
                asyncio.create_task(watch_client()),
            }
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_EXCEPTION)
            for task in pending:
                task.cancel()
            for task in done:
                task.result()
    except WebSocketDisconnect:
        return
    except Exception:
        logger.exception("Angel One live feed failed")
        try:
            await websocket.send_json({"type": "error", "message": "Angel One live feed failed"})
        except Exception:
            return


@router.get("/economic-calendar/forex-factory", response_model=EconomicCalendarResponse)
def forex_factory_calendar(
    refresh: bool = Query(default=False),
) -> EconomicCalendarResponse:
    global forex_factory_calendar_cache

    now = datetime.now(tz=timezone.utc)
    if forex_factory_calendar_cache is not None and not refresh:
        fetched_at, events = forex_factory_calendar_cache
        if now - fetched_at < timedelta(seconds=FOREX_FACTORY_CACHE_TTL_SECONDS):
            return forex_factory_calendar_response(events, fetched_at, stale=False)

    try:
        events = fetch_forex_factory_calendar()
        forex_factory_calendar_cache = (now, events)
        return forex_factory_calendar_response(events, now, stale=False)
    except HTTPException:
        if forex_factory_calendar_cache is None:
            raise
        fetched_at, events = forex_factory_calendar_cache
        return forex_factory_calendar_response(events, fetched_at, stale=True)


@router.get("/bootstrap", response_model=AppBootstrapResponse)
def bootstrap(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> AppBootstrapResponse:
    return AppBootstrapResponse(
        datasets=dataset_catalog.list_catalog(db, current_user.id),
        playbooks=backtester.list_playbooks(db, current_user.id),
        recent_sessions=list_listable_backtest_sessions(
            db,
            current_user.id,
            limit=BOOTSTRAP_SESSION_LIMIT,
        ),
        recent_trades=backtester.list_trades(
            db,
            current_user.id,
            limit=BOOTSTRAP_TRADE_LIMIT,
        ),
        recent_session_limit=BOOTSTRAP_SESSION_LIMIT,
        recent_trade_limit=BOOTSTRAP_TRADE_LIMIT,
    )


@router.post("/backtests", response_model=BacktestState)
def create_backtest(
    payload: BacktestCreate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> BacktestState:
    try:
        return backtester.create_session(db, current_user.id, payload)
    except (FileNotFoundError, ValueError) as exc:
        db.rollback()
        raise market_data_error_response(exc) from exc


@router.get("/backtests", response_model=list[BacktestSessionRead])
def list_backtests(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[BacktestSessionRead]:
    return list_listable_backtest_sessions(db, current_user.id)


@router.get("/backtests/latest", response_model=BacktestState)
def latest_backtest(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> BacktestState:
    try:
        for session in backtester.list_sessions(db, current_user.id):
            if not backtester.session_has_replay_data(session):
                continue
            try:
                return backtester.get_state(db, current_user.id, session.id)
            except (FileNotFoundError, ValueError):
                db.rollback()
                continue
        raise HTTPException(status_code=404, detail="No replay session exists yet")
    except HTTPException:
        raise
    except (FileNotFoundError, ValueError) as exc:
        db.rollback()
        raise market_data_error_response(exc) from exc


@router.post("/backtests/import-trades", response_model=BacktestTradeImportResult)
def import_backtest_trades(
    payload: BacktestTradeImport,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> BacktestTradeImportResult:
    try:
        try:
            fallback_csv_path, fallback_rows = default_market_data_reference(db, current_user.id)
        except (FileNotFoundError, ValueError):
            fallback_csv_path = settings.datasets_root
            fallback_rows = 1
        return import_trade_csv(
            db,
            current_user.id,
            payload,
            fallback_csv_path=fallback_csv_path,
            fallback_rows=fallback_rows,
        )
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/backtests/{session_id}", response_model=BacktestState)
def get_backtest(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> BacktestState:
    try:
        return backtester.get_state(db, current_user.id, session_id)
    except (FileNotFoundError, ValueError) as exc:
        raise market_data_error_response(exc) from exc


@router.patch("/backtests/{session_id}", response_model=BacktestSessionRead)
def patch_backtest_session(
    session_id: int,
    payload: BacktestSessionUpdate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> BacktestSessionRead:
    return BacktestSessionRead.model_validate(
        backtester.update_session(db, current_user.id, session_id, payload),
    )


@router.delete("/backtests/{session_id}")
def delete_backtest_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> dict[str, bool]:
    backtester.delete_session(db, current_user.id, session_id)
    return {"ok": True}


@router.post("/backtests/{session_id}/advance", response_model=BacktestState)
def advance_backtest(
    session_id: int,
    payload: BacktestAdvanceRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> BacktestState:
    return backtester.advance(db, current_user.id, session_id, payload)


@router.post("/backtests/{session_id}/jump", response_model=BacktestState)
def jump_backtest(
    session_id: int,
    payload: BacktestJumpRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> BacktestState:
    return backtester.jump(db, current_user.id, session_id, payload)


@router.post("/backtests/{session_id}/orders", response_model=BacktestState)
def create_order(
    session_id: int,
    payload: OrderCreate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> BacktestState:
    return backtester.place_order(db, current_user.id, session_id, payload)


@router.patch("/backtests/{session_id}/orders/{order_id}", response_model=BacktestState)
def amend_order(
    session_id: int,
    order_id: int,
    payload: OrderUpdate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> BacktestState:
    return backtester.update_order(db, current_user.id, session_id, order_id, payload)


@router.patch("/backtests/{session_id}/position", response_model=BacktestState)
def amend_position(
    session_id: int,
    payload: PositionUpdate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> BacktestState:
    return backtester.update_position(db, current_user.id, session_id, payload)


@router.delete("/backtests/{session_id}/orders/{order_id}", response_model=BacktestState)
def cancel_order(
    session_id: int,
    order_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> BacktestState:
    return backtester.cancel_order(db, current_user.id, session_id, order_id)


@router.get("/playbooks", response_model=list[PlaybookRead])
def get_playbooks(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[PlaybookRead]:
    return backtester.list_playbooks(db, current_user.id)


@router.post("/playbooks", response_model=PlaybookRead)
def create_playbook(
    payload: PlaybookCreate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> PlaybookRead:
    return backtester.create_playbook(db, current_user.id, payload)


@router.patch("/playbooks/{playbook_id}", response_model=PlaybookRead)
def update_playbook(
    playbook_id: int,
    payload: PlaybookUpdate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> PlaybookRead:
    return backtester.update_playbook(db, current_user.id, playbook_id, payload)


@router.delete("/playbooks/{playbook_id}")
def delete_playbook(
    playbook_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> dict[str, bool]:
    backtester.delete_playbook(db, current_user.id, playbook_id)
    return {"ok": True}


@router.get("/trades", response_model=list[TradeRead])
def get_trades(
    session_id: int | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=2000),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[TradeRead]:
    return backtester.list_trades(
        db,
        current_user.id,
        session_id,
        offset=offset,
        limit=limit,
    )


@router.patch("/trades/{trade_id}/journal", response_model=TradeRead)
def patch_journal(
    trade_id: int,
    payload: JournalUpdate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> TradeRead:
    return backtester.update_journal(db, current_user.id, trade_id, payload)


@router.patch("/trades/{trade_id}/strategy", response_model=TradeRead)
def patch_trade_strategy(
    trade_id: int,
    payload: TradeStrategyUpdate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> TradeRead:
    return backtester.update_trade_strategy(db, current_user.id, trade_id, payload)


@router.get("/metrics", response_model=MetricsResponse)
def metrics(
    session_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> MetricsResponse:
    if session_id is None:
        session = list_latest_session(db, current_user.id)
        session_id = session.id if session else None
    return get_metrics(db, current_user.id, session_id)
