import json
from collections import OrderedDict
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from threading import Lock
from fastapi import HTTPException
from sqlalchemy import and_, asc, desc, or_, select
from sqlalchemy.orm import Session, object_session

from app.models import (
    BacktestSession,
    Execution,
    Order,
    Playbook,
    Position,
    Trade,
    TradeNote,
)
from app.schemas import (
    BacktestAdvanceRequest,
    BacktestCreate,
    BacktestJumpRequest,
    BacktestReplayUpdate,
    BacktestSessionUpdate,
    BacktestState,
    Candle,
    ExecutionRead,
    JournalUpdate,
    OrderCreate,
    OrderRead,
    OrderUpdate,
    MetricsResponse,
    PlaybookCreate,
    PlaybookRead,
    PlaybookUpdate,
    PositionRead,
    PositionUpdate,
    TradeRead,
    TradeStrategyUpdate,
)
from app.services.datasets import DatasetCatalogService
from app.services.database_market_data import DatabaseMarketDataService
from app.services.market_data import MarketDataService
from app.services.metrics import get_metrics
from app.services.session_summaries import refresh_session_summary


OPEN_ORDER = "PENDING"
FILLED_ORDER = "FILLED"
CANCELLED_ORDER = "CANCELLED"
STATE_EXECUTION_LIMIT = 1000
STATE_ORDER_LIMIT = 500
STATE_TRADE_LIMIT = 500
MARKET_DATA_CACHE_MAX_ENTRIES = 128


