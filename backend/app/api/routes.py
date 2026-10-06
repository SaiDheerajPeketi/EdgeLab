import asyncio
from base64 import urlsafe_b64decode, urlsafe_b64encode
import binascii
import json
import logging
import os
import re
from secrets import compare_digest, token_urlsafe
import struct
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse
from urllib.parse import urlencode
from urllib.request import Request as UrlRequest
from urllib.request import urlopen

from fastapi import (
    APIRouter,
    Depends,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.params import Param
from fastapi.responses import StreamingResponse
from sqlalchemy import Date as SQLDate, DateTime, func, select, update
from sqlalchemy.exc import IntegrityError, OperationalError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import (
    AuthenticatedUser,
    authenticate_token,
    create_session_token,
    require_auth,
)
from app.config import settings
from app.db import SessionLocal, get_db
from app.market_data_db import MarketDataSessionLocal
from app.models import (
    AppStorageItem,
    BacktestSession,
    BacktestSessionSummary,
    BetaSession,
    BetaUser,
    DatasetAsset,
    DatasetSettings,
    DatasetTimeframe,
    Execution,
    FeedbackSubmission,
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
    Order,
    Playbook,
    Position,
    Trade,
    TradeNote,
    UserDashboardSummary,
    utcnow,
)
from app.schemas import (
    AppDataBundle,
    AppBootstrapResponse,
    AppBootstrapShellResponse,
    AppDataImportResult,
    AppDataOperationReserve,
    AppDataOperationRead,
    AppStoragePayload,
    AppStorageRead,
    ChartSettingsRead,
    ChartSettingsUpdate,
    SettingsPreferencesUpdate,
    JournalSettingsUpdate,
    AngelOneInstrument,
    AngelOneInstrumentsResponse,
    AIBacktestRead,
    AIBacktestRequest,
    AIConversationCreate,
    AIConversationRead,
    AIChartImageMetadata,
    AIChartImageUpload,
    AIGeneratedArtifactRead,
    AIGenerationJobRead,
    AIGenerationRequest,
    AIJobEventRead,
    AIModelRead,
    AIRetentionResult,
    AIUsageSummaryRead,
    BetaAccessRequest,
    BetaAccessResponse,
    BetaAuthConfig,
    UiRolloutConfig,
    BetaAuthSessionRead,
    BetaAuthUser,
    BetaProgramStatus,
    BacktestAdvanceRequest,
    BacktestCreate,
    BacktestJumpRequest,
    BacktestReplayUpdate,
    BacktestSessionPage,
    BacktestSessionRead,
    BacktestSessionUpdate,
    BacktestState,
    BacktestTradeImport,
    BacktestTradeImportResult,
    BarsResponse,
    BinanceInstrument,
    BinanceInstrumentsResponse,
    BrokerAccountRead,
    BrokerAuditRead,
    BrokerConnectionCreate,
    BrokerConnectionRead,
    BrokerFillRead,
    BrokerOrderRead,
    BrokerPositionRead,
    BrokerProviderRead,
    BrokerSyncJobRead,
    BrokerSyncRefreshRequest,
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
    FeedbackCreate,
    FeedbackRead,
    ContinuousContractRuleCreate,
    ContinuousContractRuleRead,
    ExchangeCalendarCreate,
    ExchangeCalendarRead,
    FootprintBuildRequest,
    FootprintRead,
    GoogleAuthExchangeRequest,
    IntegrationSecretConnectionRead,
    IntegrationSecretCreate,
    IntegrationSecretRead,
    IntegrationSecretReplace,
    CanonicalTradeCreate,
    CanonicalTradeRead,
    CanonicalTradeReviewUpdate,
    JournalAccountCreate,
    JournalAccountRead,
    JournalBackfillResult,
    JournalDailyNoteRead,
    JournalDailyNoteUpsert,
    JournalImportCreate,
    JournalImportResult,
    JournalImportRunRead,
    JournalTagCreate,
    JournalTagRead,
    JournalUpdate,
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
    MarketProviderRead,
    MarketProviderStateRead,
    MarketStreamEventRead,
    MarketSubscriptionCreate,
    MarketSubscriptionRead,
    MarketTradeTickRead,
    MetricsResponse,
    MetricsCurvesResponse,
    MetricsSummaryResponse,
    OrderCreate,
    OrderUpdate,
    OrderBookRead,
    PlaybookCreate,
    PlaybookRead,
    PlaybookUpdate,
    PositionUpdate,
    QuantScriptCreate,
    QuantScriptPermissionCreate,
    QuantScriptPermissionRead,
    QuantScriptRead,
    QuantScriptVersionCreate,
    QuantScriptVersionRead,
    NormalizedCandleRead,
    StrategySummary,
    TradeRead,
    TradePage,
    TradeStrategyUpdate,
    WorkspaceShareCreate,
    WorkspaceShareCreatedRead,
    WorkspaceShareOwnerRead,
    WorkspaceSharePublicRead,
)
from app.services import (
    app_data_operations,
    broker_sync,
    integration_secrets,
    journal,
    market_infrastructure,
    quant_ai,
    share_snapshots,
)
from app.services.backtester import BacktestService, list_latest_session
from app.services.dashboard_summaries import load_user_dashboard_summary
from app.services.datasets import DatasetCatalogService, DatasetRefreshInProgress
from app.services.market_data import MarketDataService
from app.services.metrics import get_metrics, get_metrics_curves, get_metrics_summary
from app.services.rate_limits import build_rate_limiter
from app.services.read_models import ReadModelCacheService
from app.services.strategy_summaries import build_strategy_summaries
from app.services.trade_imports import import_trade_csv
from app.services.settings import read_chart_settings, patch_chart_settings, patch_settings_preferences


router = APIRouter(route_class=app_data_operations.AppDataOperationRoute)
logger = logging.getLogger(__name__)
DATASET_STREAM_INTERVAL_SECONDS = 3
WEBSOCKET_AUTH_TIMEOUT_SECONDS = 5
BOOTSTRAP_SESSION_LIMIT = 25
BOOTSTRAP_TRADE_LIMIT = 100
SESSION_SUMMARIES_LIMIT = 50
SESSION_SUMMARIES_LIMIT_MAX = 200
BOOTSTRAP_SHELL_SESSION_LIMIT = SESSION_SUMMARIES_LIMIT
market_data = (
    MarketDataService(settings.csv_path, cache=settings.cache_market_data)
    if settings.csv_path is not None
    else None
)
dataset_catalog = DatasetCatalogService(
    settings.datasets_root,
    SessionLocal,
    market_data_import_enabled=settings.market_data_import_enabled,
    auto_discovery_enabled=settings.dataset_auto_discovery_enabled,
    market_data_session_factory=MarketDataSessionLocal,
)
backtester = BacktestService(market_data, dataset_catalog)
read_model_cache = ReadModelCacheService(
    bootstrap_shell_ttl_seconds=settings.bootstrap_shell_cache_ttl_seconds,
    dataset_catalog_ttl_seconds=settings.dataset_catalog_cache_ttl_seconds,
    redis_url=settings.redis_url,
)
rate_limiter = build_rate_limiter(settings.redis_url)
WORKSPACE_SHARE_CREATE_RATE_LIMIT = 30
WORKSPACE_SHARE_MANAGEMENT_RATE_LIMIT = 120
WORKSPACE_SHARE_OPEN_RATE_LIMIT = 240
INTEGRATION_SECRET_WRITE_RATE_LIMIT = 30
INTEGRATION_SECRET_READ_RATE_LIMIT = 120
INTEGRATION_SECRET_CONNECT_RATE_LIMIT = 60
BROKER_READ_RATE_LIMIT = 180
JOURNAL_READ_RATE_LIMIT = 240
JOURNAL_WRITE_RATE_LIMIT = 120
JOURNAL_IMPORT_RATE_LIMIT = 20
APP_DATA_OPERATION_RATE_LIMIT = 600
BROKER_WRITE_RATE_LIMIT = 30
BROKER_SYNC_RATE_LIMIT = 30
NORMALIZED_MARKET_READ_RATE_LIMIT = 240
NORMALIZED_MARKET_WRITE_RATE_LIMIT = 60
NORMALIZED_MARKET_BACKFILL_RATE_LIMIT = 20
AI_READ_RATE_LIMIT = 240
AI_WRITE_RATE_LIMIT = 120
AI_GENERATION_RATE_LIMIT = 30


def bootstrap_shell_cache_scope(user_id: int) -> str:
    return f"{id(backtester)}:{user_id}"


def dataset_catalog_cache_scope(user_id: int) -> str:
    return f"{id(dataset_catalog)}:{user_id}"

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
FOREX_FACTORY_CACHE_TTL_SECONDS = 60
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
    ("journal_accounts", JournalAccount),
    ("journal_import_runs", JournalImportRun),
    ("canonical_trades", CanonicalTrade),
    ("canonical_executions", CanonicalExecution),
    ("journal_tags", JournalTag),
    ("canonical_trade_tags", CanonicalTradeTag),
    ("canonical_trade_notes", CanonicalTradeNote),
    ("canonical_trade_screenshots", CanonicalTradeScreenshot),
    ("journal_daily_notes", JournalDailyNote),
    ("journal_import_rows", JournalImportRow),
    ("journal_import_diagnostics", JournalImportDiagnostic),
    ("journal_backfill_checkpoints", JournalBackfillCheckpoint),
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


def parse_bundle_date(value: object) -> date | object:
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value)
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
        elif value is not None and isinstance(column.type, SQLDate):
            value = parse_bundle_date(value)
        values[column.name] = value
    return model(**values)


def validate_app_data_bundle(bundle: AppDataBundle, db: Session, user_id: int) -> None:
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

    # Portable IDs preserve replay/review deep links, but never grant ownership
    # of existing rows. Validate the complete graph before replacement begins.
    if type(bundle.version) is not int or bundle.version != 1:
        raise HTTPException(status_code=400, detail="Import requires an EdgeLab version 1 bundle")
    ids: dict[str, set[int]] = {}
    for table_name, model in APP_DATA_TABLES:
        columns = model.__table__.columns
        table_ids: set[int] = set()
        for row in bundle.tables.get(table_name, []):
            if set(row) - set(columns.keys()):
                raise HTTPException(status_code=400, detail=f"Import table {table_name} contains unsupported fields")
            row_id = row.get("id")
            if type(row_id) is not int or not 0 < row_id <= 2**63 - 1 or row_id in table_ids:
                raise HTTPException(status_code=400, detail=f"Import table {table_name} requires distinct positive integer IDs")
            table_ids.add(row_id)
            for column in columns:
                if column.name in {"id", "user_id"}:
                    continue
                if row.get(column.name) is None and not column.nullable and column.default is None and column.server_default is None:
                    raise HTTPException(status_code=400, detail=f"Import table {table_name} is missing a required field")
        ids[table_name] = table_ids

    for table_name, model in APP_DATA_TABLES:
        incoming_ids = list(ids[table_name])
        for start in range(0, len(incoming_ids), APP_DATA_IMPORT_BATCH_SIZE):
            foreign_id = db.scalar(select(model.id).where(
                model.id.in_(incoming_ids[start:start + APP_DATA_IMPORT_BATCH_SIZE]),
                model.user_id.is_distinct_from(user_id),
            ).limit(1))
            if foreign_id is not None:
                raise HTTPException(status_code=400, detail=f"Import table {table_name} contains an unavailable ID")
        for column in model.__table__.columns:
            if column.name == "user_id":
                continue  # The authenticated owner replaces every supplied user_id.
            for foreign_key in column.foreign_keys:
                values = set()
                for row in bundle.tables.get(table_name, []):
                    value = row.get(column.name)
                    if value is None:
                        continue
                    if type(value) is not int or not 0 < value <= 2**63 - 1:
                        raise HTTPException(status_code=400, detail=f"Import table {table_name} contains an invalid reference")
                    values.add(value)
                target = foreign_key.column.table
                if target.name in ids:
                    found = ids[target.name]
                else:
                    # The only retained target is an owned broker account;
                    # never accept an unrestricted reference to another owner.
                    found = set()
                    reference_ids = list(values)
                    for start in range(0, len(reference_ids), APP_DATA_IMPORT_BATCH_SIZE):
                        found.update(db.scalars(select(foreign_key.column).where(
                            foreign_key.column.in_(reference_ids[start:start + APP_DATA_IMPORT_BATCH_SIZE]),
                            target.c.user_id == user_id,
                        )).all())
                if not values.issubset(found):
                    raise HTTPException(status_code=400, detail=f"Import table {table_name} references missing or unavailable rows")


