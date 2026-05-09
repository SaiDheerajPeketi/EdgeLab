import json
import re
from datetime import datetime, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import DateTime, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal, get_db
from app.models import (
    AppStorageItem,
    BacktestSession,
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
    AppDataImportResult,
    AppStoragePayload,
    AppStorageRead,
    BacktestAdvanceRequest,
    BacktestCreate,
    BacktestJumpRequest,
    BacktestSessionRead,
    BacktestSessionUpdate,
    BacktestState,
    BacktestTradeImport,
    BacktestTradeImportResult,
    BarsResponse,
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
market_data = MarketDataService(settings.csv_path, cache=settings.cache_market_data)
dataset_catalog = DatasetCatalogService(settings.datasets_root, SessionLocal)
backtester = BacktestService(market_data, dataset_catalog)

DUKASCOPY_URL = "https://freeserv.dukascopy.com/2.0/index.php"
DUKASCOPY_HEADERS = {
    "User-Agent": "edgelab-local-datafeed",
    "Referer": "https://freeserv.dukascopy.com/2.0/?path=chart/index&instrument=EUR/USD",
}
DUKASCOPY_INTERVALS = {"1MIN", "5MIN", "15MIN", "1HOUR", "1DAY"}


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
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/market-data/meta", response_model=DatasetMeta)
def market_data_meta(
    session_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
) -> DatasetMeta:
    try:
        if session_id is not None:
            session = backtester.get_session(db, session_id)
            return backtester.market_data_for_session(session).get_metadata()
        return market_data.get_metadata()
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/datasets", response_model=DatasetCatalogResponse)
def datasets(db: Session = Depends(get_db)) -> DatasetCatalogResponse:
    try:
        return dataset_catalog.list_catalog(db)
    except (DatasetRefreshInProgress, FileNotFoundError, OperationalError, ValueError) as exc:
        raise dataset_error_response(exc) from exc


@router.get("/datasets/settings", response_model=DatasetSettingsRead)
def dataset_settings(db: Session = Depends(get_db)) -> DatasetSettingsRead:
    try:
        return dataset_catalog.get_settings(db)
    except (DatasetRefreshInProgress, FileNotFoundError, OperationalError, ValueError) as exc:
        raise dataset_error_response(exc) from exc


@router.patch("/datasets/settings", response_model=DatasetCatalogResponse)
def update_dataset_settings(
    payload: DatasetSettingsUpdate,
    db: Session = Depends(get_db),
) -> DatasetCatalogResponse:
    try:
        return dataset_catalog.update_settings(db, payload)
    except (DatasetRefreshInProgress, FileNotFoundError, OperationalError, ValueError) as exc:
        db.rollback()
        raise dataset_error_response(exc) from exc


@router.post("/datasets/refresh", response_model=DatasetRefreshResponse)
def refresh_datasets(db: Session = Depends(get_db)) -> DatasetRefreshResponse:
    try:
        return dataset_catalog.start_refresh(db)
    except (DatasetRefreshInProgress, FileNotFoundError, OperationalError, ValueError) as exc:
        db.rollback()
        raise dataset_error_response(exc) from exc


@router.get("/datasets/refresh/status", response_model=DatasetRefreshStatus)
def dataset_refresh_status() -> DatasetRefreshStatus:
    return dataset_catalog.refresh_status()


@router.patch("/datasets/assets/{asset_id}", response_model=DatasetCatalogResponse)
def update_dataset_asset(
    asset_id: str,
    payload: DatasetAssetUpdate,
    db: Session = Depends(get_db),
) -> DatasetCatalogResponse:
    try:
        return dataset_catalog.update_asset(db, asset_id, payload)
    except (DatasetRefreshInProgress, FileNotFoundError, OperationalError, ValueError) as exc:
        db.rollback()
        raise dataset_error_response(exc) from exc


@router.get("/app-data/export", response_model=AppDataBundle)
def export_app_data(db: Session = Depends(get_db)) -> AppDataBundle:
    tables = {
        table_name: [
            serialize_bundle_row(row)
            for row in db.scalars(select(model)).all()
        ]
        for table_name, model in APP_DATA_TABLES
    }
    return AppDataBundle(exported_at=utcnow(), tables=tables)


@router.post("/app-data/import", response_model=AppDataImportResult)
def import_app_data(
    bundle: AppDataBundle,
    db: Session = Depends(get_db),
) -> AppDataImportResult:
    if bundle.app != "edgelab":
        raise HTTPException(status_code=400, detail="Import file is not an EdgeLab data bundle")
    if bundle.version > 1:
        raise HTTPException(status_code=400, detail="Import bundle version is newer than this app supports")

    try:
        for _table_name, model in reversed(APP_DATA_TABLES):
            db.query(model).delete(synchronize_session=False)
        db.flush()

        summary: dict[str, int] = {}
        for table_name, model in APP_DATA_TABLES:
            rows = bundle.tables.get(table_name, [])
            summary[table_name] = len(rows)
            for row in rows:
                db.add(bundle_row_to_model(model, row))
        db.commit()
        return AppDataImportResult(imported_at=utcnow(), summary=summary)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Import failed: {exc}") from exc


@router.get("/app-storage/{namespace}/{key}", response_model=AppStorageRead)
def get_app_storage_item(
    namespace: str,
    key: str,
    db: Session = Depends(get_db),
) -> AppStorageRead:
    item = db.scalar(
        select(AppStorageItem).where(
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
) -> AppStorageRead:
    item = db.scalar(
        select(AppStorageItem).where(
            AppStorageItem.namespace == namespace,
            AppStorageItem.key == key,
        )
    )
    if item is None:
        item = AppStorageItem(namespace=namespace, key=key, value=payload.value)
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
) -> AppStorageRead:
    item = db.scalar(
        select(AppStorageItem).where(
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
) -> BarsResponse:
    try:
        service = market_data
        if session_id is not None:
            session = backtester.get_session(db, session_id)
            service = backtester.market_data_for_session(session)
        return service.get_bars(offset=offset, limit=limit, warmup=warmup)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/live/dukascopy/instruments", response_model=DukascopyInstrumentsResponse)
def dukascopy_instruments(
    search: str | None = Query(default=None, max_length=80),
    limit: int = Query(default=120, ge=1, le=500),
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


@router.post("/backtests", response_model=BacktestState)
def create_backtest(
    payload: BacktestCreate,
    db: Session = Depends(get_db),
) -> BacktestState:
    return backtester.create_session(db, payload)


@router.get("/backtests", response_model=list[BacktestSessionRead])
def list_backtests(db: Session = Depends(get_db)) -> list[BacktestSessionRead]:
    return [
        BacktestSessionRead.model_validate(session)
        for session in backtester.list_sessions(db)
    ]


@router.get("/backtests/latest", response_model=BacktestState)
def latest_backtest(db: Session = Depends(get_db)) -> BacktestState:
    session = list_latest_session(db)
    if session is None:
        return backtester.create_session(db, BacktestCreate())
    return backtester.get_state(db, session.id)


@router.post("/backtests/import-trades", response_model=BacktestTradeImportResult)
def import_backtest_trades(
    payload: BacktestTradeImport,
    db: Session = Depends(get_db),
) -> BacktestTradeImportResult:
    try:
        try:
            fallback_rows = market_data.get_metadata().rows
        except (FileNotFoundError, ValueError):
            fallback_rows = 1
        return import_trade_csv(
            db,
            payload,
            fallback_csv_path=market_data.csv_path,
            fallback_rows=fallback_rows,
        )
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/backtests/{session_id}", response_model=BacktestState)
def get_backtest(session_id: int, db: Session = Depends(get_db)) -> BacktestState:
    return backtester.get_state(db, session_id)


@router.patch("/backtests/{session_id}", response_model=BacktestSessionRead)
def patch_backtest_session(
    session_id: int,
    payload: BacktestSessionUpdate,
    db: Session = Depends(get_db),
) -> BacktestSessionRead:
    return BacktestSessionRead.model_validate(
        backtester.update_session(db, session_id, payload),
    )


@router.delete("/backtests/{session_id}")
def delete_backtest_session(
    session_id: int,
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    backtester.delete_session(db, session_id)
    return {"ok": True}


@router.post("/backtests/{session_id}/advance", response_model=BacktestState)
def advance_backtest(
    session_id: int,
    payload: BacktestAdvanceRequest,
    db: Session = Depends(get_db),
) -> BacktestState:
    return backtester.advance(db, session_id, payload)


@router.post("/backtests/{session_id}/jump", response_model=BacktestState)
def jump_backtest(
    session_id: int,
    payload: BacktestJumpRequest,
    db: Session = Depends(get_db),
) -> BacktestState:
    return backtester.jump(db, session_id, payload)


@router.post("/backtests/{session_id}/orders", response_model=BacktestState)
def create_order(
    session_id: int,
    payload: OrderCreate,
    db: Session = Depends(get_db),
) -> BacktestState:
    return backtester.place_order(db, session_id, payload)


@router.patch("/backtests/{session_id}/orders/{order_id}", response_model=BacktestState)
def amend_order(
    session_id: int,
    order_id: int,
    payload: OrderUpdate,
    db: Session = Depends(get_db),
) -> BacktestState:
    return backtester.update_order(db, session_id, order_id, payload)


@router.patch("/backtests/{session_id}/position", response_model=BacktestState)
def amend_position(
    session_id: int,
    payload: PositionUpdate,
    db: Session = Depends(get_db),
) -> BacktestState:
    return backtester.update_position(db, session_id, payload)


@router.delete("/backtests/{session_id}/orders/{order_id}", response_model=BacktestState)
def cancel_order(
    session_id: int,
    order_id: int,
    db: Session = Depends(get_db),
) -> BacktestState:
    return backtester.cancel_order(db, session_id, order_id)


@router.get("/playbooks", response_model=list[PlaybookRead])
def get_playbooks(db: Session = Depends(get_db)) -> list[PlaybookRead]:
    return backtester.list_playbooks(db)


@router.post("/playbooks", response_model=PlaybookRead)
def create_playbook(
    payload: PlaybookCreate,
    db: Session = Depends(get_db),
) -> PlaybookRead:
    return backtester.create_playbook(db, payload)


@router.patch("/playbooks/{playbook_id}", response_model=PlaybookRead)
def update_playbook(
    playbook_id: int,
    payload: PlaybookUpdate,
    db: Session = Depends(get_db),
) -> PlaybookRead:
    return backtester.update_playbook(db, playbook_id, payload)


@router.delete("/playbooks/{playbook_id}")
def delete_playbook(
    playbook_id: int,
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    backtester.delete_playbook(db, playbook_id)
    return {"ok": True}


@router.get("/trades", response_model=list[TradeRead])
def get_trades(
    session_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[TradeRead]:
    return backtester.list_trades(db, session_id)


@router.patch("/trades/{trade_id}/journal", response_model=TradeRead)
def patch_journal(
    trade_id: int,
    payload: JournalUpdate,
    db: Session = Depends(get_db),
) -> TradeRead:
    return backtester.update_journal(db, trade_id, payload)


@router.patch("/trades/{trade_id}/strategy", response_model=TradeRead)
def patch_trade_strategy(
    trade_id: int,
    payload: TradeStrategyUpdate,
    db: Session = Depends(get_db),
) -> TradeRead:
    return backtester.update_trade_strategy(db, trade_id, payload)


@router.get("/metrics", response_model=MetricsResponse)
def metrics(
    session_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
) -> MetricsResponse:
    if session_id is None:
        session = list_latest_session(db)
        session_id = session.id if session else None
    return get_metrics(db, session_id)