class BacktestService:
    def __init__(
        self,
        market_data: MarketDataService | None = None,
        dataset_catalog: DatasetCatalogService | None = None,
    ):
        self.market_data = market_data
        self.dataset_catalog = dataset_catalog
        self._market_data_cache: OrderedDict[str, MarketDataService | DatabaseMarketDataService] = OrderedDict()
        self._market_data_cache_lock = Lock()
        if market_data is not None:
            self._market_data_cache[str(market_data.csv_path)] = market_data

    def _cached_market_data(
        self,
        key: str,
        loader: Callable[[], MarketDataService | DatabaseMarketDataService],
    ) -> MarketDataService | DatabaseMarketDataService:
        with self._market_data_cache_lock:
            service = self._market_data_cache.get(key)
            if service is not None:
                self._market_data_cache.move_to_end(key)
        # Source checks may touch disk/SQL; do not hold the registry lock over I/O.
        if service is None or service.source_has_changed():
            service = loader()
            with self._market_data_cache_lock:
                self._market_data_cache[key] = service
                self._market_data_cache.move_to_end(key)
                while len(self._market_data_cache) > MARKET_DATA_CACHE_MAX_ENTRIES:
                    self._market_data_cache.popitem(last=False)
        # A request keeps its service even if another request evicts its cache entry.
        return service

    def create_session(self, db: Session, user_id: int, payload: BacktestCreate) -> BacktestState:
        csv_path = self.market_data.csv_path if self.market_data is not None else None
        instrument = payload.instrument
        timeframe = payload.timeframe
        symbol = payload.symbol
        currency = payload.currency
        timestamp_timezone = payload.timezone
        pnl_multiplier = payload.pnl_multiplier
        dataset_asset_id = None
        if self.dataset_catalog is not None and (payload.csv_path or payload.instrument or payload.timeframe):
            resolution = self.dataset_catalog.resolve_dataset(
                db,
                user_id,
                csv_path=payload.csv_path,
                instrument=payload.instrument,
                timeframe=payload.timeframe,
            )
            csv_path = resolution.csv_path
            instrument = resolution.instrument
            timeframe = resolution.timeframe
            symbol = symbol or resolution.symbol
            currency = currency or resolution.currency
            timestamp_timezone = timestamp_timezone or resolution.timezone
            pnl_multiplier = pnl_multiplier or resolution.pnl_multiplier
            dataset_asset_id = resolution.asset_id
        elif csv_path is None and self.dataset_catalog is not None:
            resolution = self.dataset_catalog.resolve_default_dataset(db, user_id)
            csv_path = resolution.csv_path
            instrument = resolution.instrument
            timeframe = resolution.timeframe
            symbol = symbol or resolution.symbol
            currency = currency or resolution.currency
            timestamp_timezone = timestamp_timezone or resolution.timezone
            pnl_multiplier = pnl_multiplier or resolution.pnl_multiplier
            dataset_asset_id = resolution.asset_id

        if csv_path is None:
            raise FileNotFoundError(
                "No market data is available. Add market data before starting a replay."
            )
        symbol = symbol or Path(csv_path).stem.upper()
        name = payload.name or f"{symbol} {timeframe or 'Replay'}"

        market_data = self.market_data_for_path(
            str(csv_path),
            timestamp_timezone or "UTC",
            db=db,
            user_id=user_id,
        )
        metadata = market_data.get_metadata()
        start_offset = payload.initial_offset
        if payload.start_timestamp is not None:
            found = market_data.find_offset_at_or_after(payload.start_timestamp)
            start_offset = found if found is not None else max(metadata.rows - 1, 0)
        start_offset = min(max(start_offset, 0), max(metadata.rows - 1, 0))

        end_offset = metadata.rows - 1 if metadata.rows > 0 else None
        if payload.end_timestamp is not None:
            found = market_data.find_offset_at_or_after(payload.end_timestamp)
            end_offset = found if found is not None else end_offset
        if end_offset is not None:
            end_offset = max(start_offset, min(end_offset, max(metadata.rows - 1, 0)))

        if payload.playbook_id is not None:
            self._playbook_or_404(db, user_id, payload.playbook_id)

        session = BacktestSession(
            user_id=user_id,
            name=name,
            symbol=symbol,
            instrument=instrument,
            timeframe=timeframe,
            dataset_asset_id=dataset_asset_id,
            csv_path=str(csv_path),
            currency=currency,
            timezone=timestamp_timezone,
            pnl_multiplier=pnl_multiplier or 1.0,
            strategy_name=payload.strategy_name,
            playbook_id=payload.playbook_id,
            start_at=payload.start_timestamp,
            end_at=payload.end_timestamp,
            start_offset=start_offset,
            end_offset=end_offset,
            current_offset=start_offset,
            replay_ready=True,
            initial_balance=payload.initial_balance,
            default_commission_mode=_normalize_commission_mode(payload.default_commission_mode),
            default_commission_value=_commission_value(payload.default_commission_mode, payload.default_commission_value),
            default_fee_mode=_normalize_commission_mode(payload.default_fee_mode),
            default_fee_value=_commission_value(payload.default_fee_mode, payload.default_fee_value),
        )
        db.add(session)
        db.flush()
        db.add(Position(user_id=user_id, session_id=session.id))
        refresh_session_summary(db, user_id, session.id)
        db.commit()
        current_candle = self.market_data_for_session(session).get_candle(session.current_offset)
        return BacktestState(
            session=session,
            current_candle=current_candle,
            position=self._position_read(db, user_id, session, current_candle),
            orders=[],
            executions=[],
            trades=[],
            metrics=_empty_metrics(),
        )

    def get_state(self, db: Session, user_id: int, session_id: int) -> BacktestState:
        session = self._session_or_404(db, user_id, session_id)
        self._repair_negative_open_position(db, user_id, session)
        return self._build_state(db, user_id, session)

    def _build_state(
        self,
        db: Session,
        user_id: int,
        session: BacktestSession,
    ) -> BacktestState:
        current_candle = self.market_data_for_session(session).get_candle(session.current_offset)
        return BacktestState(
            session=session,
            current_candle=current_candle,
            position=self._position_read(db, user_id, session, current_candle),
            orders=[
                to_order_read(order)
                for order in db.scalars(
                    select(Order)
                    .where(
                        Order.user_id == user_id,
                        Order.session_id == session.id,
                    )
                    .order_by(desc(Order.created_at), desc(Order.id))
                    .limit(STATE_ORDER_LIMIT)
                )
            ],
            executions=[
                to_execution_read(execution)
                for execution in db.scalars(
                    select(Execution)
                    .where(
                        Execution.user_id == user_id,
                        Execution.session_id == session.id,
                    )
                    .order_by(desc(Execution.timestamp), desc(Execution.id))
                    .limit(STATE_EXECUTION_LIMIT)
                )
            ],
            trades=[
                to_trade_read(trade)
                for trade in db.scalars(
                    select(Trade)
                    .where(
                        Trade.user_id == user_id,
                        Trade.session_id == session.id,
                    )
                    .order_by(desc(Trade.entry_time), desc(Trade.id))
                    .limit(STATE_TRADE_LIMIT)
                )
            ],
            metrics=get_metrics(db, user_id, session.id),
        )

    def _build_replay_update(
        self,
        db: Session,
        user_id: int,
        session: BacktestSession,
        *,
        include_history: bool,
        include_metrics: bool,
    ) -> BacktestReplayUpdate:
        current_candle = self.market_data_for_session(session).get_candle(session.current_offset)
        position = self._position_read(db, user_id, session, current_candle)
        if not include_history and not include_metrics:
            return BacktestReplayUpdate(
                session=session,
                current_candle=current_candle,
                position=position,
                history_changed=False,
                metrics_changed=False,
            )
        full_state = self._build_state(db, user_id, session)
        return BacktestReplayUpdate(
            session=full_state.session,
            current_candle=full_state.current_candle,
            position=full_state.position,
            orders=full_state.orders if include_history else None,
            executions=full_state.executions if include_history else None,
            trades=full_state.trades if include_history else None,
            metrics=full_state.metrics if include_metrics else None,
            history_changed=include_history,
            metrics_changed=include_metrics,
        )

    def place_order(
        self,
        db: Session,
        user_id: int,
        session_id: int,
        payload: OrderCreate,
    ) -> BacktestState:
        session = self._session_or_404(db, user_id, session_id)
        current_candle = self._current_candle_or_404(session)
        if payload.playbook_id is not None:
            self._playbook_or_404(db, user_id, payload.playbook_id)
        quantity = self._resolve_quantity(db, session, payload, current_candle.close)
        commission_mode, commission_value = _payload_cost_config(
            payload,
            "commission_mode",
            "commission_value",
            session.default_commission_mode,
            session.default_commission_value,
        )
        fee_mode, fee_value = _payload_cost_config(
            payload,
            "fee_mode",
            "fee_value",
            session.default_fee_mode,
            session.default_fee_value,
        )
        order = Order(
            user_id=user_id,
            session_id=session.id,
            playbook_id=payload.playbook_id,
            status=OPEN_ORDER,
            side=payload.side,
            order_type=payload.order_type,
            quantity=quantity,
            risk_percent=payload.risk_percent,
            limit_price=payload.limit_price,
            stop_price=payload.stop_price,
            stop_loss=payload.stop_loss,
            take_profit=payload.take_profit,
            breakeven_trigger_r=payload.breakeven_trigger_r,
            reduce_only=payload.reduce_only,
            commission_mode=commission_mode,
            commission_value=commission_value,
            fee_mode=fee_mode,
            fee_value=fee_value,
            strategy_name=payload.strategy_name,
            mistake_tags=json.dumps(payload.mistake_tags),
            notes=payload.notes,
            created_offset=session.current_offset,
        )
        db.add(order)
        db.flush()

        if order.order_type == "MARKET":
            self._fill_order(db, user_id, session, order, current_candle, current_candle.close)
        refresh_session_summary(db, user_id, session.id)
        db.commit()
        return self.get_state(db, user_id, session.id)

    def update_order(
        self,
        db: Session,
        user_id: int,
        session_id: int,
        order_id: int,
        payload: OrderUpdate,
    ) -> BacktestState:
        session = self._session_or_404(db, user_id, session_id)
        order = self._order_or_404(db, user_id, session.id, order_id)
        if order.status != OPEN_ORDER:
            raise HTTPException(status_code=409, detail="Only pending orders can be amended")

        if payload.playbook_id is not None:
            self._playbook_or_404(db, user_id, payload.playbook_id)

        for field in (
            "quantity",
            "limit_price",
            "stop_price",
            "stop_loss",
            "take_profit",
            "breakeven_trigger_r",
            "reduce_only",
            "commission_mode",
            "commission_value",
            "fee_mode",
            "fee_value",
            "strategy_name",
            "playbook_id",
            "notes",
        ):
            value = getattr(payload, field)
            if value is not None:
                if field == "commission_mode":
                    setattr(order, field, _normalize_commission_mode(value))
                elif field == "commission_value":
                    setattr(order, field, _commission_value(order.commission_mode, value))
                elif field == "fee_mode":
                    setattr(order, field, _normalize_commission_mode(value))
                elif field == "fee_value":
                    setattr(order, field, _commission_value(order.fee_mode, value))
                else:
                    setattr(order, field, value)
        if payload.mistake_tags is not None:
            order.mistake_tags = json.dumps(payload.mistake_tags)
        db.commit()
        return self.get_state(db, user_id, session.id)

    def update_position(
        self,
        db: Session,
        user_id: int,
        session_id: int,
        payload: PositionUpdate,
    ) -> BacktestState:
        session = self._session_or_404(db, user_id, session_id)
        position = db.scalar(
            select(Position).where(
                Position.user_id == user_id,
                Position.session_id == session.id,
            )
        )
        if position is None or position.quantity <= 0 or position.side == "FLAT":
            raise HTTPException(status_code=409, detail="Only active positions can be amended")

        updates = payload.model_dump(exclude_unset=True)
        if "stop_loss" in updates:
            position.stop_loss = updates["stop_loss"]
        if "take_profit" in updates:
            position.take_profit = updates["take_profit"]

        trade = self._open_trade_for_position(db, user_id, session.id, position.side)
        if trade is not None:
            if "stop_loss" in updates:
                trade.stop_loss = updates["stop_loss"]
            if "take_profit" in updates:
                trade.take_profit = updates["take_profit"]

        db.commit()
        return self.get_state(db, user_id, session.id)

    def cancel_order(self, db: Session, user_id: int, session_id: int, order_id: int) -> BacktestState:
        session = self._session_or_404(db, user_id, session_id)
        order = self._order_or_404(db, user_id, session.id, order_id)
        if order.status != OPEN_ORDER:
            raise HTTPException(status_code=409, detail="Only pending orders can be cancelled")
        order.status = CANCELLED_ORDER
        db.commit()
        return self.get_state(db, user_id, session.id)

    def advance(
        self,
        db: Session,
        user_id: int,
        session_id: int,
        payload: BacktestAdvanceRequest,
    ) -> BacktestState:
        session = self._session_or_404(db, user_id, session_id)
        market_data = self.market_data_for_session(session)
        for _ in range(payload.steps):
            next_offset = session.current_offset + 1
            if session.end_offset is not None and next_offset > session.end_offset:
                session.status = "COMPLETE"
                break
            candle = market_data.get_candle(next_offset)
            if candle is None:
                session.status = "COMPLETE"
                break
            session.current_offset = next_offset
            self._process_candle(db, user_id, session, candle)
        refresh_session_summary(db, user_id, session.id)
        db.commit()
        return self.get_state(db, user_id, session.id)

    def advance_compact(
        self,
        db: Session,
        user_id: int,
        session_id: int,
        payload: BacktestAdvanceRequest,
    ) -> BacktestReplayUpdate:
        session = self._session_or_404(db, user_id, session_id)
        had_runtime_activity = self._has_runtime_activity(db, user_id, session)
        market_data = self.market_data_for_session(session)
        if not had_runtime_activity:
            if payload.steps <= 1:
                next_offset = session.current_offset + 1
                if session.end_offset is not None and next_offset > session.end_offset:
                    session.status = "COMPLETE"
                else:
                    candle = market_data.get_candle(next_offset)
                    if candle is None:
                        session.status = "COMPLETE"
                    else:
                        session.current_offset = next_offset
                db.commit()
                return self._build_replay_update(
                    db,
                    user_id,
                    session,
                    include_history=False,
                    include_metrics=False,
                )
            metadata = market_data.get_metadata()
            max_offset = max(metadata.rows - 1, 0)
            if session.end_offset is not None:
                max_offset = min(max_offset, session.end_offset)
            target_offset = min(session.current_offset + payload.steps, max_offset)
            session.current_offset = max(session.start_offset, target_offset)
            if session.current_offset >= max_offset:
                session.status = "COMPLETE"
            db.commit()
            return self._build_replay_update(
                db,
                user_id,
                session,
                include_history=False,
                include_metrics=False,
            )
        for _ in range(payload.steps):
            next_offset = session.current_offset + 1
            if session.end_offset is not None and next_offset > session.end_offset:
                session.status = "COMPLETE"
                break
            candle = market_data.get_candle(next_offset)
            if candle is None:
                session.status = "COMPLETE"
                break
            session.current_offset = next_offset
            if had_runtime_activity:
                self._process_candle(db, user_id, session, candle)
        if had_runtime_activity:
            refresh_session_summary(db, user_id, session.id)
        db.commit()
        return self._build_replay_update(
            db,
            user_id,
            session,
            include_history=had_runtime_activity,
            include_metrics=had_runtime_activity,
        )

    def jump(
        self,
        db: Session,
        user_id: int,
        session_id: int,
        payload: BacktestJumpRequest,
    ) -> BacktestState:
        session = self._session_or_404(db, user_id, session_id)
        market_data = self.market_data_for_session(session)
        target_offset = payload.offset
        if payload.timestamp is not None:
            target_offset = market_data.find_offset_at_or_after(payload.timestamp)
        if target_offset is None:
            raise HTTPException(status_code=404, detail="Requested candle not found")
        if target_offset < session.start_offset:
            target_offset = session.start_offset
        if session.end_offset is not None and target_offset > session.end_offset:
            target_offset = session.end_offset

        position = self._position(db, user_id, session)
        pending = self._pending_orders(db, user_id, session.id)
        if target_offset > session.current_offset and (
            (position and position.quantity > 0) or pending
        ):
            distance = target_offset - session.current_offset
            if distance > 5000:
                raise HTTPException(
                    status_code=409,
                    detail="Cannot process more than 5000 candles while orders or a position are active",
                )
            for _ in range(distance):
                candle = market_data.get_candle(session.current_offset + 1)
                if candle is None:
                    break
                session.current_offset += 1
                self._process_candle(db, user_id, session, candle)
        else:
            session.current_offset = target_offset
        refresh_session_summary(db, user_id, session.id)
        db.commit()
        return self.get_state(db, user_id, session.id)

    def list_trades(
        self,
        db: Session,
        user_id: int,
        session_id: int | None = None,
        offset: int = 0,
        limit: int = 500,
        cursor: tuple[datetime, int] | None = None,
    ) -> list[TradeRead]:
        query = (
            select(Trade)
            .where(Trade.user_id == user_id)
            .order_by(desc(Trade.entry_time), desc(Trade.id))
        )
        if session_id is not None:
            query = query.where(Trade.session_id == session_id)
        if cursor is not None:
            cursor_entry_time, cursor_id = cursor
            query = query.where(
                or_(
                    Trade.entry_time < cursor_entry_time,
                    and_(
                        Trade.entry_time == cursor_entry_time,
                        Trade.id < cursor_id,
                    ),
                )
            )
        else:
            query = query.offset(offset)
        query = query.limit(limit)
        return [to_trade_read(trade) for trade in db.scalars(query).all()]

    def update_journal(
        self,
        db: Session,
        user_id: int,
        trade_id: int,
        payload: JournalUpdate,
    ) -> TradeRead:
        trade = db.scalar(
            select(Trade).where(
                Trade.user_id == user_id,
                Trade.id == trade_id,
            )
        )
        if trade is None:
            raise HTTPException(status_code=404, detail="Trade not found")
        trade.notes = payload.notes
        trade.mistake_tags = json.dumps(payload.mistake_tags)
        trade.strategy_name = payload.strategy_name
        trade.emotional_state = payload.emotional_state
        trade.screenshot_url = payload.screenshot_url
        fee_changed = (
            payload.commission_mode is not None
            or payload.commission_value is not None
            or payload.commission_amount is not None
            or payload.fee_mode is not None
            or payload.fee_value is not None
            or payload.fee_amount is not None
        )
        if payload.commission_mode is not None:
            trade.commission_mode = _normalize_commission_mode(payload.commission_mode)
        if payload.commission_value is not None:
            trade.commission_value = _commission_value(trade.commission_mode, payload.commission_value)
        if payload.fee_mode is not None:
            trade.fee_mode = _normalize_commission_mode(payload.fee_mode)
        if payload.fee_value is not None:
            trade.fee_value = _commission_value(trade.fee_mode, payload.fee_value)
        if fee_changed:
            session = self._session_or_404(db, user_id, trade.session_id)
            previous_net_pnl = trade.realized_pnl or 0.0
            gross_pnl = self._trade_gross_pnl(trade)
            trade.gross_pnl = gross_pnl
            if payload.commission_amount is not None:
                trade.commission_amount = max(payload.commission_amount, 0.0)
            else:
                trade.commission_amount = self._commission_for_trade(session, trade)
            if _normalize_commission_mode(trade.commission_mode) == "NONE":
                trade.commission_value = 0.0
                trade.commission_amount = 0.0
            if payload.fee_amount is not None:
                trade.fee_amount = max(payload.fee_amount, 0.0)
            else:
                trade.fee_amount = self._fee_for_trade(session, trade)
            if _normalize_commission_mode(trade.fee_mode) == "NONE":
                trade.fee_value = 0.0
                trade.fee_amount = 0.0
            if trade.status == "CLOSED":
                trade.realized_pnl = gross_pnl - self._trade_costs(trade)
                session.realized_pnl += trade.realized_pnl - previous_net_pnl
                trade.r_multiple = self._trade_r_multiple(session, trade)
        db.add(
            TradeNote(
                user_id=user_id,
                trade_id=trade.id,
                notes=payload.notes,
                mistake_tags=json.dumps(payload.mistake_tags),
                emotional_state=payload.emotional_state,
                screenshot_url=payload.screenshot_url,
            )
        )
        refresh_session_summary(db, user_id, trade.session_id)
        db.commit()
        db.refresh(trade)
        return to_trade_read(trade)

    def update_trade_strategy(
        self,
        db: Session,
        user_id: int,
        trade_id: int,
        payload: TradeStrategyUpdate,
    ) -> TradeRead:
        trade = db.scalar(
            select(Trade).where(
                Trade.user_id == user_id,
                Trade.id == trade_id,
            )
        )
        if trade is None:
            raise HTTPException(status_code=404, detail="Trade not found")
        strategy_name = payload.strategy_name.strip() if isinstance(payload.strategy_name, str) else None
        trade.strategy_name = strategy_name or None
        refresh_session_summary(db, user_id, trade.session_id)
        db.commit()
        db.refresh(trade)
        return to_trade_read(trade)

    def list_playbooks(self, db: Session, user_id: int) -> list[PlaybookRead]:
        playbooks = db.scalars(
            select(Playbook)
            .where(Playbook.user_id == user_id)
            .order_by(asc(Playbook.name))
        ).all()
        return [PlaybookRead.model_validate(playbook) for playbook in playbooks]

    def create_playbook(self, db: Session, user_id: int, payload: PlaybookCreate) -> PlaybookRead:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Playbook name is required")
        existing = db.scalar(
            select(Playbook).where(
                Playbook.user_id == user_id,
                Playbook.name == name,
            )
        )
        if existing is not None:
            return PlaybookRead.model_validate(existing)
        playbook = Playbook(
            user_id=user_id,
            name=name,
            description=payload.description,
            rules=payload.rules,
        )
        db.add(playbook)
        db.commit()
        db.refresh(playbook)
        return PlaybookRead.model_validate(playbook)

    def update_playbook(
        self,
        db: Session,
        user_id: int,
        playbook_id: int,
        payload: PlaybookUpdate,
    ) -> PlaybookRead:
        playbook = self._playbook_or_404(db, user_id, playbook_id)
        if playbook is None:
            raise HTTPException(status_code=404, detail="Playbook not found")

        if "name" in payload.model_fields_set and payload.name is not None:
            name = payload.name.strip()
            if not name:
                raise HTTPException(status_code=422, detail="Playbook name is required")
            existing = db.scalar(
                select(Playbook).where(
                    Playbook.user_id == user_id,
                    Playbook.name == name,
                    Playbook.id != playbook_id,
                )
            )
            if existing is not None:
                raise HTTPException(status_code=409, detail="Playbook name already exists")
            playbook.name = name
        if "description" in payload.model_fields_set:
            playbook.description = payload.description
        if "rules" in payload.model_fields_set:
            playbook.rules = payload.rules

        db.commit()
        db.refresh(playbook)
        return PlaybookRead.model_validate(playbook)

    def delete_playbook(self, db: Session, user_id: int, playbook_id: int) -> None:
        playbook = self._playbook_or_404(db, user_id, playbook_id)
        if playbook is None:
            raise HTTPException(status_code=404, detail="Playbook not found")

        for model in (BacktestSession, Position, Order, Trade):
            db.query(model).filter(
                model.user_id == user_id,
                model.playbook_id == playbook_id,
            ).update(
                {model.playbook_id: None},
                synchronize_session=False,
            )
        db.delete(playbook)
        db.commit()

    def list_sessions(
        self,
        db: Session,
        user_id: int,
        offset: int = 0,
        limit: int | None = None,
    ) -> list[BacktestSession]:
        query = (
            select(BacktestSession)
            .where(BacktestSession.user_id == user_id)
            .order_by(desc(BacktestSession.created_at), desc(BacktestSession.id))
        )
        if offset > 0:
            query = query.offset(offset)
        if limit is not None:
            query = query.limit(limit)
        return list(db.scalars(query).all())

    def list_listable_sessions(
        self,
        db: Session,
        user_id: int,
        offset: int = 0,
        limit: int | None = None,
        cursor: tuple[datetime, int] | None = None,
        status: str | None = None,
    ) -> list[BacktestSession]:
        if self.dataset_catalog is not None:
            self.dataset_catalog.discover_catalog(db, user_id)
        query = (
            select(BacktestSession)
            .where(
                BacktestSession.user_id == user_id,
                self._listable_session_clause(),
            )
            .order_by(desc(BacktestSession.created_at), desc(BacktestSession.id))
        )
        if status in {"ACTIVE", "COMPLETE"}:
            query = query.where(BacktestSession.status == status)
        if cursor is not None:
            cursor_created_at, cursor_id = cursor
            query = query.where(
                or_(
                    BacktestSession.created_at < cursor_created_at,
                    and_(
                        BacktestSession.created_at == cursor_created_at,
                        BacktestSession.id < cursor_id,
                    ),
                )
            )
        elif offset > 0:
            query = query.offset(offset)
        if limit is not None:
            query = query.limit(limit)
        return list(db.scalars(query).all())

    def list_replay_ready_sessions(
        self,
        db: Session,
        user_id: int,
        offset: int = 0,
        limit: int | None = None,
    ) -> list[BacktestSession]:
        if self.dataset_catalog is not None:
            self.dataset_catalog.discover_catalog(db, user_id)
        query = (
            select(BacktestSession)
            .where(
                BacktestSession.user_id == user_id,
                self._replay_ready_session_clause(),
            )
            .order_by(desc(BacktestSession.created_at), desc(BacktestSession.id))
        )
        if offset > 0:
            query = query.offset(offset)
        if limit is not None:
            query = query.limit(limit)
        return list(db.scalars(query).all())

    def update_session(
        self,
        db: Session,
        user_id: int,
        session_id: int,
        payload: BacktestSessionUpdate,
    ) -> BacktestSession:
        session = self._session_or_404(db, user_id, session_id)
        values = payload.model_dump(exclude_unset=True)
        if not values:
            return session

        if "name" in values:
            name = (values["name"] or "").strip()
            if not name:
                raise HTTPException(status_code=400, detail="Session name is required")
            values["name"] = name

        for field in ("strategy_name", "currency", "timezone"):
            if field in values and isinstance(values[field], str):
                values[field] = values[field].strip() or None

        if "default_commission_mode" in values:
            values["default_commission_mode"] = _normalize_commission_mode(
                values["default_commission_mode"]
            )
        if "default_commission_value" in values:
            values["default_commission_value"] = _commission_value(
                values.get("default_commission_mode", session.default_commission_mode),
                values["default_commission_value"],
            )
        elif values.get("default_commission_mode") == "NONE":
            values["default_commission_value"] = 0.0

        if "default_fee_mode" in values:
            values["default_fee_mode"] = _normalize_commission_mode(values["default_fee_mode"])
        if "default_fee_value" in values:
            values["default_fee_value"] = _commission_value(
                values.get("default_fee_mode", session.default_fee_mode),
                values["default_fee_value"],
            )
        elif values.get("default_fee_mode") == "NONE":
            values["default_fee_value"] = 0.0

        playbook_id = values.get("playbook_id")
        if playbook_id is not None:
            self._playbook_or_404(db, user_id, playbook_id)

        for field, value in values.items():
            setattr(session, field, value)

        db.commit()
        db.refresh(session)
        return session

    def delete_session(self, db: Session, user_id: int, session_id: int) -> None:
        session = self._session_or_404(db, user_id, session_id)
        db.delete(session)
        db.commit()

    def _process_candle(self, db: Session, user_id: int, session: BacktestSession, candle: Candle) -> None:
        self._process_position_brackets(db, user_id, session, candle)
        for order in self._pending_orders(db, user_id, session.id):
            trigger_price = self._trigger_price(order, candle)
            if trigger_price is not None:
                self._fill_order(db, user_id, session, order, candle, trigger_price)
                self._process_position_brackets(db, user_id, session, candle)

    def _process_position_brackets(
        self,
        db: Session,
        user_id: int,
        session: BacktestSession,
        candle: Candle,
    ) -> None:
        position = self._position(db, user_id, session)
        if position is None or position.quantity <= 0 or position.side == "FLAT":
            return

        stop_hit = self._stop_hit(position, candle)
        target_hit = self._target_hit(position, candle)
        if stop_hit:
            self._execute_reduce_only(
                db=db,
                user_id=user_id,
                session=session,
                side="SELL" if position.side == "LONG" else "BUY",
                quantity=position.quantity,
                price=position.stop_loss,
                candle=candle,
                order=None,
            )
            return

        self._maybe_move_stop_to_breakeven(position, candle)
        if self._stop_hit(position, candle):
            self._execute_reduce_only(
                db=db,
                user_id=user_id,
                session=session,
                side="SELL" if position.side == "LONG" else "BUY",
                quantity=position.quantity,
                price=position.stop_loss,
                candle=candle,
                order=None,
            )
            return

        if target_hit:
            self._execute_reduce_only(
                db=db,
                user_id=user_id,
                session=session,
                side="SELL" if position.side == "LONG" else "BUY",
                quantity=position.quantity,
                price=position.take_profit,
                candle=candle,
                order=None,
            )

    def _fill_order(
        self,
        db: Session,
        user_id: int,
        session: BacktestSession,
        order: Order,
        candle: Candle,
        price: float,
    ) -> None:
        quantity = order.quantity
        if quantity is None or quantity <= 0:
            quantity = self._resolve_quantity_from_order(db, session, order, price)
            order.quantity = quantity
        if quantity <= 0:
            raise HTTPException(status_code=400, detail="quantity must be greater than zero")
        if order.reduce_only:
            self._execute_reduce_only(db, user_id, session, order.side, quantity, price, candle, order)
        else:
            self._execute_position_change(db, user_id, session, order, candle, price, quantity)
        order.status = FILLED_ORDER
        order.filled_offset = candle.time_offset if hasattr(candle, "time_offset") else session.current_offset
        order.filled_price = price
        order.filled_at = candle.timestamp

    def _execute_reduce_only(
        self,
        db: Session,
        user_id: int,
        session: BacktestSession,
        side: str,
        quantity: float,
        price: float | None,
        candle: Candle,
        order: Order | None,
    ) -> None:
        if price is None:
            return
        position = self._position(db, user_id, session)
        if position is None or position.quantity <= 0:
            return
        if position.side == "LONG" and side != "SELL":
            return
        if position.side == "SHORT" and side != "BUY":
            return
        temp_order = order or Order(
            user_id=user_id,
            session_id=session.id,
            side=side,
            order_type="MARKET",
            quantity=min(quantity, position.quantity),
            reduce_only=True,
            created_offset=session.current_offset,
        )
        self._execute_position_change(
            db,
            user_id,
            session,
            temp_order,
            candle,
            price,
            min(quantity, position.quantity),
        )

    def _execute_position_change(
        self,
        db: Session,
        user_id: int,
        session: BacktestSession,
        order: Order,
        candle: Candle,
        price: float,
        quantity: float,
    ) -> None:
        position = self._position(db, user_id, session)
        if position is None:
            position = Position(user_id=user_id, session_id=session.id)
            db.add(position)
            db.flush()

        incoming_side = "LONG" if order.side == "BUY" else "SHORT"
        realized = 0.0

        if position.quantity <= 0 or position.side == "FLAT":
            self._open_position(db, user_id, session, position, order, candle, price, quantity)
        elif position.side == incoming_side:
            self._scale_position(db, user_id, session, position, order, price, quantity)
        else:
            exit_quantity = min(quantity, position.quantity)
            realized = self._close_quantity(
                db,
                user_id,
                session,
                position,
                order,
                candle,
                price,
                exit_quantity,
            )
            remainder = quantity - exit_quantity
            if remainder > 0 and not order.reduce_only:
                self._open_position(db, user_id, session, position, order, candle, price, remainder)

        session.realized_pnl += realized
        execution = Execution(
            user_id=user_id,
            session_id=session.id,
            order_id=order.id,
            side=order.side,
            timestamp=candle.timestamp,
            offset=session.current_offset,
            price=price,
            quantity=quantity,
            realized_pnl=realized,
            position_side_after=position.side,
            position_quantity_after=position.quantity,
        )
        db.add(execution)

    def _open_position(
        self,
        db: Session,
        user_id: int,
        session: BacktestSession,
        position: Position,
        order: Order,
        candle: Candle,
        price: float,
        quantity: float,
    ) -> None:
        position.side = "LONG" if order.side == "BUY" else "SHORT"
        position.quantity = quantity
        position.avg_price = price
        position.stop_loss = order.stop_loss
        position.take_profit = order.take_profit
        position.breakeven_trigger_r = order.breakeven_trigger_r
        position.breakeven_moved = False
        position.strategy_name = order.strategy_name
        position.playbook_id = order.playbook_id

        db.add(
            Trade(
                user_id=user_id,
                session_id=session.id,
                playbook_id=order.playbook_id,
                status="OPEN",
                side=position.side,
                entry_time=candle.timestamp,
                entry_offset=session.current_offset,
                entry_price=price,
                quantity=quantity,
                remaining_quantity=quantity,
                stop_loss=order.stop_loss,
                take_profit=order.take_profit,
                commission_mode=_normalize_commission_mode(order.commission_mode),
                commission_value=_commission_value(order.commission_mode, order.commission_value),
                fee_mode=_normalize_commission_mode(order.fee_mode),
                fee_value=_commission_value(order.fee_mode, order.fee_value),
                strategy_name=order.strategy_name,
                notes=order.notes,
                mistake_tags=order.mistake_tags,
            )
        )

    def _scale_position(
        self,
        db: Session,
        user_id: int,
        session: BacktestSession,
        position: Position,
        order: Order,
        price: float,
        quantity: float,
    ) -> None:
        total = position.quantity + quantity
        position.avg_price = ((position.avg_price * position.quantity) + (price * quantity)) / total
        position.quantity = total
        position.stop_loss = order.stop_loss if order.stop_loss is not None else position.stop_loss
        position.take_profit = order.take_profit if order.take_profit is not None else position.take_profit
        position.breakeven_trigger_r = (
            order.breakeven_trigger_r
            if order.breakeven_trigger_r is not None
            else position.breakeven_trigger_r
        )
        position.strategy_name = order.strategy_name or position.strategy_name
        position.playbook_id = order.playbook_id or position.playbook_id

        trade = self._open_trade_for_position(db, user_id, session.id, position.side)
        if trade:
            trade.entry_price = position.avg_price
            trade.quantity += quantity
            trade.remaining_quantity += quantity
            trade.stop_loss = position.stop_loss
            trade.take_profit = position.take_profit
            order_commission_mode = _normalize_commission_mode(order.commission_mode)
            if _normalize_commission_mode(trade.commission_mode) == "NONE" and order_commission_mode != "NONE":
                trade.commission_mode = order_commission_mode
                trade.commission_value = _commission_value(order_commission_mode, order.commission_value)
            order_fee_mode = _normalize_commission_mode(order.fee_mode)
            if _normalize_commission_mode(trade.fee_mode) == "NONE" and order_fee_mode != "NONE":
                trade.fee_mode = order_fee_mode
                trade.fee_value = _commission_value(order_fee_mode, order.fee_value)

    def _close_quantity(
        self,
        db: Session,
        user_id: int,
        session: BacktestSession,
        position: Position,
        order: Order,
        candle: Candle,
        price: float,
        quantity: float,
    ) -> float:
        gross_realized = self._price_pnl(session, position.avg_price, price, quantity, position.side)
        realized = gross_realized
        trade = self._open_trade_for_position(db, user_id, session.id, position.side)
        if trade:
            commission_amount = self._commission_for_close(session, trade, price, quantity)
            fee_amount = self._fee_for_close(session, trade, price, quantity)
            realized = gross_realized - commission_amount - fee_amount
            trade.gross_pnl = self._trade_gross_pnl(trade) + gross_realized
            trade.commission_amount = (trade.commission_amount or 0.0) + commission_amount
            trade.fee_amount = (trade.fee_amount or 0.0) + fee_amount
            trade.realized_pnl += realized
            trade.remaining_quantity = max(trade.remaining_quantity - quantity, 0.0)
            trade.exit_time = candle.timestamp
            trade.exit_offset = session.current_offset
            trade.exit_price = price
            trade.r_multiple = self._trade_r_multiple(session, trade)
            if trade.remaining_quantity <= 1e-9:
                trade.status = "CLOSED"

        position.quantity = max(position.quantity - quantity, 0.0)
        if position.quantity <= 1e-9:
            position.side = "FLAT"
            position.quantity = 0.0
            position.avg_price = 0.0
            position.stop_loss = None
            position.take_profit = None
            position.breakeven_trigger_r = None
            position.breakeven_moved = False
            position.strategy_name = None
            position.playbook_id = None
        return realized

    def _commission_for_close(
        self,
        session: BacktestSession,
        trade: Trade,
        exit_price: float,
        quantity: float,
    ) -> float:
        mode = _normalize_commission_mode(trade.commission_mode)
        value = _commission_value(mode, trade.commission_value)
        if mode == "NONE" or value <= 0 or quantity <= 0:
            return 0.0
        if mode == "FIXED":
            total_quantity = trade.quantity if trade.quantity > 0 else quantity
            return value * min(max(quantity / total_quantity, 0.0), 1.0)
        return self._percent_commission(session, trade.entry_price, exit_price, quantity, value)

    def _commission_for_trade(self, session: BacktestSession, trade: Trade) -> float:
        mode = _normalize_commission_mode(trade.commission_mode)
        value = _commission_value(mode, trade.commission_value)
        if mode == "NONE" or value <= 0 or trade.exit_price is None:
            return 0.0
        if mode == "FIXED":
            return value
        return self._percent_commission(
            session,
            trade.entry_price,
            trade.exit_price,
            trade.quantity,
            value,
        )

    def _fee_for_close(
        self,
        session: BacktestSession,
        trade: Trade,
        exit_price: float,
        quantity: float,
    ) -> float:
        mode = _normalize_commission_mode(trade.fee_mode)
        value = _commission_value(mode, trade.fee_value)
        if mode == "NONE" or value <= 0 or quantity <= 0:
            return 0.0
        if mode == "FIXED":
            total_quantity = trade.quantity if trade.quantity > 0 else quantity
            return value * min(max(quantity / total_quantity, 0.0), 1.0)
        return self._percent_commission(session, trade.entry_price, exit_price, quantity, value)

    def _fee_for_trade(self, session: BacktestSession, trade: Trade) -> float:
        mode = _normalize_commission_mode(trade.fee_mode)
        value = _commission_value(mode, trade.fee_value)
        if mode == "NONE" or value <= 0 or trade.exit_price is None:
            return 0.0
        if mode == "FIXED":
            return value
        return self._percent_commission(
            session,
            trade.entry_price,
            trade.exit_price,
            trade.quantity,
            value,
        )

    def _trade_costs(self, trade: Trade) -> float:
        return (trade.commission_amount or 0.0) + (trade.fee_amount or 0.0)

    def _percent_commission(
        self,
        session: BacktestSession,
        entry_price: float,
        exit_price: float,
        quantity: float,
        percent: float,
    ) -> float:
        notional = abs(entry_price * quantity * self._pnl_multiplier(session))
        notional += abs(exit_price * quantity * self._pnl_multiplier(session))
        return notional * (percent / 100)

    def _trade_gross_pnl(self, trade: Trade) -> float:
        if trade.gross_pnl is not None:
            return trade.gross_pnl
        return (trade.realized_pnl or 0.0) + self._trade_costs(trade)

    def _price_pnl(
        self,
        session: BacktestSession,
        entry_price: float,
        exit_price: float,
        quantity: float,
        side: str,
    ) -> float:
        raw = (
            (exit_price - entry_price) * quantity
            if side == "LONG"
            else (entry_price - exit_price) * quantity
        )
        return raw * self._pnl_multiplier(session)

    def _pnl_multiplier(self, session: BacktestSession) -> float:
        multiplier = session.pnl_multiplier or 1.0
        return multiplier if multiplier > 0 else 1.0

    def _price_risk_value(
        self,
        session: BacktestSession,
        entry_price: float,
        stop_loss: float,
        quantity: float,
    ) -> float:
        return abs(entry_price - stop_loss) * quantity * self._pnl_multiplier(session)

    def _price_risk_per_unit(
        self,
        session: BacktestSession,
        entry_price: float,
        stop_loss: float,
    ) -> float:
        return abs(entry_price - stop_loss) * self._pnl_multiplier(session)

    def _trigger_price(self, order: Order, candle: Candle) -> float | None:
        if order.status != OPEN_ORDER:
            return None
        if order.order_type == "LIMIT":
            if order.side == "BUY" and order.limit_price is not None and candle.low <= order.limit_price:
                return order.limit_price
            if order.side == "SELL" and order.limit_price is not None and candle.high >= order.limit_price:
                return order.limit_price
        if order.order_type == "STOP":
            if order.side == "BUY" and order.stop_price is not None and candle.high >= order.stop_price:
                return order.stop_price
            if order.side == "SELL" and order.stop_price is not None and candle.low <= order.stop_price:
                return order.stop_price
        return None

    def _stop_hit(self, position: Position, candle: Candle) -> bool:
        if position.stop_loss is None:
            return False
        if position.side == "LONG":
            return candle.low <= position.stop_loss
        if position.side == "SHORT":
            return candle.high >= position.stop_loss
        return False

    def _target_hit(self, position: Position, candle: Candle) -> bool:
        if position.take_profit is None:
            return False
        if position.side == "LONG":
            return candle.high >= position.take_profit
        if position.side == "SHORT":
            return candle.low <= position.take_profit
        return False

    def _maybe_move_stop_to_breakeven(self, position: Position, candle: Candle) -> None:
        if (
            position.breakeven_moved
            or position.breakeven_trigger_r is None
            or position.stop_loss is None
            or position.quantity <= 0
        ):
            return
        risk = self._position_risk(position)
        if risk is None:
            return
        if position.side == "LONG":
            trigger = position.avg_price + risk * position.breakeven_trigger_r
            if candle.high >= trigger:
                position.stop_loss = position.avg_price
                position.breakeven_moved = True
        if position.side == "SHORT":
            trigger = position.avg_price - risk * position.breakeven_trigger_r
            if candle.low <= trigger:
                position.stop_loss = position.avg_price
                position.breakeven_moved = True

    def _resolve_quantity(
        self,
        db: Session,
        session: BacktestSession,
        payload: OrderCreate,
        reference_price: float,
    ) -> float:
        if payload.quantity is not None:
            if payload.quantity <= 0:
                raise HTTPException(status_code=400, detail="quantity must be greater than zero")
            return payload.quantity
        if payload.risk_percent is None or payload.stop_loss is None:
            raise HTTPException(status_code=400, detail="quantity or risk_percent is required")
        equity = self._risk_sizing_equity(session, payload.risk_base or "CURRENT_BALANCE")
        risk_amount = equity * (payload.risk_percent / 100)
        risk_per_unit = self._price_risk_per_unit(session, reference_price, payload.stop_loss)
        if risk_per_unit <= 0:
            raise HTTPException(status_code=400, detail="stop_loss must differ from entry price")
        return risk_amount / risk_per_unit

    def _resolve_quantity_from_order(
        self,
        db: Session,
        session: BacktestSession,
        order: Order,
        price: float,
    ) -> float:
        if order.quantity is not None and order.quantity > 0:
            return order.quantity
        if order.risk_percent is None or order.stop_loss is None:
            raise HTTPException(status_code=400, detail="quantity or risk_percent is required")
        equity = self._risk_sizing_equity(session)
        risk_amount = equity * (order.risk_percent / 100)
        risk_per_unit = self._price_risk_per_unit(session, price, order.stop_loss)
        if risk_per_unit <= 0:
            raise HTTPException(status_code=400, detail="stop_loss must differ from entry price")
        return risk_amount / risk_per_unit

    def _risk_sizing_equity(
        self,
        session: BacktestSession,
        risk_base: str = "CURRENT_BALANCE",
    ) -> float:
        equity = (
            session.initial_balance
            if risk_base == "INITIAL_BALANCE"
            else session.initial_balance + session.realized_pnl
        )
        if equity > 0:
            return equity
        return session.initial_balance

    def _repair_negative_open_position(self, db: Session, user_id: int, session: BacktestSession) -> None:
        position = self._position(db, user_id, session)
        if position is None or position.side == "FLAT" or position.quantity >= 0:
            return

        original_offset = session.current_offset
        position.quantity = abs(position.quantity)
        for order in db.scalars(
            select(Order).where(
                Order.user_id == user_id,
                Order.session_id == session.id,
            )
        ):
            if order.quantity is not None and order.quantity < 0:
                order.quantity = abs(order.quantity)
        for execution in db.scalars(
            select(Execution).where(
                Execution.user_id == user_id,
                Execution.session_id == session.id,
            )
        ):
            if execution.quantity < 0:
                execution.quantity = abs(execution.quantity)
            if execution.position_quantity_after < 0:
                execution.position_quantity_after = abs(execution.position_quantity_after)
        for trade in db.scalars(
            select(Trade).where(
                Trade.user_id == user_id,
                Trade.session_id == session.id,
                Trade.status == "OPEN",
            )
        ):
            if trade.quantity < 0:
                trade.quantity = abs(trade.quantity)
            if trade.remaining_quantity < 0:
                trade.remaining_quantity = abs(trade.remaining_quantity)

        open_trade = self._open_trade_for_position(db, user_id, session.id, position.side)
        if open_trade is None:
            db.commit()
            return

        market_data = self.market_data_for_session(session)
        start_offset = max(open_trade.entry_offset + 1, session.start_offset)
        for offset in range(start_offset, original_offset + 1):
            candle = market_data.get_candle(offset)
            if candle is None:
                break
            session.current_offset = offset
            self._process_position_brackets(db, user_id, session, candle)
            if position.side == "FLAT" or position.quantity <= 0:
                break
        session.current_offset = original_offset
        db.commit()

    def _position_risk(self, position: Position) -> float | None:
        if position.stop_loss is None:
            return None
        risk = (
            position.avg_price - position.stop_loss
            if position.side == "LONG"
            else position.stop_loss - position.avg_price
        )
        return risk if risk > 0 else None

    def _trade_r_multiple(self, session: BacktestSession, trade: Trade) -> float | None:
        if trade.stop_loss is None or trade.quantity <= 0:
            return None
        risk = self._price_risk_value(session, trade.entry_price, trade.stop_loss, trade.quantity)
        if risk <= 0:
            return None
        return trade.realized_pnl / risk

    def _position_read(
        self,
        db: Session,
        user_id: int,
        session: BacktestSession,
        candle: Candle | None,
    ) -> PositionRead | None:
        position = self._position(db, user_id, session)
        if position is None:
            return None
        unrealized = 0.0
        if candle and position.quantity > 0:
            unrealized = self._price_pnl(
                session,
                position.avg_price,
                candle.close,
                position.quantity,
                position.side,
            )
        return PositionRead(
            id=position.id,
            session_id=position.session_id,
            side=position.side,
            quantity=position.quantity,
            avg_price=position.avg_price,
            stop_loss=position.stop_loss,
            take_profit=position.take_profit,
            breakeven_trigger_r=position.breakeven_trigger_r,
            breakeven_moved=position.breakeven_moved,
            strategy_name=position.strategy_name,
            playbook_id=position.playbook_id,
            unrealized_pnl=unrealized,
        )

    def _session_or_404(self, db: Session, user_id: int, session_id: int) -> BacktestSession:
        session = db.scalar(
            select(BacktestSession).where(
                BacktestSession.user_id == user_id,
                BacktestSession.id == session_id,
            )
        )
        if session is None:
            raise HTTPException(status_code=404, detail="Backtest session not found")
        return session

    def get_session(self, db: Session, user_id: int, session_id: int) -> BacktestSession:
        return self._session_or_404(db, user_id, session_id)

    def session_has_replay_data(self, session: BacktestSession) -> bool:
        return bool(session.replay_ready)

    def session_is_listable(self, session: BacktestSession) -> bool:
        return session.timeframe == "Imported" or session.replay_ready

    def _replay_ready_session_clause(self):
        filters = [
            BacktestSession.replay_ready.is_(True),
        ]
        if self.market_data is not None:
            filters.append(BacktestSession.csv_path == str(self.market_data.csv_path))
        return or_(*filters)

    def _listable_session_clause(self):
        return or_(
            BacktestSession.timeframe == "Imported",
            self._replay_ready_session_clause(),
        )

    def market_data_for_session(
        self,
        session: BacktestSession,
    ) -> MarketDataService | DatabaseMarketDataService:
        db = object_session(session)
        if (
            db is not None
            and self.dataset_catalog is not None
            and session.dataset_asset_id is not None
            and session.timeframe is not None
            and (
                service := self.market_data_for_dataset_identity(
                    db,
                    session.user_id,
                    asset_id=session.dataset_asset_id,
                    timeframe=session.timeframe,
                    csv_path=session.csv_path,
                    timestamp_timezone=session.timezone or "UTC",
                )
            )
            is not None
        ):
            return service
        if not session.csv_path and self.market_data is None:
            raise FileNotFoundError(
                "Market data is unavailable for this replay session."
            )
        return self.market_data_for_path(
            session.csv_path or str(self.market_data.csv_path),
            session.timezone or "UTC",
            db=db,
            user_id=session.user_id,
        )

    def market_data_for_dataset_identity(
        self,
        db: Session,
        user_id: int,
        *,
        asset_id: int,
        timeframe: str,
        csv_path: str | None,
        timestamp_timezone: str = "UTC",
    ) -> MarketDataService | DatabaseMarketDataService | None:
        if self.dataset_catalog is None:
            return None
        timeframe_row = self.dataset_catalog.stored_timeframe(
            db,
            user_id,
            asset_id=asset_id,
            timeframe=timeframe,
        )
        if timeframe_row is None:
            return None
        if timeframe_row.database_imported:
            cache_key = (
                f"db::{user_id}::{asset_id}::{timeframe_row.timeframe}"
                f"::{timestamp_timezone or 'UTC'}"
            )
            return self._cached_market_data(
                cache_key,
                lambda: DatabaseMarketDataService(
                    self.dataset_catalog.session_factory,
                    self.dataset_catalog.market_data_session_factory,
                    user_id=user_id,
                    asset_id=asset_id,
                    timeframe=timeframe_row.timeframe,
                    csv_path=timeframe_row.csv_path or (csv_path or ""),
                    timestamp_timezone=timestamp_timezone or "UTC",
                ),
            )
        resolved_csv_path = timeframe_row.csv_path or csv_path
        if not resolved_csv_path:
            return None
        return self.market_data_for_path(
            resolved_csv_path,
            timestamp_timezone,
            db=db,
            user_id=user_id,
        )

    def validate_csv_path(self, csv_path: str) -> Path:
        if not isinstance(csv_path, str) or not csv_path.strip():
            raise ValueError("Dataset CSV path is invalid")
        try:
            path = Path(csv_path).expanduser().resolve(strict=False)
            legacy = self.market_data.csv_path.expanduser().resolve(strict=False) if self.market_data is not None else None
            root = self.dataset_catalog.default_root.expanduser().resolve(strict=False) if self.dataset_catalog is not None else None
        except (OSError, RuntimeError, ValueError) as exc:
            raise ValueError("Dataset CSV path is invalid") from exc
        if path == legacy or (root is not None and path.is_relative_to(root)):
            return path
        # A standalone registry without configured sources remains a local file
        # utility. HTTP routes always configure the dataset catalog.
        if root is None and legacy is None:
            return path
        raise ValueError("Dataset CSV path must stay within the configured dataset directory")

    def market_data_for_path(
        self,
        csv_path: str,
        timestamp_timezone: str = "UTC",
        *,
        db: Session | None = None,
        user_id: int | None = None,
    ) -> MarketDataService | DatabaseMarketDataService:
        # Imported session/catalog rows are untrusted; validate before either a
        # catalog lookup or a cached file reader can access the supplied path.
        csv_path = str(self.validate_csv_path(csv_path))
        if db is not None and user_id is not None and self.dataset_catalog is not None:
            try:
                resolution = self.dataset_catalog.resolve_dataset(db, user_id, csv_path=csv_path)
            except FileNotFoundError:
                resolution = None
            if (
                resolution is not None
                and resolution.asset_id is not None
                and resolution.timeframe is not None
                and resolution.database_imported
            ):
                cache_key = (
                    f"db::{user_id}::{resolution.asset_id}::{resolution.timeframe}"
                    f"::{timestamp_timezone or 'UTC'}"
                )
                return self._cached_market_data(
                    cache_key,
                    lambda: DatabaseMarketDataService(
                        self.dataset_catalog.session_factory,
                        self.dataset_catalog.market_data_session_factory,
                        user_id=user_id,
                        asset_id=resolution.asset_id,
                        timeframe=resolution.timeframe,
                        csv_path=str(resolution.csv_path),
                        timestamp_timezone=timestamp_timezone or "UTC",
                    ),
                )

        cache_key = f"{csv_path}::{timestamp_timezone or 'UTC'}"
        return self._cached_market_data(
            cache_key,
            lambda: MarketDataService(
                Path(csv_path),
                cache=(
                    self.market_data is not None
                    and self.market_data.cache
                    and Path(csv_path) == self.market_data.csv_path.expanduser().resolve(strict=False)
                ),
                timestamp_timezone=timestamp_timezone or "UTC",
            ),
        )

    def _order_or_404(self, db: Session, user_id: int, session_id: int, order_id: int) -> Order:
        order = db.scalar(
            select(Order).where(
                Order.user_id == user_id,
                Order.session_id == session_id,
                Order.id == order_id,
            )
        )
        if order is None:
            raise HTTPException(status_code=404, detail="Order not found")
        return order

    def _current_candle_or_404(self, session: BacktestSession) -> Candle:
        candle = self.market_data_for_session(session).get_candle(session.current_offset)
        if candle is None:
            raise HTTPException(status_code=404, detail="Current replay candle not found")
        return candle

    def _position(self, db: Session, user_id: int, session: BacktestSession) -> Position | None:
        position = db.scalar(
            select(Position).where(
                Position.user_id == user_id,
                Position.session_id == session.id,
            )
        )
        if position is None:
            position = Position(user_id=user_id, session_id=session.id)
            db.add(position)
            db.flush()
        return position

    def _has_runtime_activity(self, db: Session, user_id: int, session: BacktestSession) -> bool:
        position = self._position(db, user_id, session)
        if position is not None and position.side != "FLAT" and position.quantity > 0:
            return True
        return bool(self._pending_orders(db, user_id, session.id))

    def _pending_orders(self, db: Session, user_id: int, session_id: int) -> list[Order]:
        return list(
            db.scalars(
                select(Order)
                .where(
                    Order.user_id == user_id,
                    Order.session_id == session_id,
                    Order.status == OPEN_ORDER,
                )
                .order_by(asc(Order.created_at), asc(Order.id))
            ).all()
        )

    def _open_trade_for_position(
        self,
        db: Session,
        user_id: int,
        session_id: int,
        side: str,
    ) -> Trade | None:
        return db.scalar(
            select(Trade)
            .where(
                Trade.user_id == user_id,
                Trade.session_id == session_id,
                Trade.status == "OPEN",
                Trade.side == side,
            )
            .order_by(desc(Trade.id))
            .limit(1)
        )

    def _playbook_or_404(self, db: Session, user_id: int, playbook_id: int) -> Playbook:
        playbook = db.scalar(
            select(Playbook).where(
                Playbook.user_id == user_id,
                Playbook.id == playbook_id,
            )
        )
        if playbook is None:
            raise HTTPException(status_code=404, detail="Playbook not found")
        return playbook