def dataset_error_response(exc: Exception) -> HTTPException:
    if isinstance(exc, DatasetRefreshInProgress):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, OperationalError) and "database is locked" in str(exc).lower():
        return HTTPException(
            status_code=409,
            detail="Dataset database is busy. Wait for the active refresh to finish, then try again.",
        )
    if isinstance(exc, (OSError, SQLAlchemyError)):
        logger.exception("Dataset operation failed")
        return HTTPException(status_code=500, detail="Dataset operation failed")
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


def enforce_rate_limit(bucket: str, user_id: int, limit: int) -> None:
    decision = rate_limiter.consume(
        f"rate-limit:{bucket}:user:{user_id}",
        limit=limit,
        window_seconds=settings.rate_limit_window_seconds,
    )
    if decision.allowed:
        return
    raise HTTPException(
        status_code=429,
        detail="Rate limit exceeded",
        headers={"Retry-After": str(decision.retry_after_seconds)},
    )


def integration_secret_error(exc: integration_secrets.IntegrationSecretError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.public_message)


def normalized_market_error(
    exc: market_infrastructure.MarketInfrastructureError,
) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.public_message)


def quant_ai_error(exc: quant_ai.AIServiceError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.public_message)


def broker_service_error(
    exc: broker_sync.BrokerServiceError | integration_secrets.IntegrationSecretError,
) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.public_message)


def journal_service_error(exc: journal.JournalServiceError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.public_message)


def default_market_data_reference(db: Session, user_id: int) -> tuple[Path, int]:
    if market_data is not None:
        return market_data.csv_path, market_data.get_metadata().rows
    resolution = dataset_catalog.resolve_default_dataset(db, user_id)
    metadata = backtester.market_data_for_path(
        str(resolution.csv_path),
        resolution.timezone or "UTC",
        db=db,
        user_id=user_id,
    ).get_metadata()
    return resolution.csv_path, metadata.rows


def requested_market_data_service(
    db: Session,
    user_id: int,
    *,
    session_id: int | None = None,
    dataset_asset_id: int | None = None,
    timeframe: str | None = None,
):
    session_id = session_id.default if isinstance(session_id, Param) else session_id
    dataset_asset_id = (
        dataset_asset_id.default if isinstance(dataset_asset_id, Param) else dataset_asset_id
    )
    timeframe = timeframe.default if isinstance(timeframe, Param) else timeframe
    if session_id is not None:
        session = backtester.get_session(db, user_id, session_id)
        return backtester.market_data_for_session(session)
    if dataset_asset_id is not None or timeframe is not None:
        if dataset_asset_id is None or timeframe is None:
            raise ValueError("dataset_asset_id and timeframe are required together")
        service = backtester.market_data_for_dataset_identity(
            db,
            user_id,
            asset_id=dataset_asset_id,
            timeframe=timeframe,
            csv_path=None,
            timestamp_timezone="UTC",
        )
        if service is None:
            raise FileNotFoundError("Requested dataset timeframe is unavailable")
        return service
    if market_data is not None:
        return market_data
    resolution = dataset_catalog.resolve_default_dataset(db, user_id)
    return backtester.market_data_for_path(
        str(resolution.csv_path),
        resolution.timezone or "UTC",
        db=db,
        user_id=user_id,
    )


def list_listable_backtest_sessions(
    db: Session,
    user_id: int,
    limit: int | None = None,
) -> list[BacktestSessionRead]:
    return [
        BacktestSessionRead.model_validate(session)
        for session in backtester.list_listable_sessions(db, user_id, limit=limit)
    ]


def list_listable_backtest_sessions_page(
    db: Session,
    user_id: int,
    offset: int = 0,
    limit: int = SESSION_SUMMARIES_LIMIT,
    cursor: str | None = None,
    status: str | None = None,
) -> BacktestSessionPage:
    cursor_value = decode_page_cursor(cursor) if cursor else None
    rows = backtester.list_listable_sessions(
        db,
        user_id,
        offset=offset,
        limit=limit + 1,
        cursor=cursor_value,
        status=status,
    )
    has_more = len(rows) > limit
    rows = rows[:limit]
    items = [
        BacktestSessionRead.model_validate(session) for session in rows
    ]
    next_offset = offset + len(items)
    return BacktestSessionPage(
        items=items,
        offset=offset,
        limit=limit,
        next_offset=next_offset,
        next_cursor=encode_page_cursor(rows[-1].created_at, rows[-1].id) if has_more and rows else None,
        has_more=has_more,
    )


