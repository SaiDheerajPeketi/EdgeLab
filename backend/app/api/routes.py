from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal, get_db
from app.models import AppStorageItem, utcnow
from app.schemas import (
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