def list_latest_session(db: Session, user_id: int) -> BacktestSession | None:
    return db.scalar(
        select(BacktestSession)
        .where(BacktestSession.user_id == user_id)
        .order_by(desc(BacktestSession.id))
        .limit(1)
    )


def to_order_read(order: Order) -> OrderRead:
    return OrderRead(
        id=order.id,
        session_id=order.session_id,
        playbook_id=order.playbook_id,
        status=order.status,
        side=order.side,
        order_type=order.order_type,
        quantity=order.quantity,
        risk_percent=order.risk_percent,
        limit_price=order.limit_price,
        stop_price=order.stop_price,
        stop_loss=order.stop_loss,
        take_profit=order.take_profit,
        breakeven_trigger_r=order.breakeven_trigger_r,
        reduce_only=order.reduce_only,
        commission_mode=_normalize_commission_mode(order.commission_mode),
        commission_value=_commission_value(order.commission_mode, order.commission_value),
        fee_mode=_normalize_commission_mode(order.fee_mode),
        fee_value=_commission_value(order.fee_mode, order.fee_value),
        strategy_name=order.strategy_name,
        mistake_tags=_decode_tags(order.mistake_tags),
        notes=order.notes,
        created_offset=order.created_offset,
        filled_offset=order.filled_offset,
        filled_price=order.filled_price,
        created_at=order.created_at,
        updated_at=order.updated_at,
        filled_at=order.filled_at,
    )