def normalize_page_cursor_timestamp(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def encode_page_cursor(timestamp: datetime, row_id: int) -> str:
    normalized = normalize_page_cursor_timestamp(timestamp)
    payload = f"{normalized.isoformat()}|{row_id}".encode("utf-8")
    return urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def decode_page_cursor(cursor: str) -> tuple[datetime, int]:
    try:
        padded = cursor + ("=" * (-len(cursor) % 4))
        decoded = urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
        timestamp_text, row_id_text = decoded.rsplit("|", 1)
        return normalize_page_cursor_timestamp(datetime.fromisoformat(timestamp_text)), int(
            row_id_text
        )
    except (ValueError, binascii.Error, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid cursor") from exc


def fetch_json_url(url: str, headers: dict[str, str] | None = None) -> object:
    request = UrlRequest(url, headers=headers or {"User-Agent": "edgelab-local-datafeed"})
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


LOCAL_DEV_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}


def is_local_dev_host(host: str | None) -> bool:
    if not host:
        return False
    return host.strip().strip("[]").lower() in LOCAL_DEV_HOSTS


def is_local_dev_origin(origin: str) -> bool:
    parsed = urlparse(origin)
    host = parsed.hostname or origin.split(":", 1)[0]
    return is_local_dev_host(host)


def dev_auth_bypass_enabled() -> bool:
    if not bool(getattr(settings, "dev_auth_bypass_enabled", False)):
        return False
    if settings.public_origin and not is_local_dev_origin(settings.public_origin):
        return False
    return bool(settings.cors_origins) and all(
        is_local_dev_origin(origin) for origin in settings.cors_origins
    )


def local_dev_request_allowed(request: Request) -> bool:
    host = request.url.hostname
    client_host = request.client.host if request.client else None
    return is_local_dev_host(host) and is_local_dev_host(client_host)


def fetch_google_token_payload(code: str, redirect_uri: str) -> dict[str, object]:
    if not google_oauth_enabled():
        raise HTTPException(status_code=503, detail="Google OAuth not configured")
    expected_redirect_uri = settings.google_redirect_uri.strip()
    supplied_redirect_uri = redirect_uri.strip()
    if not expected_redirect_uri or not compare_digest(supplied_redirect_uri, expected_redirect_uri):
        raise HTTPException(status_code=400, detail="Invalid OAuth redirect URI")

    payload = urlencode(
        {
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": expected_redirect_uri,
        }
    ).encode("utf-8")
    request = UrlRequest(
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
    request = UrlRequest(
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
        dev_auth_bypass_enabled=dev_auth_bypass_enabled(),
    )


_UI_ROLLOUT_TRUE_VALUES = frozenset({"1", "true", "yes", "on"})
_UI_ROLLOUT_FALSE_VALUES = frozenset({"0", "false", "no", "off"})
_UI_ROLLOUT_FLAG_ENV = {
    "shell": "EDGELAB_UI_SHELL_V2",
    "journal": "EDGELAB_UI_JOURNAL_V2",
    "settings": "EDGELAB_UI_SETTINGS_V2",
    "chart": "EDGELAB_UI_CHART_V2",
    "public": "EDGELAB_UI_PUBLIC_V2",
}
_UI_ROLLOUT_SHELL_DEPENDENTS = ("journal", "settings", "chart")


def _ui_rollout_env_enabled(name: str, *, default: bool, invalid: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    normalized = raw.strip().lower()
    if normalized in _UI_ROLLOUT_TRUE_VALUES:
        return True
    if normalized in _UI_ROLLOUT_FALSE_VALUES:
        return False
    return invalid


@router.get("/ui/rollout", response_model=UiRolloutConfig)
def ui_rollout_config(response: Response) -> UiRolloutConfig:
    """Return deploy-time UI migration flags without exposing operator secrets."""

    response.headers["Cache-Control"] = "no-store, max-age=0"
    response.headers["Pragma"] = "no-cache"
    kill_switch = _ui_rollout_env_enabled(
        "EDGELAB_UI_KILL_SWITCH",
        default=False,
        invalid=True,
    )
    flags = {
        group: _ui_rollout_env_enabled(name, default=True, invalid=False)
        for group, name in _UI_ROLLOUT_FLAG_ENV.items()
    }
    if kill_switch:
        flags = {group: False for group in flags}
    elif not flags["shell"]:
        for group in _UI_ROLLOUT_SHELL_DEPENDENTS:
            flags[group] = False

    return UiRolloutConfig(
        revision=(os.getenv("EDGELAB_UI_REVISION", "v2").strip() or "v2")[:128],
        kill_switch=kill_switch,
        flags=flags,
    )


@router.post("/auth/dev/bypass", response_model=BetaAccessResponse)
def dev_auth_bypass(
    request: Request,
    db: Session = Depends(get_db),
) -> BetaAccessResponse:
    if not dev_auth_bypass_enabled() or not local_dev_request_allowed(request):
        raise HTTPException(status_code=404, detail="Local development auth bypass unavailable")

    try:
        response = grant_beta_access_response(
            db,
            email="developer@localhost.edgelab",
            name="Local Developer",
            provider="email",
        )
        db.commit()
        return response
    except OperationalError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Local development sign-in failed") from exc


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
    dataset_asset_id: int | None = Query(default=None, ge=1),
    timeframe: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> DatasetMeta:
    enforce_rate_limit("market-data-meta", current_user.id, settings.market_data_meta_rate_limit)
    try:
        return requested_market_data_service(
            db,
            current_user.id,
            session_id=session_id,
            dataset_asset_id=dataset_asset_id,
            timeframe=timeframe,
        ).get_metadata()
    except (FileNotFoundError, ValueError) as exc:
        raise market_data_error_response(exc) from exc


@router.get("/datasets", response_model=DatasetCatalogResponse)
def datasets(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> DatasetCatalogResponse:
    try:
        return cached_dataset_catalog_response(db, current_user.id)
    except (DatasetRefreshInProgress, FileNotFoundError, OSError, SQLAlchemyError, ValueError) as exc:
        raise dataset_error_response(exc) from exc


@router.get("/datasets/settings", response_model=DatasetSettingsRead)
def dataset_settings(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> DatasetSettingsRead:
    try:
        return dataset_catalog.get_settings(db, current_user.id)
    except (DatasetRefreshInProgress, FileNotFoundError, OSError, SQLAlchemyError, ValueError) as exc:
        raise dataset_error_response(exc) from exc


@router.patch("/datasets/settings", response_model=DatasetCatalogResponse)
def update_dataset_settings(
    payload: DatasetSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> DatasetCatalogResponse:
    try:
        response = dataset_catalog.update_settings(db, current_user.id, payload)
        read_model_cache.invalidate_dataset_catalog(dataset_catalog_cache_scope(current_user.id))
        return response
    except (DatasetRefreshInProgress, FileNotFoundError, OSError, SQLAlchemyError, ValueError) as exc:
        db.rollback()
        raise dataset_error_response(exc) from exc


@router.post("/datasets/refresh", response_model=DatasetRefreshResponse)
def refresh_datasets(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> DatasetRefreshResponse:
    enforce_rate_limit("datasets-refresh", current_user.id, settings.dataset_refresh_rate_limit)
    try:
        response = dataset_catalog.start_refresh(db, current_user.id)
        read_model_cache.invalidate_dataset_catalog(dataset_catalog_cache_scope(current_user.id))
        return response
    except (DatasetRefreshInProgress, FileNotFoundError, OSError, SQLAlchemyError, ValueError) as exc:
        db.rollback()
        raise dataset_error_response(exc) from exc


@router.get("/datasets/refresh/status", response_model=DatasetRefreshStatus)
def dataset_refresh_status(
    current_user: AuthenticatedUser = Depends(require_auth),
) -> DatasetRefreshStatus:
    return dataset_catalog.refresh_status(current_user.id)


@router.websocket("/datasets/stream")
async def dataset_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    db = SessionLocal()
    try:
        initial = await asyncio.wait_for(
            websocket.receive_json(),
            timeout=WEBSOCKET_AUTH_TIMEOUT_SECONDS,
        )
        token = clean_text(initial.get("authToken")) if isinstance(initial, dict) else ""
        current_user = authenticate_token(db, token)
    except (HTTPException, asyncio.TimeoutError, ValueError, TypeError, json.JSONDecodeError):
        await websocket.close(code=4401)
        return
    finally:
        db.close()

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


def dataset_catalog_stream_payload(user_id: int) -> dict[str, object]:
    db = SessionLocal()
    try:
        catalog = dataset_catalog.stored_catalog(db, user_id)
        return {
            "type": "catalog",
            "catalog": catalog.model_dump(mode="json"),
        }
    except (DatasetRefreshInProgress, FileNotFoundError, OSError, SQLAlchemyError, ValueError) as exc:
        return {
            "type": "error",
            "message": dataset_error_response(exc).detail,
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
        response = dataset_catalog.update_asset(db, current_user.id, asset_id, payload)
        read_model_cache.invalidate_dataset_catalog(dataset_catalog_cache_scope(current_user.id))
        return response
    except (DatasetRefreshInProgress, FileNotFoundError, OSError, SQLAlchemyError, ValueError) as exc:
        db.rollback()
        raise dataset_error_response(exc) from exc


@router.post("/app-data/operations/{operation_id}/reserve", response_model=AppDataOperationRead)
def reserve_app_data_operation(
    operation_id: str,
    payload: AppDataOperationReserve,
    response: Response,
    current_user: AuthenticatedUser = Depends(require_auth),
) -> AppDataOperationRead:
    if not current_user.approved:
        raise HTTPException(status_code=403, detail="Approved account required")
    enforce_rate_limit("app-data-operations", current_user.id, APP_DATA_OPERATION_RATE_LIMIT)
    response.headers["Cache-Control"] = "no-store"
    return app_data_operations.reserve(current_user.id, operation_id, payload.method, payload.path)


@router.post("/app-data/operations/{operation_id}/recover", response_model=AppDataOperationRead)
def recover_app_data_operation(
    operation_id: str,
    response: Response,
    current_user: AuthenticatedUser = Depends(require_auth),
) -> AppDataOperationRead:
    if not current_user.approved:
        raise HTTPException(status_code=403, detail="Approved account required")
    enforce_rate_limit("app-data-operations", current_user.id, APP_DATA_OPERATION_RATE_LIMIT)
    response.headers["Cache-Control"] = "no-store"
    return app_data_operations.recover(current_user.id, operation_id)


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
    return AppDataBundle(app="edgelab", version=1, exported_at=utcnow(), tables=tables)


@router.post("/app-data/import", response_model=AppDataImportResult)
def import_app_data(
    bundle: AppDataBundle,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> AppDataImportResult:
    if bundle.app != "edgelab":
        raise HTTPException(status_code=400, detail="Import file is not an EdgeLab data bundle")
    validate_app_data_bundle(bundle, db, current_user.id)

    try:
        # Summaries are derived, not portable. Even SQLite without FK cascades
        # must recompute them from the replacement records after import.
        for model in (BacktestSessionSummary, UserDashboardSummary):
            db.query(model).filter(model.user_id == current_user.id).delete(synchronize_session=False)
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
                if model is DatasetTimeframe:
                    # Candle data is not in the bundle. Rebuild from the CSV
                    # before database-backed readers can trust this timeframe.
                    model_row.database_imported = False
                    model_row.database_imported_at = None
                batch.append(model_row)
                if index % APP_DATA_IMPORT_BATCH_SIZE == 0:
                    db.add_all(batch)
                    db.flush()
                    batch = []
            if batch:
                db.add_all(batch)
                db.flush()
        db.commit()
        read_model_cache.invalidate_user(
            bootstrap_shell_cache_scope(current_user.id),
            dataset_catalog_cache_scope(current_user.id),
        )
        return AppDataImportResult(imported_at=utcnow(), summary=summary)
    except Exception:
        db.rollback()
        logger.warning("App data import failed")
        raise HTTPException(status_code=400, detail="Import failed") from None


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


@router.patch("/journal/settings", response_model=AppStorageRead)
def update_journal_settings(
    payload: JournalSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> AppStorageRead:
    """Merge capture defaults without replacing records or unrelated settings."""
    changes = payload.model_dump(exclude_unset=True)
    if "default_broker" in changes:
        changes["default_broker"] = changes["default_broker"].strip() or "Manual"
    for _ in range(3):
        item = db.scalar(select(AppStorageItem).where(
            AppStorageItem.user_id == current_user.id,
            AppStorageItem.namespace == "edgelab",
            AppStorageItem.key == "live-journal.v1",
        ))
        if item is not None and item.value is not None and not isinstance(item.value, dict):
            raise HTTPException(status_code=409, detail="Journal storage needs recovery before changing defaults.")
        value = dict(item.value) if item is not None and isinstance(item.value, dict) else {}
        previous = value.get("settings")
        if previous is not None and not isinstance(previous, dict):
            raise HTTPException(status_code=409, detail="Journal settings need recovery before changing defaults.")
        value["settings"] = {**JournalSettingsUpdate().model_dump(), **(previous if isinstance(previous, dict) else {}), **changes}
        timestamp = utcnow()
        if item is None:
            db.add(AppStorageItem(user_id=current_user.id, namespace="edgelab", key="live-journal.v1", value=value, updated_at=timestamp))
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                continue
        else:
            # Compare-and-swap also works on SQLite, where FOR UPDATE is ignored.
            result = db.execute(update(AppStorageItem).where(
                AppStorageItem.id == item.id,
                AppStorageItem.user_id == current_user.id,
                AppStorageItem.updated_at == item.updated_at,
            ).values(value=value, updated_at=timestamp).execution_options(synchronize_session=False))
            if result.rowcount != 1:
                db.rollback()
                continue
            db.commit()
        return AppStorageRead(namespace="edgelab", key="live-journal.v1", value=value, updated_at=timestamp)
    raise HTTPException(status_code=409, detail="Journal changed while saving. Retry your defaults.")


@router.get("/settings/chart", response_model=ChartSettingsRead)
def get_chart_settings(db: Session = Depends(get_db), current_user: AuthenticatedUser = Depends(require_auth)):
    return read_chart_settings(db, current_user.id)


@router.patch("/settings/chart", response_model=ChartSettingsRead)
def update_chart_settings(payload: ChartSettingsUpdate, db: Session = Depends(get_db), current_user: AuthenticatedUser = Depends(require_auth)):
    return patch_chart_settings(db, current_user.id, payload.model_dump(exclude_unset=True))


@router.patch("/settings/preferences", response_model=AppStorageRead)
def update_settings_preferences(payload: SettingsPreferencesUpdate, db: Session = Depends(get_db), current_user: AuthenticatedUser = Depends(require_auth)):
    return patch_settings_preferences(db, current_user.id, payload.model_dump(exclude_unset=True))


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


@router.post("/journal/accounts", response_model=JournalAccountRead, status_code=201)
def create_journal_account(
    payload: JournalAccountCreate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> JournalAccountRead:
    enforce_rate_limit("journal-write", current_user.id, JOURNAL_WRITE_RATE_LIMIT)
    try:
        return journal.create_account(db, current_user.id, payload)
    except journal.JournalServiceError as exc:
        raise journal_service_error(exc) from exc


@router.get("/journal/accounts", response_model=list[JournalAccountRead])
def list_journal_accounts(
    include_archived: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[JournalAccountRead]:
    enforce_rate_limit("journal-read", current_user.id, JOURNAL_READ_RATE_LIMIT)
    return journal.list_accounts(db, current_user.id, include_archived=include_archived)


@router.post("/journal/tags", response_model=JournalTagRead, status_code=201)
def create_journal_tag(
    payload: JournalTagCreate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> JournalTagRead:
    enforce_rate_limit("journal-write", current_user.id, JOURNAL_WRITE_RATE_LIMIT)
    try:
        return journal.create_tag(db, current_user.id, payload)
    except journal.JournalServiceError as exc:
        raise journal_service_error(exc) from exc


@router.get("/journal/tags", response_model=list[JournalTagRead])
def list_journal_tags(
    category: str | None = Query(default=None),
    include_archived: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[JournalTagRead]:
    enforce_rate_limit("journal-read", current_user.id, JOURNAL_READ_RATE_LIMIT)
    if category is not None and category not in {"SETUP", "POSITIVE", "MISTAKE", "PROCESS"}:
        raise HTTPException(status_code=422, detail="Invalid Journal tag category")
    return journal.list_tags(
        db,
        current_user.id,
        category=category,
        include_archived=include_archived,
    )


@router.post("/journal/trades", response_model=CanonicalTradeRead, status_code=201)
def create_canonical_trade(
    payload: CanonicalTradeCreate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> CanonicalTradeRead:
    enforce_rate_limit("journal-write", current_user.id, JOURNAL_WRITE_RATE_LIMIT)
    try:
        return journal.create_trade(db, current_user.id, payload)
    except journal.JournalServiceError as exc:
        raise journal_service_error(exc) from exc


@router.get("/journal/trades", response_model=list[CanonicalTradeRead])
def list_canonical_trades(
    account_id: int | None = Query(default=None, gt=0),
    reviewed: bool | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    tag_id: list[int] | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    order: Literal["entry", "id"] = Query(default="entry"),
    before_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[CanonicalTradeRead]:
    enforce_rate_limit("journal-read", current_user.id, JOURNAL_READ_RATE_LIMIT)
    if start_date is not None and end_date is not None and end_date < start_date:
        raise HTTPException(status_code=422, detail="end_date cannot precede start_date")
    if (before_id is not None and order != "id") or (order == "id" and offset != 0):
        raise HTTPException(status_code=422, detail="ID cursor paging requires order=id and offset=0")
    try:
        return journal.list_trades(
            db,
            current_user.id,
            account_id=account_id,
            reviewed=reviewed,
            start_date=start_date,
            end_date=end_date,
            tag_ids=tag_id or (),
            offset=offset,
            limit=limit,
            order=order,
            before_id=before_id,
        )
    except journal.JournalServiceError as exc:
        raise journal_service_error(exc) from exc


@router.get("/journal/trades/{trade_id}", response_model=CanonicalTradeRead)
def get_canonical_trade(
    trade_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> CanonicalTradeRead:
    enforce_rate_limit("journal-read", current_user.id, JOURNAL_READ_RATE_LIMIT)
    try:
        return journal.get_trade(db, current_user.id, trade_id)
    except journal.JournalServiceError as exc:
        raise journal_service_error(exc) from exc


@router.patch("/journal/trades/{trade_id}/review", response_model=CanonicalTradeRead)
def update_canonical_trade_review(
    trade_id: int,
    payload: CanonicalTradeReviewUpdate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> CanonicalTradeRead:
    enforce_rate_limit("journal-write", current_user.id, JOURNAL_WRITE_RATE_LIMIT)
    try:
        return journal.update_trade_review(db, current_user.id, trade_id, payload)
    except journal.JournalServiceError as exc:
        db.rollback()
        raise journal_service_error(exc) from exc


@router.put("/journal/daily-notes/{note_date}", response_model=JournalDailyNoteRead)
def upsert_journal_daily_note(
    note_date: date,
    payload: JournalDailyNoteUpsert,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> JournalDailyNoteRead:
    enforce_rate_limit("journal-write", current_user.id, JOURNAL_WRITE_RATE_LIMIT)
    try:
        return journal.upsert_daily_note(db, current_user.id, note_date, payload)
    except journal.JournalServiceError as exc:
        raise journal_service_error(exc) from exc


@router.get("/journal/daily-notes", response_model=list[JournalDailyNoteRead])
def list_journal_daily_notes(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    account_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[JournalDailyNoteRead]:
    enforce_rate_limit("journal-read", current_user.id, JOURNAL_READ_RATE_LIMIT)
    if start_date is not None and end_date is not None and end_date < start_date:
        raise HTTPException(status_code=422, detail="end_date cannot precede start_date")
    try:
        return journal.list_daily_notes(
            db,
            current_user.id,
            start_date=start_date,
            end_date=end_date,
            account_id=account_id,
        )
    except journal.JournalServiceError as exc:
        raise journal_service_error(exc) from exc


@router.post("/journal/imports", response_model=JournalImportResult, status_code=201)
def create_journal_import(
    payload: JournalImportCreate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> JournalImportResult:
    enforce_rate_limit("journal-import", current_user.id, JOURNAL_IMPORT_RATE_LIMIT)
    try:
        return journal.import_journal_csv(db, current_user.id, payload)
    except journal.JournalServiceError as exc:
        db.rollback()
        raise journal_service_error(exc) from exc


@router.get("/journal/imports", response_model=list[JournalImportRunRead])
def list_journal_imports(
    account_id: int | None = Query(default=None, gt=0),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[JournalImportRunRead]:
    enforce_rate_limit("journal-read", current_user.id, JOURNAL_READ_RATE_LIMIT)
    try:
        return journal.list_import_runs(
            db,
            current_user.id,
            account_id=account_id,
            offset=offset,
            limit=limit,
        )
    except journal.JournalServiceError as exc:
        raise journal_service_error(exc) from exc


@router.get("/journal/imports/{run_id}", response_model=JournalImportRunRead)
def read_journal_import(
    run_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> JournalImportRunRead:
    enforce_rate_limit("journal-read", current_user.id, JOURNAL_READ_RATE_LIMIT)
    try:
        return journal.get_import_run(db, current_user.id, run_id)
    except journal.JournalServiceError as exc:
        raise journal_service_error(exc) from exc


@router.post("/journal/imports/{run_id}/rollback", response_model=JournalImportRunRead)
def rollback_journal_import(
    run_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> JournalImportRunRead:
    enforce_rate_limit("journal-import", current_user.id, JOURNAL_IMPORT_RATE_LIMIT)
    try:
        return journal.rollback_import(db, current_user.id, run_id)
    except journal.JournalServiceError as exc:
        db.rollback()
        raise journal_service_error(exc) from exc


@router.post("/journal/backfill", response_model=JournalBackfillResult)
def backfill_journal_data(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> JournalBackfillResult:
    enforce_rate_limit("journal-import", current_user.id, JOURNAL_IMPORT_RATE_LIMIT)
    try:
        return journal.backfill_legacy_journal(db, current_user.id)
    except journal.JournalServiceError as exc:
        db.rollback()
        raise journal_service_error(exc) from exc


@router.post(
    "/journal/broker-connections/{connection_id}/sync",
    response_model=dict[str, int],
)
def sync_broker_connection_to_journal(
    connection_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> dict[str, int]:
    enforce_rate_limit("journal-import", current_user.id, JOURNAL_IMPORT_RATE_LIMIT)
    try:
        trades, executions = journal.sync_broker_connection(
            db,
            current_user.id,
            connection_id,
        )
        return {"trades_created": trades, "executions_created": executions}
    except journal.JournalServiceError as exc:
        db.rollback()
        raise journal_service_error(exc) from exc


@router.post(
    "/integration-secrets",
    response_model=IntegrationSecretRead,
    status_code=201,
)
def create_integration_secret(
    payload: IntegrationSecretCreate,
    response: Response,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> IntegrationSecretRead:
    response.headers["Cache-Control"] = "no-store"
    enforce_rate_limit(
        "integration-secret-write",
        current_user.id,
        INTEGRATION_SECRET_WRITE_RATE_LIMIT,
    )
    try:
        return integration_secrets.create_integration_secret(
            db,
            current_user.id,
            payload,
        )
    except integration_secrets.IntegrationSecretError as exc:
        raise integration_secret_error(exc) from exc


@router.get("/integration-secrets", response_model=list[IntegrationSecretRead])
def list_integration_secrets(
    response: Response,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[IntegrationSecretRead]:
    response.headers["Cache-Control"] = "no-store"
    enforce_rate_limit(
        "integration-secret-read",
        current_user.id,
        INTEGRATION_SECRET_READ_RATE_LIMIT,
    )
    return integration_secrets.list_integration_secrets(db, current_user.id)


@router.get(
    "/integration-secrets/{secret_id}",
    response_model=IntegrationSecretRead,
)
def read_integration_secret(
    secret_id: int,
    response: Response,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> IntegrationSecretRead:
    response.headers["Cache-Control"] = "no-store"
    enforce_rate_limit(
        "integration-secret-read",
        current_user.id,
        INTEGRATION_SECRET_READ_RATE_LIMIT,
    )
    try:
        return integration_secrets.get_integration_secret(db, current_user.id, secret_id)
    except integration_secrets.IntegrationSecretError as exc:
        raise integration_secret_error(exc) from exc


@router.put(
    "/integration-secrets/{secret_id}",
    response_model=IntegrationSecretRead,
)
def replace_integration_secret(
    secret_id: int,
    payload: IntegrationSecretReplace,
    response: Response,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> IntegrationSecretRead:
    response.headers["Cache-Control"] = "no-store"
    enforce_rate_limit(
        "integration-secret-write",
        current_user.id,
        INTEGRATION_SECRET_WRITE_RATE_LIMIT,
    )
    try:
        return integration_secrets.replace_integration_secret(
            db,
            current_user.id,
            secret_id,
            payload,
        )
    except integration_secrets.IntegrationSecretError as exc:
        raise integration_secret_error(exc) from exc


@router.post(
    "/integration-secrets/{secret_id}/connect",
    response_model=IntegrationSecretConnectionRead,
)
def connect_integration_secret(
    secret_id: int,
    response: Response,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> IntegrationSecretConnectionRead:
    response.headers["Cache-Control"] = "no-store"
    enforce_rate_limit(
        "integration-secret-connect",
        current_user.id,
        INTEGRATION_SECRET_CONNECT_RATE_LIMIT,
    )
    try:
        return integration_secrets.connect_integration_secret(
            db,
            current_user.id,
            secret_id,
        )
    except integration_secrets.IntegrationSecretError as exc:
        raise integration_secret_error(exc) from exc


@router.post(
    "/integration-secrets/{secret_id}/rotate",
    response_model=IntegrationSecretRead,
)
def rotate_integration_secret(
    secret_id: int,
    response: Response,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> IntegrationSecretRead:
    response.headers["Cache-Control"] = "no-store"
    enforce_rate_limit(
        "integration-secret-write",
        current_user.id,
        INTEGRATION_SECRET_WRITE_RATE_LIMIT,
    )
    try:
        return integration_secrets.rotate_integration_secret(
            db,
            current_user.id,
            secret_id,
        )
    except integration_secrets.IntegrationSecretError as exc:
        raise integration_secret_error(exc) from exc


@router.delete(
    "/integration-secrets/{secret_id}",
    response_model=IntegrationSecretRead,
)
def revoke_integration_secret(
    secret_id: int,
    response: Response,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> IntegrationSecretRead:
    response.headers["Cache-Control"] = "no-store"
    enforce_rate_limit(
        "integration-secret-write",
        current_user.id,
        INTEGRATION_SECRET_WRITE_RATE_LIMIT,
    )
    try:
        return integration_secrets.revoke_integration_secret(
            db,
            current_user.id,
            secret_id,
        )
    except integration_secrets.IntegrationSecretError as exc:
        raise integration_secret_error(exc) from exc


@router.get("/broker-providers", response_model=list[BrokerProviderRead])
def list_broker_providers(
    response: Response,
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[BrokerProviderRead]:
    response.headers["Cache-Control"] = "no-store"
    enforce_rate_limit("broker-read", current_user.id, BROKER_READ_RATE_LIMIT)
    return broker_sync.list_provider_catalog()


@router.post(
    "/broker-connections",
    response_model=BrokerConnectionRead,
    status_code=201,
)
def create_broker_connection(
    payload: BrokerConnectionCreate,
    response: Response,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> BrokerConnectionRead:
    response.headers["Cache-Control"] = "no-store"
    enforce_rate_limit("broker-write", current_user.id, BROKER_WRITE_RATE_LIMIT)
    try:
        return broker_sync.create_connection(db, current_user.id, payload)
    except (
        broker_sync.BrokerServiceError,
        integration_secrets.IntegrationSecretError,
    ) as exc:
        raise broker_service_error(exc) from exc


@router.get("/broker-connections", response_model=list[BrokerConnectionRead])
def list_broker_connections(
    response: Response,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[BrokerConnectionRead]:
    response.headers["Cache-Control"] = "no-store"
    enforce_rate_limit("broker-read", current_user.id, BROKER_READ_RATE_LIMIT)
    return broker_sync.list_connections(db, current_user.id)


@router.get(
    "/broker-connections/{connection_id}",
    response_model=BrokerConnectionRead,
)
def read_broker_connection(
    connection_id: int,
    response: Response,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> BrokerConnectionRead:
    response.headers["Cache-Control"] = "no-store"
    enforce_rate_limit("broker-read", current_user.id, BROKER_READ_RATE_LIMIT)
    try:
        return broker_sync.get_connection(db, current_user.id, connection_id)
    except broker_sync.BrokerServiceError as exc:
        raise broker_service_error(exc) from exc


@router.delete(
    "/broker-connections/{connection_id}",
    response_model=BrokerConnectionRead,
)
def revoke_broker_connection(
    connection_id: int,
    response: Response,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> BrokerConnectionRead:
    response.headers["Cache-Control"] = "no-store"
    enforce_rate_limit("broker-write", current_user.id, BROKER_WRITE_RATE_LIMIT)
    try:
        return broker_sync.revoke_connection(db, current_user.id, connection_id)
    except broker_sync.BrokerServiceError as exc:
        raise broker_service_error(exc) from exc


@router.post(
    "/broker-connections/{connection_id}/refresh",
    response_model=BrokerSyncJobRead,
)
def refresh_broker_connection(
    connection_id: int,
    payload: BrokerSyncRefreshRequest,
    response: Response,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> BrokerSyncJobRead:
    response.headers["Cache-Control"] = "no-store"
    enforce_rate_limit("broker-sync", current_user.id, BROKER_SYNC_RATE_LIMIT)
    try:
        result = broker_sync.refresh_connection(
            db,
            current_user.id,
            connection_id,
            max_attempts=payload.max_attempts,
        )
        if result.status == "SUCCEEDED":
            journal.sync_broker_connection(db, current_user.id, connection_id)
        return result
    except broker_sync.BrokerServiceError as exc:
        raise broker_service_error(exc) from exc
    except journal.JournalServiceError as exc:
        raise journal_service_error(exc) from exc


@router.post(
    "/broker-sync-jobs/{job_id}/retry",
    response_model=BrokerSyncJobRead,
)
def retry_broker_sync_job(
    job_id: int,
    response: Response,
    force: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> BrokerSyncJobRead:
    response.headers["Cache-Control"] = "no-store"
    enforce_rate_limit("broker-sync", current_user.id, BROKER_SYNC_RATE_LIMIT)
    try:
        result = broker_sync.retry_sync_job(
            db,
            current_user.id,
            job_id,
            force=force,
        )
        if result.status == "SUCCEEDED":
            journal.sync_broker_connection(db, current_user.id, result.connection_id)
        return result
    except broker_sync.BrokerServiceError as exc:
        raise broker_service_error(exc) from exc
    except journal.JournalServiceError as exc:
        raise journal_service_error(exc) from exc


@router.get(
    "/broker-connections/{connection_id}/accounts",
    response_model=list[BrokerAccountRead],
)
def list_broker_accounts(
    connection_id: int,
    response: Response,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[BrokerAccountRead]:
    response.headers["Cache-Control"] = "no-store"
    enforce_rate_limit("broker-read", current_user.id, BROKER_READ_RATE_LIMIT)
    try:
        return broker_sync.list_accounts(db, current_user.id, connection_id)
    except broker_sync.BrokerServiceError as exc:
        raise broker_service_error(exc) from exc


@router.get(
    "/broker-connections/{connection_id}/orders",
    response_model=list[BrokerOrderRead],
)
def list_broker_orders(
    connection_id: int,
    response: Response,
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[BrokerOrderRead]:
    response.headers["Cache-Control"] = "no-store"
    enforce_rate_limit("broker-read", current_user.id, BROKER_READ_RATE_LIMIT)
    try:
        return broker_sync.list_orders(
            db,
            current_user.id,
            connection_id,
            limit=limit,
        )
    except broker_sync.BrokerServiceError as exc:
        raise broker_service_error(exc) from exc


@router.get(
    "/broker-connections/{connection_id}/fills",
    response_model=list[BrokerFillRead],
)
def list_broker_fills(
    connection_id: int,
    response: Response,
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[BrokerFillRead]:
    response.headers["Cache-Control"] = "no-store"
    enforce_rate_limit("broker-read", current_user.id, BROKER_READ_RATE_LIMIT)
    try:
        return broker_sync.list_fills(
            db,
            current_user.id,
            connection_id,
            limit=limit,
        )
    except broker_sync.BrokerServiceError as exc:
        raise broker_service_error(exc) from exc


@router.get(
    "/broker-connections/{connection_id}/positions",
    response_model=list[BrokerPositionRead],
)
def list_broker_positions(
    connection_id: int,
    response: Response,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[BrokerPositionRead]:
    response.headers["Cache-Control"] = "no-store"
    enforce_rate_limit("broker-read", current_user.id, BROKER_READ_RATE_LIMIT)
    try:
        return broker_sync.list_positions(db, current_user.id, connection_id)
    except broker_sync.BrokerServiceError as exc:
        raise broker_service_error(exc) from exc


@router.get(
    "/broker-connections/{connection_id}/sync-jobs",
    response_model=list[BrokerSyncJobRead],
)
def list_broker_sync_jobs(
    connection_id: int,
    response: Response,
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[BrokerSyncJobRead]:
    response.headers["Cache-Control"] = "no-store"
    enforce_rate_limit("broker-read", current_user.id, BROKER_READ_RATE_LIMIT)
    try:
        return broker_sync.list_sync_jobs(
            db,
            current_user.id,
            connection_id,
            limit=limit,
        )
    except broker_sync.BrokerServiceError as exc:
        raise broker_service_error(exc) from exc


@router.get(
    "/broker-connections/{connection_id}/audit-logs",
    response_model=list[BrokerAuditRead],
)
def list_broker_audit_logs(
    connection_id: int,
    response: Response,
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[BrokerAuditRead]:
    response.headers["Cache-Control"] = "no-store"
    enforce_rate_limit("broker-read", current_user.id, BROKER_READ_RATE_LIMIT)
    try:
        return broker_sync.list_audit_logs(
            db,
            current_user.id,
            connection_id,
            limit=limit,
        )
    except broker_sync.BrokerServiceError as exc:
        raise broker_service_error(exc) from exc


@router.post(
    "/workspace-shares",
    response_model=WorkspaceShareCreatedRead,
    status_code=201,
)
def create_workspace_share(
    payload: WorkspaceShareCreate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> WorkspaceShareCreatedRead:
    enforce_rate_limit(
        "workspace-share-create",
        current_user.id,
        WORKSPACE_SHARE_CREATE_RATE_LIMIT,
    )
    return share_snapshots.create_workspace_share(db, current_user.id, payload)


@router.get("/workspace-shares", response_model=list[WorkspaceShareOwnerRead])
def list_workspace_shares(
    workspace_key: str | None = Query(
        default=None,
        min_length=1,
        max_length=96,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
    ),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[WorkspaceShareOwnerRead]:
    enforce_rate_limit(
        "workspace-share-management",
        current_user.id,
        WORKSPACE_SHARE_MANAGEMENT_RATE_LIMIT,
    )
    return share_snapshots.list_workspace_shares(
        db,
        current_user.id,
        workspace_key=workspace_key,
        offset=offset,
        limit=limit,
    )


@router.post(
    "/workspace-shares/{snapshot_id}/revoke",
    response_model=WorkspaceShareOwnerRead,
)
def revoke_workspace_share(
    snapshot_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> WorkspaceShareOwnerRead:
    enforce_rate_limit(
        "workspace-share-management",
        current_user.id,
        WORKSPACE_SHARE_MANAGEMENT_RATE_LIMIT,
    )
    return share_snapshots.revoke_workspace_share(db, current_user.id, snapshot_id)


@router.delete(
    "/workspace-shares/{snapshot_id}/payload",
    response_model=WorkspaceShareOwnerRead,
)
def purge_workspace_share_payload(
    snapshot_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> WorkspaceShareOwnerRead:
    enforce_rate_limit(
        "workspace-share-management",
        current_user.id,
        WORKSPACE_SHARE_MANAGEMENT_RATE_LIMIT,
    )
    return share_snapshots.purge_workspace_share_payload(
        db,
        current_user.id,
        snapshot_id,
    )


@router.get("/workspace-shares/open", response_model=WorkspaceSharePublicRead)
def read_public_workspace_share(
    response: Response,
    share_token: str | None = Header(default=None, alias="X-Workspace-Share-Token"),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> WorkspaceSharePublicRead:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    enforce_rate_limit(
        "workspace-share-open",
        current_user.id,
        WORKSPACE_SHARE_OPEN_RATE_LIMIT,
    )
    return share_snapshots.get_public_workspace_share(
        db,
        current_user.id,
        current_user.email,
        share_token,
    )


@router.post("/feedback", response_model=FeedbackRead)
def create_feedback(
    payload: FeedbackCreate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> FeedbackRead:
    submission = FeedbackSubmission(
        user_id=current_user.id,
        category=payload.category,
        message=clean_text(payload.message),
        context=payload.context,
        status="NEW",
    )
    db.add(submission)
    db.commit()
    db.refresh(submission)
    return FeedbackRead(
        id=submission.id,
        category=submission.category,
        message=submission.message,
        status=submission.status,
        created_at=submission.created_at,
    )


@router.get("/feedback", response_model=list[FeedbackRead])
def list_feedback(
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[FeedbackRead]:
    submissions = db.scalars(
        select(FeedbackSubmission)
        .where(FeedbackSubmission.user_id == current_user.id)
        .order_by(FeedbackSubmission.created_at.desc(), FeedbackSubmission.id.desc())
        .limit(limit)
    ).all()
    return [
        FeedbackRead(
            id=submission.id,
            category=submission.category,
            message=submission.message,
            status=submission.status,
            created_at=submission.created_at,
        )
        for submission in submissions
    ]


@router.get("/market-data/bars", response_model=BarsResponse)
def market_data_bars(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=300, ge=1, le=5000),
    warmup: int = Query(default=120, ge=0, le=1000),
    session_id: int | None = Query(default=None),
    dataset_asset_id: int | None = Query(default=None, ge=1),
    timeframe: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> BarsResponse:
    enforce_rate_limit("market-data-bars", current_user.id, settings.market_data_bars_rate_limit)
    try:
        service = requested_market_data_service(
            db,
            current_user.id,
            session_id=session_id,
            dataset_asset_id=dataset_asset_id,
            timeframe=timeframe,
        )
        return service.get_bars(offset=offset, limit=limit, warmup=warmup)
    except (FileNotFoundError, ValueError) as exc:
        raise market_data_error_response(exc) from exc


@router.get("/live/dukascopy/instruments", response_model=DukascopyInstrumentsResponse)
def dukascopy_instruments(
    search: str | None = Query(default=None, max_length=80),
    limit: int = Query(default=120, ge=1, le=5000),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> DukascopyInstrumentsResponse:
    enforce_rate_limit("live-instruments", current_user.id, settings.market_data_meta_rate_limit)
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
    current_user: AuthenticatedUser = Depends(require_auth),
) -> BinanceInstrumentsResponse:
    enforce_rate_limit("live-instruments", current_user.id, settings.market_data_meta_rate_limit)
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
    current_user: AuthenticatedUser = Depends(require_auth),
) -> AngelOneInstrumentsResponse:
    enforce_rate_limit("live-instruments", current_user.id, settings.market_data_meta_rate_limit)
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
    before: int | None = Query(default=None, ge=0),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> DukascopyCandlesResponse:
    enforce_rate_limit("live-candles", current_user.id, settings.market_data_bars_rate_limit)
    normalized_interval = interval.upper()
    if normalized_interval not in DUKASCOPY_INTERVALS:
        raise HTTPException(status_code=400, detail="Unsupported Dukascopy interval")

    last_update = before if before is not None else int(datetime.now(tz=timezone.utc).timestamp() * 1000)
    data = fetch_dukascopy_json(
        "chart/json3",
        {
            "splits": "true",
            "stocks": "true",
            "time_direction": "P",
            "last_update": str(last_update),
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
        initial = await asyncio.wait_for(
            websocket.receive_json(),
            timeout=WEBSOCKET_AUTH_TIMEOUT_SECONDS,
        )
    except WebSocketDisconnect:
        return
    except (asyncio.TimeoutError, ValueError, TypeError, json.JSONDecodeError):
        await websocket.send_json({"type": "error", "message": "Invalid Angel One stream request"})
        await websocket.close(code=4401)
        return

    if not isinstance(initial, dict):
        await websocket.send_json({"type": "error", "message": "Invalid Angel One stream request"})
        await websocket.close()
        return

    db = SessionLocal()
    try:
        authenticate_token(db, clean_text(initial.get("apiToken")))
    except HTTPException:
        await websocket.send_json({"type": "error", "message": "Valid session required"})
        await websocket.close(code=4401)
        return
    finally:
        db.close()

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
    current_user: AuthenticatedUser = Depends(require_auth),
) -> EconomicCalendarResponse:
    global forex_factory_calendar_cache

    enforce_rate_limit("economic-calendar", current_user.id, settings.market_data_meta_rate_limit)

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


def build_bootstrap_shell_response(
    db: Session,
    user_id: int,
    *,
    limit: int = BOOTSTRAP_SHELL_SESSION_LIMIT,
) -> AppBootstrapShellResponse:
    sessions_page = list_listable_backtest_sessions_page(
        db,
        user_id,
        limit=limit,
    )
    return AppBootstrapShellResponse(
        playbooks=backtester.list_playbooks(db, user_id),
        recent_sessions=sessions_page.items,
        strategy_summaries=build_strategy_summaries(db, user_id, sessions_page.items),
        dashboard_summary=load_user_dashboard_summary(db, user_id),
        active_session_id=sessions_page.items[0].id if sessions_page.items else None,
        recent_sessions_next_offset=sessions_page.next_offset,
        recent_sessions_next_cursor=sessions_page.next_cursor,
        recent_sessions_has_more=sessions_page.has_more,
        recent_session_limit=limit,
    )


def cached_dataset_catalog_response(
    db: Session,
    user_id: int,
) -> DatasetCatalogResponse:
    return read_model_cache.get_dataset_catalog(
        dataset_catalog_cache_scope(user_id),
        lambda: dataset_catalog.list_catalog(db, user_id),
        model_cls=DatasetCatalogResponse,
    )


def cached_bootstrap_shell_response(
    db: Session,
    user_id: int,
    *,
    limit: int = BOOTSTRAP_SHELL_SESSION_LIMIT,
) -> AppBootstrapShellResponse:
    return read_model_cache.get_bootstrap_shell(
        bootstrap_shell_cache_scope(user_id),
        limit,
        lambda: build_bootstrap_shell_response(
            db,
            user_id,
            limit=limit,
        ),
        model_cls=AppBootstrapShellResponse,
    )


def build_bootstrap_response(
    db: Session,
    user_id: int,
    *,
    session_limit: int = BOOTSTRAP_SESSION_LIMIT,
    trade_limit: int = BOOTSTRAP_TRADE_LIMIT,
) -> AppBootstrapResponse:
    shell = build_bootstrap_shell_response(db, user_id, limit=session_limit)
    return AppBootstrapResponse(
        datasets=dataset_catalog.list_catalog(db, user_id),
        playbooks=shell.playbooks,
        recent_sessions=shell.recent_sessions,
        strategy_summaries=shell.strategy_summaries,
        dashboard_summary=shell.dashboard_summary,
        active_session_id=shell.active_session_id,
        recent_sessions_next_offset=shell.recent_sessions_next_offset,
        recent_sessions_next_cursor=shell.recent_sessions_next_cursor,
        recent_sessions_has_more=shell.recent_sessions_has_more,
        recent_trades=backtester.list_trades(
            db,
            user_id,
            limit=trade_limit,
        ),
        recent_session_limit=session_limit,
        recent_trade_limit=trade_limit,
    )


def cached_bootstrap_response(
    db: Session,
    user_id: int,
    *,
    session_limit: int = BOOTSTRAP_SESSION_LIMIT,
    trade_limit: int = BOOTSTRAP_TRADE_LIMIT,
) -> AppBootstrapResponse:
    shell = cached_bootstrap_shell_response(db, user_id, limit=session_limit)
    return AppBootstrapResponse(
        datasets=cached_dataset_catalog_response(db, user_id),
        playbooks=shell.playbooks,
        recent_sessions=shell.recent_sessions,
        strategy_summaries=shell.strategy_summaries,
        dashboard_summary=shell.dashboard_summary,
        active_session_id=shell.active_session_id,
        recent_sessions_next_offset=shell.recent_sessions_next_offset,
        recent_sessions_next_cursor=shell.recent_sessions_next_cursor,
        recent_sessions_has_more=shell.recent_sessions_has_more,
        recent_trades=backtester.list_trades(
            db,
            user_id,
            limit=trade_limit,
        ),
        recent_session_limit=session_limit,
        recent_trade_limit=trade_limit,
    )


@router.get("/bootstrap", response_model=AppBootstrapResponse)
def bootstrap(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
    limit: int = Query(BOOTSTRAP_SESSION_LIMIT, ge=1, le=SESSION_SUMMARIES_LIMIT_MAX),
) -> AppBootstrapResponse:
    if not isinstance(limit, int):
        limit = BOOTSTRAP_SESSION_LIMIT
    try:
        return cached_bootstrap_response(db, current_user.id, session_limit=limit)
    except (DatasetRefreshInProgress, FileNotFoundError, OSError, SQLAlchemyError, ValueError) as exc:
        raise dataset_error_response(exc) from exc


@router.get("/bootstrap-shell", response_model=AppBootstrapShellResponse)
def bootstrap_shell(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
    limit: int = Query(BOOTSTRAP_SHELL_SESSION_LIMIT, ge=1, le=SESSION_SUMMARIES_LIMIT_MAX),
) -> AppBootstrapShellResponse:
    if not isinstance(limit, int):
        limit = BOOTSTRAP_SHELL_SESSION_LIMIT
    try:
        return cached_bootstrap_shell_response(db, current_user.id, limit=limit)
    except (DatasetRefreshInProgress, FileNotFoundError, OSError, SQLAlchemyError, ValueError) as exc:
        raise dataset_error_response(exc) from exc


@router.get("/backtests/strategy-summaries", response_model=list[StrategySummary])
def list_backtest_strategy_summaries(
    limit: int = Query(SESSION_SUMMARIES_LIMIT, ge=1, le=SESSION_SUMMARIES_LIMIT_MAX),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[StrategySummary]:
    if not isinstance(limit, int):
        limit = SESSION_SUMMARIES_LIMIT
    try:
        return cached_bootstrap_shell_response(
            db,
            current_user.id,
            limit=limit,
        ).strategy_summaries
    except (DatasetRefreshInProgress, FileNotFoundError, OSError, SQLAlchemyError, ValueError) as exc:
        raise dataset_error_response(exc) from exc


@router.post("/backtests", response_model=BacktestState)
def create_backtest(
    payload: BacktestCreate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> BacktestState:
    try:
        state = backtester.create_session(db, current_user.id, payload)
        read_model_cache.invalidate_bootstrap_shell(bootstrap_shell_cache_scope(current_user.id))
        return state
    except (FileNotFoundError, ValueError) as exc:
        db.rollback()
        raise market_data_error_response(exc) from exc


@router.get("/backtests/summaries", response_model=BacktestSessionPage)
def list_backtest_summaries(
    offset: int = Query(default=0, ge=0),
    cursor: str | None = None,
    limit: int = Query(default=SESSION_SUMMARIES_LIMIT, ge=1, le=SESSION_SUMMARIES_LIMIT_MAX),
    status: str | None = None,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> BacktestSessionPage:
    try:
        return list_listable_backtest_sessions_page(
            db,
            current_user.id,
            offset=offset,
            cursor=cursor,
            limit=limit,
            status=status,
        )
    except (DatasetRefreshInProgress, FileNotFoundError, OSError, SQLAlchemyError, ValueError) as exc:
        raise dataset_error_response(exc) from exc


@router.get("/backtests", response_model=list[BacktestSessionRead])
def list_backtests(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[BacktestSessionRead]:
    try:
        return list_listable_backtest_sessions(db, current_user.id)
    except (DatasetRefreshInProgress, FileNotFoundError, OSError, SQLAlchemyError, ValueError) as exc:
        raise dataset_error_response(exc) from exc


@router.get("/backtests/latest", response_model=BacktestState)
def latest_backtest(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> BacktestState:
    try:
        offset = 0
        while True:
            sessions = backtester.list_replay_ready_sessions(
                db,
                current_user.id,
                offset=offset,
                limit=SESSION_SUMMARIES_LIMIT,
            )
            if not sessions:
                break
            for session in sessions:
                try:
                    return backtester.get_state(db, current_user.id, session.id)
                except (FileNotFoundError, ValueError):
                    db.rollback()
                    continue
            offset += len(sessions)
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
        result = import_trade_csv(
            db,
            current_user.id,
            payload,
            fallback_csv_path=fallback_csv_path,
            fallback_rows=fallback_rows,
        )
        read_model_cache.invalidate_bootstrap_shell(bootstrap_shell_cache_scope(current_user.id))
        return result
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
    session = BacktestSessionRead.model_validate(
        backtester.update_session(db, current_user.id, session_id, payload),
    )
    read_model_cache.invalidate_bootstrap_shell(bootstrap_shell_cache_scope(current_user.id))
    return session


@router.delete("/backtests/{session_id}")
def delete_backtest_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> dict[str, bool]:
    backtester.delete_session(db, current_user.id, session_id)
    read_model_cache.invalidate_bootstrap_shell(bootstrap_shell_cache_scope(current_user.id))
    return {"ok": True}


@router.post("/backtests/{session_id}/advance", response_model=BacktestState)
def advance_backtest(
    session_id: int,
    payload: BacktestAdvanceRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> BacktestState:
    return backtester.advance(db, current_user.id, session_id, payload)


@router.post("/backtests/{session_id}/advance-compact", response_model=BacktestReplayUpdate)
def advance_backtest_compact(
    session_id: int,
    payload: BacktestAdvanceRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> BacktestReplayUpdate:
    return backtester.advance_compact(db, current_user.id, session_id, payload)


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
    playbook = backtester.create_playbook(db, current_user.id, payload)
    read_model_cache.invalidate_bootstrap_shell(bootstrap_shell_cache_scope(current_user.id))
    return playbook


@router.patch("/playbooks/{playbook_id}", response_model=PlaybookRead)
def update_playbook(
    playbook_id: int,
    payload: PlaybookUpdate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> PlaybookRead:
    playbook = backtester.update_playbook(db, current_user.id, playbook_id, payload)
    read_model_cache.invalidate_bootstrap_shell(bootstrap_shell_cache_scope(current_user.id))
    return playbook


@router.delete("/playbooks/{playbook_id}")
def delete_playbook(
    playbook_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> dict[str, bool]:
    backtester.delete_playbook(db, current_user.id, playbook_id)
    read_model_cache.invalidate_bootstrap_shell(bootstrap_shell_cache_scope(current_user.id))
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


@router.get("/trades/page", response_model=TradePage)
def get_trades_page(
    session_id: int | None = Query(default=None),
    cursor: str | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> TradePage:
    cursor_value = decode_page_cursor(cursor) if cursor else None
    items = backtester.list_trades(
        db,
        current_user.id,
        session_id,
        offset=offset,
        limit=limit + 1,
        cursor=cursor_value,
    )
    has_more = len(items) > limit
    items = items[:limit]
    next_offset = offset + len(items)
    return TradePage(
        items=items,
        offset=offset,
        limit=limit,
        next_offset=next_offset,
        next_cursor=(
            encode_page_cursor(items[-1].entry_time, items[-1].id) if has_more and items else None
        ),
        has_more=has_more,
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


@router.get("/metrics/summary", response_model=MetricsSummaryResponse)
def metrics_summary(
    session_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> MetricsSummaryResponse:
    if session_id is None:
        session = list_latest_session(db, current_user.id)
        session_id = session.id if session else None
    return get_metrics_summary(db, current_user.id, session_id)


@router.get("/metrics/curves", response_model=MetricsCurvesResponse)
def metrics_curves(
    session_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> MetricsCurvesResponse:
    if session_id is None:
        session = list_latest_session(db, current_user.id)
        session_id = session.id if session else None
    return get_metrics_curves(db, current_user.id, session_id)


@router.get("/market-data/providers", response_model=list[MarketProviderRead])
def list_normalized_market_providers(
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[MarketProviderRead]:
    enforce_rate_limit("normalized-market-read", current_user.id, NORMALIZED_MARKET_READ_RATE_LIMIT)
    return market_infrastructure.provider_registry.catalog()


@router.post("/market-data/calendars", response_model=ExchangeCalendarRead, status_code=201)
def create_market_calendar(
    payload: ExchangeCalendarCreate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> ExchangeCalendarRead:
    enforce_rate_limit("normalized-market-write", current_user.id, NORMALIZED_MARKET_WRITE_RATE_LIMIT)
    try:
        return market_infrastructure.create_exchange_calendar(db, current_user.id, payload)
    except market_infrastructure.MarketInfrastructureError as exc:
        raise normalized_market_error(exc) from exc


@router.get("/market-data/calendars", response_model=list[ExchangeCalendarRead])
def list_market_calendars(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[ExchangeCalendarRead]:
    enforce_rate_limit("normalized-market-read", current_user.id, NORMALIZED_MARKET_READ_RATE_LIMIT)
    return market_infrastructure.list_exchange_calendars(db, current_user.id)


@router.get("/market-data/calendars/{calendar_id}/session")
def read_market_session(
    calendar_id: int,
    timestamp: datetime = Query(...),
    template_name: str = Query(default="RTH", min_length=1, max_length=40),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> dict[str, object]:
    enforce_rate_limit("normalized-market-read", current_user.id, NORMALIZED_MARKET_READ_RATE_LIMIT)
    try:
        return market_infrastructure.market_session_at(
            db, current_user.id, calendar_id, timestamp, template_name
        )
    except market_infrastructure.MarketInfrastructureError as exc:
        raise normalized_market_error(exc) from exc


@router.post("/market-data/instruments", response_model=MarketInstrumentRead, status_code=201)
def create_market_instrument(
    payload: MarketInstrumentCreate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> MarketInstrumentRead:
    enforce_rate_limit("normalized-market-write", current_user.id, NORMALIZED_MARKET_WRITE_RATE_LIMIT)
    try:
        return market_infrastructure.create_instrument(db, current_user.id, payload)
    except market_infrastructure.MarketInfrastructureError as exc:
        raise normalized_market_error(exc) from exc


@router.get("/market-data/instruments", response_model=list[MarketInstrumentRead])
def list_market_instruments(
    asset_class: str | None = Query(default=None, max_length=24),
    search: str | None = Query(default=None, max_length=96),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[MarketInstrumentRead]:
    enforce_rate_limit("normalized-market-read", current_user.id, NORMALIZED_MARKET_READ_RATE_LIMIT)
    return market_infrastructure.list_instruments(
        db, current_user.id, asset_class=asset_class.upper() if asset_class else None, search=search
    )


@router.post(
    "/market-data/instruments/{instrument_id}/contracts",
    response_model=MarketContractRead,
    status_code=201,
)
def create_market_contract(
    instrument_id: int,
    payload: MarketContractCreate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> MarketContractRead:
    enforce_rate_limit("normalized-market-write", current_user.id, NORMALIZED_MARKET_WRITE_RATE_LIMIT)
    try:
        return market_infrastructure.create_contract(db, current_user.id, instrument_id, payload)
    except market_infrastructure.MarketInfrastructureError as exc:
        raise normalized_market_error(exc) from exc


@router.get(
    "/market-data/instruments/{instrument_id}/contracts",
    response_model=list[MarketContractRead],
)
def list_market_contracts(
    instrument_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[MarketContractRead]:
    enforce_rate_limit("normalized-market-read", current_user.id, NORMALIZED_MARKET_READ_RATE_LIMIT)
    try:
        return market_infrastructure.list_contracts(db, current_user.id, instrument_id)
    except market_infrastructure.MarketInfrastructureError as exc:
        raise normalized_market_error(exc) from exc


@router.put(
    "/market-data/instruments/{instrument_id}/continuous-rule",
    response_model=ContinuousContractRuleRead,
)
def upsert_continuous_market_rule(
    instrument_id: int,
    payload: ContinuousContractRuleCreate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> ContinuousContractRuleRead:
    enforce_rate_limit("normalized-market-write", current_user.id, NORMALIZED_MARKET_WRITE_RATE_LIMIT)
    try:
        return market_infrastructure.set_continuous_contract_rule(
            db, current_user.id, instrument_id, payload
        )
    except market_infrastructure.MarketInfrastructureError as exc:
        raise normalized_market_error(exc) from exc


@router.get("/market-data/instruments/{instrument_id}/continuous-contract")
def resolve_continuous_market_contract(
    instrument_id: int,
    as_of: date = Query(...),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> dict[str, object]:
    enforce_rate_limit("normalized-market-read", current_user.id, NORMALIZED_MARKET_READ_RATE_LIMIT)
    try:
        return market_infrastructure.resolve_continuous_contract(
            db, current_user.id, instrument_id, as_of=as_of
        )
    except market_infrastructure.MarketInfrastructureError as exc:
        raise normalized_market_error(exc) from exc


@router.get("/market-data/entitlements", response_model=list[MarketEntitlementRead])
def read_market_entitlements(
    asset_class: str | None = Query(default=None, max_length=24),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[MarketEntitlementRead]:
    enforce_rate_limit("normalized-market-read", current_user.id, NORMALIZED_MARKET_READ_RATE_LIMIT)
    return market_infrastructure.list_entitlements(db, current_user.id, asset_class=asset_class)


@router.get("/market-data/provider-states", response_model=list[MarketProviderStateRead])
def read_market_provider_states(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[MarketProviderStateRead]:
    enforce_rate_limit("normalized-market-read", current_user.id, NORMALIZED_MARKET_READ_RATE_LIMIT)
    return market_infrastructure.list_provider_states(db, current_user.id)


@router.post("/market-data/provider-states/check", response_model=list[MarketProviderStateRead])
def check_market_provider_states(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[MarketProviderStateRead]:
    enforce_rate_limit("normalized-market-write", current_user.id, NORMALIZED_MARKET_WRITE_RATE_LIMIT)
    return market_infrastructure.check_provider_health(db, current_user.id)


@router.post("/market-data/providers/{provider}/reconnect", response_model=MarketProviderStateRead)
def reconnect_market_provider(
    provider: str,
    instrument_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> MarketProviderStateRead:
    enforce_rate_limit("normalized-market-write", current_user.id, NORMALIZED_MARKET_WRITE_RATE_LIMIT)
    try:
        return market_infrastructure.reconnect_provider(
            db, current_user.id, provider=provider, instrument_id=instrument_id
        )
    except market_infrastructure.MarketInfrastructureError as exc:
        raise normalized_market_error(exc) from exc


@router.get("/market-data/diagnostics", response_model=list[MarketDiagnosticRead])
def read_market_diagnostics(
    state: str | None = Query(default="OPEN", max_length=16),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[MarketDiagnosticRead]:
    enforce_rate_limit("normalized-market-read", current_user.id, NORMALIZED_MARKET_READ_RATE_LIMIT)
    return market_infrastructure.list_diagnostics(db, current_user.id, state=state, limit=limit)


@router.post("/market-data/backfills", response_model=MarketBackfillRead, status_code=202)
def create_market_backfill(
    payload: MarketBackfillCreate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> MarketBackfillRead:
    enforce_rate_limit("normalized-market-backfill", current_user.id, NORMALIZED_MARKET_BACKFILL_RATE_LIMIT)
    try:
        return market_infrastructure.run_historical_backfill(db, current_user.id, payload)
    except market_infrastructure.MarketInfrastructureError as exc:
        raise normalized_market_error(exc) from exc


@router.get("/market-data/backfills", response_model=list[MarketBackfillRead])
def read_market_backfills(
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[MarketBackfillRead]:
    enforce_rate_limit("normalized-market-read", current_user.id, NORMALIZED_MARKET_READ_RATE_LIMIT)
    return market_infrastructure.list_backfill_runs(db, current_user.id, limit=limit)


@router.get(
    "/market-data/instruments/{instrument_id}/candles",
    response_model=list[NormalizedCandleRead],
)
def read_normalized_candles(
    instrument_id: int,
    from_at: datetime = Query(...),
    to_at: datetime = Query(...),
    interval_seconds: int = Query(default=60, ge=1, le=86400),
    provider: str | None = Query(default=None, max_length=64),
    limit: int = Query(default=5000, ge=1, le=10000),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[NormalizedCandleRead]:
    enforce_rate_limit("normalized-market-read", current_user.id, NORMALIZED_MARKET_READ_RATE_LIMIT)
    try:
        return market_infrastructure.list_candles(
            db,
            current_user.id,
            instrument_id,
            from_at=from_at,
            to_at=to_at,
            interval_seconds=interval_seconds,
            provider=provider,
            limit=limit,
        )
    except market_infrastructure.MarketInfrastructureError as exc:
        raise normalized_market_error(exc) from exc


@router.get(
    "/market-data/instruments/{instrument_id}/trades",
    response_model=list[MarketTradeTickRead],
)
def read_normalized_trade_ticks(
    instrument_id: int,
    from_at: datetime = Query(...),
    to_at: datetime = Query(...),
    provider: str | None = Query(default=None, max_length=64),
    limit: int = Query(default=10000, ge=1, le=50000),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[MarketTradeTickRead]:
    enforce_rate_limit("normalized-market-read", current_user.id, NORMALIZED_MARKET_READ_RATE_LIMIT)
    try:
        return market_infrastructure.list_trade_ticks(
            db,
            current_user.id,
            instrument_id,
            from_at=from_at,
            to_at=to_at,
            provider=provider,
            limit=limit,
        )
    except market_infrastructure.MarketInfrastructureError as exc:
        raise normalized_market_error(exc) from exc


@router.post(
    "/market-data/instruments/{instrument_id}/footprints",
    response_model=list[FootprintRead],
)
def rebuild_market_footprints(
    instrument_id: int,
    payload: FootprintBuildRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[FootprintRead]:
    enforce_rate_limit("normalized-market-write", current_user.id, NORMALIZED_MARKET_WRITE_RATE_LIMIT)
    try:
        return market_infrastructure.build_footprints(
            db,
            current_user.id,
            instrument_id,
            provider=payload.provider,
            from_at=payload.from_at,
            to_at=payload.to_at,
            interval_seconds=payload.interval_seconds,
            tick_size=payload.tick_size,
            contract_id=payload.contract_id,
            include_empty=payload.include_empty,
        )
    except market_infrastructure.MarketInfrastructureError as exc:
        raise normalized_market_error(exc) from exc


@router.get(
    "/market-data/instruments/{instrument_id}/footprints",
    response_model=list[FootprintRead],
)
def read_market_footprints(
    instrument_id: int,
    from_at: datetime = Query(...),
    to_at: datetime = Query(...),
    interval_seconds: int = Query(default=60, ge=1, le=86400),
    provider: str | None = Query(default=None, max_length=64),
    limit: int = Query(default=5000, ge=1, le=10000),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[FootprintRead]:
    enforce_rate_limit("normalized-market-read", current_user.id, NORMALIZED_MARKET_READ_RATE_LIMIT)
    try:
        return market_infrastructure.list_footprints(
            db,
            current_user.id,
            instrument_id,
            from_at=from_at,
            to_at=to_at,
            interval_seconds=interval_seconds,
            provider=provider,
            limit=limit,
        )
    except market_infrastructure.MarketInfrastructureError as exc:
        raise normalized_market_error(exc) from exc


@router.get("/market-data/instruments/{instrument_id}/order-book", response_model=OrderBookRead)
def read_market_order_book(
    instrument_id: int,
    provider: str | None = Query(default=None, max_length=64),
    aggregation_ticks: int = Query(default=1, ge=1, le=1000),
    depth: int = Query(default=20, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> OrderBookRead:
    enforce_rate_limit("normalized-market-read", current_user.id, NORMALIZED_MARKET_READ_RATE_LIMIT)
    try:
        return market_infrastructure.get_order_book(
            db,
            current_user.id,
            instrument_id,
            provider=provider,
            aggregation_ticks=aggregation_ticks,
            depth=depth,
        )
    except market_infrastructure.MarketInfrastructureError as exc:
        raise normalized_market_error(exc) from exc


@router.post("/market-data/alerts", response_model=MarketAlertRuleRead, status_code=201)
def create_market_alert(
    payload: MarketAlertRuleCreate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> MarketAlertRuleRead:
    enforce_rate_limit("normalized-market-write", current_user.id, NORMALIZED_MARKET_WRITE_RATE_LIMIT)
    try:
        return market_infrastructure.create_alert_rule(db, current_user.id, payload)
    except market_infrastructure.MarketInfrastructureError as exc:
        raise normalized_market_error(exc) from exc


@router.get("/market-data/alerts", response_model=list[MarketAlertRuleRead])
def read_market_alert_rules(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[MarketAlertRuleRead]:
    enforce_rate_limit("normalized-market-read", current_user.id, NORMALIZED_MARKET_READ_RATE_LIMIT)
    return market_infrastructure.list_alert_rules(db, current_user.id)


@router.delete("/market-data/alerts/{rule_id}")
def remove_market_alert_rule(
    rule_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> dict[str, bool]:
    enforce_rate_limit("normalized-market-write", current_user.id, NORMALIZED_MARKET_WRITE_RATE_LIMIT)
    try:
        market_infrastructure.delete_alert_rule(db, current_user.id, rule_id)
        return {"ok": True}
    except market_infrastructure.MarketInfrastructureError as exc:
        raise normalized_market_error(exc) from exc


@router.get("/market-data/alert-events", response_model=list[MarketAlertEventRead])
def read_market_alert_events(
    acknowledged: bool | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[MarketAlertEventRead]:
    enforce_rate_limit("normalized-market-read", current_user.id, NORMALIZED_MARKET_READ_RATE_LIMIT)
    return market_infrastructure.list_alert_events(
        db, current_user.id, acknowledged=acknowledged, limit=limit
    )


@router.post("/market-data/alert-events/{event_id}/acknowledge", response_model=MarketAlertEventRead)
def acknowledge_market_alert_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> MarketAlertEventRead:
    enforce_rate_limit("normalized-market-write", current_user.id, NORMALIZED_MARKET_WRITE_RATE_LIMIT)
    try:
        return market_infrastructure.acknowledge_alert_event(db, current_user.id, event_id)
    except market_infrastructure.MarketInfrastructureError as exc:
        raise normalized_market_error(exc) from exc


@router.post("/market-data/subscriptions", response_model=MarketSubscriptionRead, status_code=201)
def create_market_subscription(
    payload: MarketSubscriptionCreate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> MarketSubscriptionRead:
    enforce_rate_limit("normalized-market-write", current_user.id, NORMALIZED_MARKET_WRITE_RATE_LIMIT)
    try:
        return market_infrastructure.subscribe_market_stream(db, current_user.id, payload)
    except market_infrastructure.MarketInfrastructureError as exc:
        raise normalized_market_error(exc) from exc


@router.get("/market-data/subscriptions", response_model=list[MarketSubscriptionRead])
def read_market_subscriptions(
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[MarketSubscriptionRead]:
    enforce_rate_limit("normalized-market-read", current_user.id, NORMALIZED_MARKET_READ_RATE_LIMIT)
    return market_infrastructure.fanout_hub.list(current_user.id)


@router.get(
    "/market-data/subscriptions/{subscription_id}/events",
    response_model=list[MarketStreamEventRead],
)
def poll_market_subscription(
    subscription_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[MarketStreamEventRead]:
    enforce_rate_limit("normalized-market-read", current_user.id, NORMALIZED_MARKET_READ_RATE_LIMIT)
    try:
        return market_infrastructure.fanout_hub.poll(current_user.id, subscription_id, limit=limit)
    except market_infrastructure.MarketInfrastructureError as exc:
        raise normalized_market_error(exc) from exc


@router.delete("/market-data/subscriptions/{subscription_id}")
def remove_market_subscription(
    subscription_id: str,
    current_user: AuthenticatedUser = Depends(require_auth),
) -> dict[str, bool]:
    enforce_rate_limit("normalized-market-write", current_user.id, NORMALIZED_MARKET_WRITE_RATE_LIMIT)
    if not market_infrastructure.fanout_hub.unsubscribe(current_user.id, subscription_id):
        raise HTTPException(status_code=404, detail="Market-data subscription not found")
    return {"ok": True}


@router.get("/quant/models", response_model=list[AIModelRead])
def list_quant_models(
    response: Response,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[AIModelRead]:
    response.headers["Cache-Control"] = "no-store"
    enforce_rate_limit("ai-read", current_user.id, AI_READ_RATE_LIMIT)
    return quant_ai.ai_provider_router.catalog(db, current_user.id)


@router.post("/quant/scripts", response_model=QuantScriptRead, status_code=201)
def create_quant_script(
    payload: QuantScriptCreate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> QuantScriptRead:
    enforce_rate_limit("ai-write", current_user.id, AI_WRITE_RATE_LIMIT)
    try:
        return quant_ai.create_script(db, current_user.id, payload)
    except quant_ai.AIServiceError as exc:
        raise quant_ai_error(exc) from exc


@router.get("/quant/scripts", response_model=list[QuantScriptRead])
def list_quant_scripts(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[QuantScriptRead]:
    enforce_rate_limit("ai-read", current_user.id, AI_READ_RATE_LIMIT)
    return quant_ai.list_scripts(db, current_user.id)


@router.get("/quant/scripts/{script_id}", response_model=QuantScriptRead)
def read_quant_script(
    script_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> QuantScriptRead:
    enforce_rate_limit("ai-read", current_user.id, AI_READ_RATE_LIMIT)
    try:
        return quant_ai.get_script(db, current_user.id, script_id)
    except quant_ai.AIServiceError as exc:
        raise quant_ai_error(exc) from exc


@router.post(
    "/quant/scripts/{script_id}/versions",
    response_model=QuantScriptVersionRead,
    status_code=201,
)
def create_quant_script_version(
    script_id: int,
    payload: QuantScriptVersionCreate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> QuantScriptVersionRead:
    enforce_rate_limit("ai-write", current_user.id, AI_WRITE_RATE_LIMIT)
    try:
        return quant_ai.create_script_version(db, current_user.id, script_id, payload)
    except quant_ai.AIServiceError as exc:
        raise quant_ai_error(exc) from exc


@router.post("/quant/scripts/{script_id}/versions/{version_id}/activate", response_model=QuantScriptRead)
def activate_quant_script_version(
    script_id: int,
    version_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> QuantScriptRead:
    enforce_rate_limit("ai-write", current_user.id, AI_WRITE_RATE_LIMIT)
    try:
        return quant_ai.activate_script_version(db, current_user.id, script_id, version_id)
    except quant_ai.AIServiceError as exc:
        raise quant_ai_error(exc) from exc


@router.post(
    "/quant/scripts/{script_id}/permissions",
    response_model=QuantScriptPermissionRead,
    status_code=201,
)
def grant_quant_script_permission(
    script_id: int,
    payload: QuantScriptPermissionCreate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> QuantScriptPermissionRead:
    enforce_rate_limit("ai-write", current_user.id, AI_WRITE_RATE_LIMIT)
    try:
        return quant_ai.grant_script_permission(db, current_user.id, script_id, payload)
    except quant_ai.AIServiceError as exc:
        raise quant_ai_error(exc) from exc


@router.get(
    "/quant/scripts/{script_id}/permissions",
    response_model=list[QuantScriptPermissionRead],
)
def list_quant_script_permissions(
    script_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[QuantScriptPermissionRead]:
    enforce_rate_limit("ai-read", current_user.id, AI_READ_RATE_LIMIT)
    try:
        return quant_ai.list_script_permissions(db, current_user.id, script_id)
    except quant_ai.AIServiceError as exc:
        raise quant_ai_error(exc) from exc


@router.delete(
    "/quant/scripts/{script_id}/permissions/{permission_id}",
    response_model=QuantScriptPermissionRead,
)
def revoke_quant_script_permission(
    script_id: int,
    permission_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> QuantScriptPermissionRead:
    enforce_rate_limit("ai-write", current_user.id, AI_WRITE_RATE_LIMIT)
    try:
        return quant_ai.revoke_script_permission(
            db, current_user.id, script_id, permission_id
        )
    except quant_ai.AIServiceError as exc:
        raise quant_ai_error(exc) from exc


@router.post("/quant/conversations", response_model=AIConversationRead, status_code=201)
def create_quant_conversation(
    payload: AIConversationCreate,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> AIConversationRead:
    enforce_rate_limit("ai-write", current_user.id, AI_WRITE_RATE_LIMIT)
    return quant_ai.create_conversation(db, current_user.id, payload)


@router.post("/quant/captures", response_model=AIChartImageMetadata, status_code=201)
def upload_quant_capture(
    payload: AIChartImageUpload,
    current_user: AuthenticatedUser = Depends(require_auth),
) -> AIChartImageMetadata:
    enforce_rate_limit("ai-write", current_user.id, AI_WRITE_RATE_LIMIT)
    try:
        return quant_ai.store_chart_capture(
            current_user.id, payload, root=settings.quant_capture_root
        )
    except quant_ai.AIServiceError as exc:
        raise quant_ai_error(exc) from exc


@router.get("/quant/conversations", response_model=list[AIConversationRead])
def list_quant_conversations(
    kind: str | None = Query(default=None, max_length=32),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[AIConversationRead]:
    enforce_rate_limit("ai-read", current_user.id, AI_READ_RATE_LIMIT)
    return quant_ai.list_conversations(db, current_user.id, kind=kind)


@router.get("/quant/conversations/{conversation_id}", response_model=AIConversationRead)
def read_quant_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> AIConversationRead:
    enforce_rate_limit("ai-read", current_user.id, AI_READ_RATE_LIMIT)
    try:
        return quant_ai.get_conversation(db, current_user.id, conversation_id)
    except quant_ai.AIServiceError as exc:
        raise quant_ai_error(exc) from exc


@router.post("/quant/jobs", response_model=AIGenerationJobRead, status_code=202)
def enqueue_quant_job(
    payload: AIGenerationRequest,
    response: Response,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> AIGenerationJobRead:
    response.headers["Cache-Control"] = "no-store"
    enforce_rate_limit("ai-generation", current_user.id, AI_GENERATION_RATE_LIMIT)
    try:
        return quant_ai.create_generation_job(db, current_user.id, payload)
    except quant_ai.AIServiceError as exc:
        raise quant_ai_error(exc) from exc


@router.get("/quant/jobs", response_model=list[AIGenerationJobRead])
def list_quant_jobs(
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[AIGenerationJobRead]:
    enforce_rate_limit("ai-read", current_user.id, AI_READ_RATE_LIMIT)
    return quant_ai.list_generation_jobs(db, current_user.id, limit=limit)


@router.get("/quant/jobs/{job_id}", response_model=AIGenerationJobRead)
def read_quant_job(
    job_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> AIGenerationJobRead:
    enforce_rate_limit("ai-read", current_user.id, AI_READ_RATE_LIMIT)
    try:
        return quant_ai.get_generation_job(db, current_user.id, job_id)
    except quant_ai.AIServiceError as exc:
        raise quant_ai_error(exc) from exc


@router.post("/quant/jobs/{job_id}/run", response_model=AIGenerationJobRead)
def run_quant_job(
    job_id: int,
    response: Response,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> AIGenerationJobRead:
    response.headers["Cache-Control"] = "no-store"
    enforce_rate_limit("ai-generation", current_user.id, AI_GENERATION_RATE_LIMIT)
    try:
        return quant_ai.run_generation_job(db, current_user.id, job_id)
    except quant_ai.AIServiceError as exc:
        raise quant_ai_error(exc) from exc


@router.post("/quant/jobs/{job_id}/cancel", response_model=AIGenerationJobRead)
def cancel_quant_job(
    job_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> AIGenerationJobRead:
    enforce_rate_limit("ai-generation", current_user.id, AI_GENERATION_RATE_LIMIT)
    try:
        return quant_ai.cancel_generation_job(db, current_user.id, job_id)
    except quant_ai.AIServiceError as exc:
        raise quant_ai_error(exc) from exc


@router.get("/quant/jobs/{job_id}/events", response_model=list[AIJobEventRead])
def read_quant_job_events(
    job_id: int,
    after_sequence: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[AIJobEventRead]:
    enforce_rate_limit("ai-read", current_user.id, AI_READ_RATE_LIMIT)
    try:
        return quant_ai.list_job_events(
            db, current_user.id, job_id, after_sequence=after_sequence
        )
    except quant_ai.AIServiceError as exc:
        raise quant_ai_error(exc) from exc


@router.get("/quant/jobs/{job_id}/events/stream")
def stream_quant_job_events(
    job_id: int,
    request: Request,
    after_sequence: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> StreamingResponse:
    enforce_rate_limit("ai-read", current_user.id, AI_READ_RATE_LIMIT)
    try:
        quant_ai.get_generation_job(db, current_user.id, job_id)
    except quant_ai.AIServiceError as exc:
        raise quant_ai_error(exc) from exc

    async def payloads():
        sequence = after_sequence
        idle_ticks = 0
        while True:
            if await request.is_disconnected():
                return
            with SessionLocal() as stream_db:
                events = quant_ai.list_job_events(
                    stream_db, current_user.id, job_id, after_sequence=sequence
                )
                job = quant_ai.get_generation_job(stream_db, current_user.id, job_id)
            for event in events:
                sequence = event.sequence
                data = json.dumps(event.model_dump(mode="json"), separators=(",", ":"))
                yield f"id: {event.sequence}\nevent: {event.event_type.lower()}\ndata: {data}\n\n"
            if job.status in {"COMPLETED", "FAILED", "CANCELLED"} and not events:
                yield f"event: end\ndata: {json.dumps({'status': job.status.lower()})}\n\n"
                return
            idle_ticks += 1
            if idle_ticks % 15 == 0:
                yield ": keep-alive\n\n"
            await asyncio.sleep(0.2)

    return StreamingResponse(
        payloads(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.get("/quant/artifacts", response_model=list[AIGeneratedArtifactRead])
def list_quant_artifacts(
    conversation_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[AIGeneratedArtifactRead]:
    enforce_rate_limit("ai-read", current_user.id, AI_READ_RATE_LIMIT)
    try:
        return quant_ai.list_artifacts(db, current_user.id, conversation_id=conversation_id)
    except quant_ai.AIServiceError as exc:
        raise quant_ai_error(exc) from exc


@router.post("/quant/artifacts/{artifact_id}/activate", response_model=AIGeneratedArtifactRead)
def activate_quant_artifact(
    artifact_id: int,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> AIGeneratedArtifactRead:
    enforce_rate_limit("ai-write", current_user.id, AI_WRITE_RATE_LIMIT)
    try:
        return quant_ai.activate_artifact(db, current_user.id, artifact_id)
    except quant_ai.AIServiceError as exc:
        raise quant_ai_error(exc) from exc


@router.post("/quant/backtests", response_model=AIBacktestRead, status_code=201)
def create_quant_backtest(
    payload: AIBacktestRequest,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> AIBacktestRead:
    enforce_rate_limit("ai-generation", current_user.id, AI_GENERATION_RATE_LIMIT)
    try:
        return quant_ai.run_indicator_backtest(db, current_user.id, payload)
    except quant_ai.AIServiceError as exc:
        raise quant_ai_error(exc) from exc


@router.get("/quant/backtests", response_model=list[AIBacktestRead])
def list_quant_backtests(
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> list[AIBacktestRead]:
    enforce_rate_limit("ai-read", current_user.id, AI_READ_RATE_LIMIT)
    return quant_ai.list_backtests(db, current_user.id, limit=limit)


@router.get("/quant/usage", response_model=AIUsageSummaryRead)
def read_quant_usage(
    response: Response,
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> AIUsageSummaryRead:
    response.headers["Cache-Control"] = "no-store"
    enforce_rate_limit("ai-read", current_user.id, AI_READ_RATE_LIMIT)
    return quant_ai.usage_summary(db, current_user.id)


@router.post("/quant/retention/purge", response_model=AIRetentionResult)
def purge_quant_retention(
    db: Session = Depends(get_db),
    current_user: AuthenticatedUser = Depends(require_auth),
) -> AIRetentionResult:
    enforce_rate_limit("ai-write", current_user.id, AI_WRITE_RATE_LIMIT)
    return quant_ai.purge_expired_ai_data(db, current_user.id)
