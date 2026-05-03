from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.schemas import (
    BacktestAdvanceRequest,
    BacktestCreate,
    BacktestJumpRequest,
    BacktestState,
    BarsResponse,
    DatasetMeta,
    JournalUpdate,
    MetricsResponse,
    OrderCreate,
    OrderUpdate,
    PlaybookCreate,
    PlaybookRead,
    TradeRead,
)
from app.services.backtester import BacktestService, list_latest_session
from app.services.market_data import MarketDataService
from app.services.metrics import get_metrics


router = APIRouter()
market_data = MarketDataService(settings.csv_path, cache=settings.cache_market_data)
backtester = BacktestService(market_data)


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/market-data/meta", response_model=DatasetMeta)
def market_data_meta() -> DatasetMeta:
    try:
        return market_data.get_metadata()
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/market-data/bars", response_model=BarsResponse)
def market_data_bars(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=300, ge=1, le=5000),
    warmup: int = Query(default=120, ge=0, le=1000),
) -> BarsResponse:
    try:
        return market_data.get_bars(offset=offset, limit=limit, warmup=warmup)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/backtests", response_model=BacktestState)
def create_backtest(
    payload: BacktestCreate,
    db: Session = Depends(get_db),
) -> BacktestState:
    return backtester.create_session(db, payload)


@router.get("/backtests/latest", response_model=BacktestState)
def latest_backtest(db: Session = Depends(get_db)) -> BacktestState:
    session = list_latest_session(db)
    if session is None:
        return backtester.create_session(db, BacktestCreate())
    return backtester.get_state(db, session.id)


@router.get("/backtests/{session_id}", response_model=BacktestState)
def get_backtest(session_id: int, db: Session = Depends(get_db)) -> BacktestState:
    return backtester.get_state(db, session_id)


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


@router.get("/metrics", response_model=MetricsResponse)
def metrics(
    session_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
) -> MetricsResponse:
    if session_id is None:
        session = list_latest_session(db)
        session_id = session.id if session else None
    return get_metrics(db, session_id)