def to_execution_read(execution: Execution) -> ExecutionRead:
    return ExecutionRead.model_validate(execution)


def to_trade_read(trade: Trade) -> TradeRead:
    return TradeRead(
        id=trade.id,
        session_id=trade.session_id,
        status=trade.status,
        side=trade.side,
        entry_time=trade.entry_time,
        entry_offset=trade.entry_offset,
        entry_price=trade.entry_price,
        quantity=trade.quantity,
        remaining_quantity=trade.remaining_quantity,
        stop_loss=trade.stop_loss,
        take_profit=trade.take_profit,
        exit_time=trade.exit_time,
        exit_offset=trade.exit_offset,
        exit_price=trade.exit_price,
        gross_pnl=trade.gross_pnl
        if trade.gross_pnl is not None
        else (trade.realized_pnl or 0.0) + (trade.commission_amount or 0.0) + (trade.fee_amount or 0.0),
        realized_pnl=trade.realized_pnl,
        r_multiple=trade.r_multiple,
        commission_mode=_normalize_commission_mode(trade.commission_mode),
        commission_value=_commission_value(trade.commission_mode, trade.commission_value),
        commission_amount=trade.commission_amount or 0.0,
        fee_mode=_normalize_commission_mode(trade.fee_mode),
        fee_value=_commission_value(trade.fee_mode, trade.fee_value),
        fee_amount=trade.fee_amount or 0.0,
        strategy_name=trade.strategy_name,
        playbook_id=trade.playbook_id,
        notes=trade.notes,
        mistake_tags=_decode_tags(trade.mistake_tags),
        emotional_state=trade.emotional_state,
        screenshot_url=trade.screenshot_url,
    )


def _decode_tags(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        decoded = json.loads(value)
    except json.JSONDecodeError:
        return []
    return decoded if isinstance(decoded, list) else []


def _normalize_commission_mode(value: str | None) -> str:
    return value if value in {"FIXED", "PERCENT"} else "NONE"


def _commission_value(mode: str | None, value: float | None) -> float:
    if _normalize_commission_mode(mode) == "NONE":
        return 0.0
    if value is None:
        return 0.0
    return max(float(value), 0.0)


def _payload_cost_config(
    payload: OrderCreate,
    mode_field: str,
    value_field: str,
    default_mode: str | None,
    default_value: float | None,
) -> tuple[str, float]:
    fields_set = getattr(payload, "model_fields_set", set())
    if mode_field not in fields_set and value_field not in fields_set:
        mode = default_mode
        value = default_value
    else:
        mode = getattr(payload, mode_field)
        value = getattr(payload, value_field)
    normalized_mode = _normalize_commission_mode(mode)
    return normalized_mode, _commission_value(normalized_mode, value)


def _empty_metrics() -> MetricsResponse:
    return MetricsResponse(
        net_pnl=0.0,
        win_rate=0.0,
        total_trades=0,
        winning_trades=0,
        breakeven_trades=0,
        open_trades=0,
        profit_factor=None,
        gross_pnl=0.0,
        total_commissions=0.0,
        total_fees=0.0,
        max_drawdown=0.0,
        recovery_factor=None,
        sharpe_ratio=None,
        average_r=None,
        average_hold_minutes=None,
        average_win=None,
        average_loss=None,
        expectancy=None,
        best_trade=None,
        worst_trade=None,
        longest_win_streak=0,
        longest_loss_streak=0,
        equity_curve=[],
        strategy_performance=[],
        side_breakdown=[],
        calendar=[],
    )
