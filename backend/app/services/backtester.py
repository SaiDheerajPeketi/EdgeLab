import json
from datetime import datetime
from pathlib import Path
from fastapi import HTTPException
from sqlalchemy import asc, desc, select
from sqlalchemy.orm import Session

from app.models import BacktestSession, Execution, Order, Playbook, Position, Trade, TradeNote
from app.schemas import (
    BacktestAdvanceRequest,
    BacktestCreate,
    BacktestJumpRequest,
    BacktestState,
    Candle,
    ExecutionRead,
    JournalUpdate,
    OrderCreate,
    OrderRead,
    OrderUpdate,
    PlaybookCreate,
    PlaybookRead,
    PositionRead,
    TradeRead,
)
from app.services.datasets import DatasetCatalogService
from app.services.market_data import MarketDataService
from app.services.metrics import get_metrics


OPEN_ORDER = "PENDING"
FILLED_ORDER = "FILLED"
CANCELLED_ORDER = "CANCELLED"


class BacktestService:
    def __init__(
        self,
        market_data: MarketDataService,
        dataset_catalog: DatasetCatalogService | None = None,
    ):
        self.market_data = market_data
        self.dataset_catalog = dataset_catalog
        self._market_data_cache: dict[str, MarketDataService] = {
            str(market_data.csv_path): market_data
        }

    def create_session(self, db: Session, payload: BacktestCreate) -> BacktestState:
        csv_path = self.market_data.csv_path
        instrument = payload.instrument
        timeframe = payload.timeframe
        symbol = payload.symbol
        currency = payload.currency
        timestamp_timezone = payload.timezone
        pnl_multiplier = payload.pnl_multiplier
        stored_market_data = None
        if self.dataset_catalog is not None and (
            payload.csv_path or payload.instrument or payload.timeframe
        ):
            resolution = self.dataset_catalog.resolve_dataset(
                db,
                csv_path=payload.csv_path,
                instrument=payload.instrument,
                timeframe=payload.timeframe,
            )
            csv_path = resolution.csv_path
            instrument = resolution.instrument
            timeframe = resolution.timeframe
            symbol = resolution.symbol
            currency = currency or resolution.currency
            timestamp_timezone = timestamp_timezone or resolution.timezone
            pnl_multiplier = pnl_multiplier or resolution.pnl_multiplier
            if resolution.stored and instrument and timeframe:
                stored_market_data = self.dataset_catalog.market_data_for_dataset(
                    instrument,
                    timeframe,
                )

        market_data = stored_market_data or self.market_data_for_path(
            str(csv_path),
            timestamp_timezone or "UTC",
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

        session = BacktestSession(
            name=payload.name,
            symbol=symbol,
            instrument=instrument,
            timeframe=timeframe,
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
            initial_balance=payload.initial_balance,
        )
        db.add(session)
        db.flush()
        db.add(Position(session_id=session.id))
        db.commit()
        return self.get_state(db, session.id)

    def get_state(self, db: Session, session_id: int) -> BacktestState:
        session = self._session_or_404(db, session_id)
        self._repair_negative_open_position(db, session)
        current_candle = self.market_data_for_session(session).get_candle(session.current_offset)
        return BacktestState(
            session=session,
            current_candle=current_candle,
            position=self._position_read(db, session, current_candle),
            orders=[
                to_order_read(order)
                for order in db.scalars(
                    select(Order)
                    .where(Order.session_id == session.id)
                    .order_by(desc(Order.created_at), desc(Order.id))
                )
            ],
            executions=[
                to_execution_read(execution)
                for execution in db.scalars(
                    select(Execution)
                    .where(Execution.session_id == session.id)
                    .order_by(desc(Execution.timestamp), desc(Execution.id))
                )
            ],
            trades=[
                to_trade_read(trade)
                for trade in db.scalars(
                    select(Trade)
                    .where(Trade.session_id == session.id)
                    .order_by(desc(Trade.entry_time), desc(Trade.id))
                )
            ],
            metrics=get_metrics(db, session.id),
        )

    def place_order(
        self,
        db: Session,
        session_id: int,
        payload: OrderCreate,
    ) -> BacktestState:
        session = self._session_or_404(db, session_id)
        current_candle = self._current_candle_or_404(session)
        quantity = self._resolve_quantity(db, session, payload, current_candle.close)
        order = Order(
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
            strategy_name=payload.strategy_name,
            mistake_tags=json.dumps(payload.mistake_tags),
            notes=payload.notes,
            created_offset=session.current_offset,
        )
        db.add(order)
        db.flush()

        if order.order_type == "MARKET":
            self._fill_order(db, session, order, current_candle, current_candle.close)
        db.commit()
        return self.get_state(db, session.id)

    def update_order(
        self,
        db: Session,
        session_id: int,
        order_id: int,
        payload: OrderUpdate,
    ) -> BacktestState:
        session = self._session_or_404(db, session_id)
        order = self._order_or_404(db, session.id, order_id)
        if order.status != OPEN_ORDER:
            raise HTTPException(status_code=409, detail="Only pending orders can be amended")

        for field in (
            "quantity",
            "limit_price",
            "stop_price",
            "stop_loss",
            "take_profit",
            "breakeven_trigger_r",
            "reduce_only",
            "strategy_name",
            "playbook_id",
            "notes",
        ):
            value = getattr(payload, field)
            if value is not None:
                setattr(order, field, value)
        if payload.mistake_tags is not None:
            order.mistake_tags = json.dumps(payload.mistake_tags)
        db.commit()
        return self.get_state(db, session.id)

    def cancel_order(self, db: Session, session_id: int, order_id: int) -> BacktestState:
        session = self._session_or_404(db, session_id)
        order = self._order_or_404(db, session.id, order_id)
        if order.status != OPEN_ORDER:
            raise HTTPException(status_code=409, detail="Only pending orders can be cancelled")
        order.status = CANCELLED_ORDER
        db.commit()
        return self.get_state(db, session.id)

    def advance(
        self,
        db: Session,
        session_id: int,
        payload: BacktestAdvanceRequest,
    ) -> BacktestState:
        session = self._session_or_404(db, session_id)
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
            self._process_candle(db, session, candle)
        db.commit()
        return self.get_state(db, session.id)

    def jump(
        self,
        db: Session,
        session_id: int,
        payload: BacktestJumpRequest,
    ) -> BacktestState:
        session = self._session_or_404(db, session_id)
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

        position = self._position(db, session)
        pending = self._pending_orders(db, session.id)
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
                self._process_candle(db, session, candle)
        else:
            session.current_offset = target_offset
        db.commit()
        return self.get_state(db, session.id)

    def list_trades(self, db: Session, session_id: int | None = None) -> list[TradeRead]:
        query = select(Trade).order_by(desc(Trade.entry_time), desc(Trade.id))
        if session_id is not None:
            query = query.where(Trade.session_id == session_id)
        return [to_trade_read(trade) for trade in db.scalars(query).all()]

    def update_journal(
        self,
        db: Session,
        trade_id: int,
        payload: JournalUpdate,
    ) -> TradeRead:
        trade = db.scalar(select(Trade).where(Trade.id == trade_id))
        if trade is None:
            raise HTTPException(status_code=404, detail="Trade not found")
        trade.notes = payload.notes
        trade.mistake_tags = json.dumps(payload.mistake_tags)
        trade.strategy_name = payload.strategy_name
        trade.emotional_state = payload.emotional_state
        trade.screenshot_url = payload.screenshot_url
        db.add(
            TradeNote(
                trade_id=trade.id,
                notes=payload.notes,
                mistake_tags=json.dumps(payload.mistake_tags),
                emotional_state=payload.emotional_state,
                screenshot_url=payload.screenshot_url,
            )
        )
        db.commit()
        db.refresh(trade)
        return to_trade_read(trade)

    def list_playbooks(self, db: Session) -> list[PlaybookRead]:
        playbooks = db.scalars(select(Playbook).order_by(asc(Playbook.name))).all()
        return [PlaybookRead.model_validate(playbook) for playbook in playbooks]

    def create_playbook(self, db: Session, payload: PlaybookCreate) -> PlaybookRead:
        existing = db.scalar(select(Playbook).where(Playbook.name == payload.name))
        if existing is not None:
            return PlaybookRead.model_validate(existing)
        playbook = Playbook(
            name=payload.name,
            description=payload.description,
            rules=payload.rules,
        )
        db.add(playbook)
        db.commit()
        db.refresh(playbook)
        return PlaybookRead.model_validate(playbook)

    def list_sessions(self, db: Session) -> list[BacktestSession]:
        return list(
            db.scalars(
                select(BacktestSession).order_by(desc(BacktestSession.created_at), desc(BacktestSession.id))
            ).all()
        )

    def _process_candle(self, db: Session, session: BacktestSession, candle: Candle) -> None:
        self._process_position_brackets(db, session, candle)
        for order in self._pending_orders(db, session.id):
            trigger_price = self._trigger_price(order, candle)
            if trigger_price is not None:
                self._fill_order(db, session, order, candle, trigger_price)
                self._process_position_brackets(db, session, candle)

    def _process_position_brackets(
        self,
        db: Session,
        session: BacktestSession,
        candle: Candle,
    ) -> None:
        position = self._position(db, session)
        if position is None or position.quantity <= 0 or position.side == "FLAT":
            return

        stop_hit = self._stop_hit(position, candle)
        target_hit = self._target_hit(position, candle)
        if stop_hit:
            self._execute_reduce_only(
                db=db,
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
            self._execute_reduce_only(db, session, order.side, quantity, price, candle, order)
        else:
            self._execute_position_change(db, session, order, candle, price, quantity)
        order.status = FILLED_ORDER
        order.filled_offset = candle.time_offset if hasattr(candle, "time_offset") else session.current_offset
        order.filled_price = price
        order.filled_at = candle.timestamp

    def _execute_reduce_only(
        self,
        db: Session,
        session: BacktestSession,
        side: str,
        quantity: float,
        price: float | None,
        candle: Candle,
        order: Order | None,
    ) -> None:
        if price is None:
            return
        position = self._position(db, session)
        if position is None or position.quantity <= 0:
            return
        if position.side == "LONG" and side != "SELL":
            return
        if position.side == "SHORT" and side != "BUY":
            return
        temp_order = order or Order(
            session_id=session.id,
            side=side,
            order_type="MARKET",
            quantity=min(quantity, position.quantity),
            reduce_only=True,
            created_offset=session.current_offset,
        )
        self._execute_position_change(
            db,
            session,
            temp_order,
            candle,
            price,
            min(quantity, position.quantity),
        )

    def _execute_position_change(
        self,
        db: Session,
        session: BacktestSession,
        order: Order,
        candle: Candle,
        price: float,
        quantity: float,
    ) -> None:
        position = self._position(db, session)
        if position is None:
            position = Position(session_id=session.id)
            db.add(position)
            db.flush()

        incoming_side = "LONG" if order.side == "BUY" else "SHORT"
        realized = 0.0

        if position.quantity <= 0 or position.side == "FLAT":
            self._open_position(db, session, position, order, candle, price, quantity)
        elif position.side == incoming_side:
            self._scale_position(db, session, position, order, price, quantity)
        else:
            exit_quantity = min(quantity, position.quantity)
            realized = self._close_quantity(
                db,
                session,
                position,
                order,
                candle,
                price,
                exit_quantity,
            )
            remainder = quantity - exit_quantity
            if remainder > 0 and not order.reduce_only:
                self._open_position(db, session, position, order, candle, price, remainder)

        session.realized_pnl += realized
        execution = Execution(
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
                strategy_name=order.strategy_name,
                notes=order.notes,
                mistake_tags=order.mistake_tags,
            )
        )

    def _scale_position(
        self,
        db: Session,
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

        trade = self._open_trade_for_position(db, session.id, position.side)
        if trade:
            trade.entry_price = position.avg_price
            trade.quantity += quantity
            trade.remaining_quantity += quantity
            trade.stop_loss = position.stop_loss
            trade.take_profit = position.take_profit

    def _close_quantity(
        self,
        db: Session,
        session: BacktestSession,
        position: Position,
        order: Order,
        candle: Candle,
        price: float,
        quantity: float,
    ) -> float:
        realized = self._price_pnl(session, position.avg_price, price, quantity, position.side)
        trade = self._open_trade_for_position(db, session.id, position.side)
        if trade:
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

    def _repair_negative_open_position(self, db: Session, session: BacktestSession) -> None:
        position = self._position(db, session)
        if position is None or position.side == "FLAT" or position.quantity >= 0:
            return

        original_offset = session.current_offset
        position.quantity = abs(position.quantity)
        for order in db.scalars(select(Order).where(Order.session_id == session.id)):
            if order.quantity is not None and order.quantity < 0:
                order.quantity = abs(order.quantity)
        for execution in db.scalars(select(Execution).where(Execution.session_id == session.id)):
            if execution.quantity < 0:
                execution.quantity = abs(execution.quantity)
            if execution.position_quantity_after < 0:
                execution.position_quantity_after = abs(execution.position_quantity_after)
        for trade in db.scalars(
            select(Trade).where(Trade.session_id == session.id, Trade.status == "OPEN")
        ):
            if trade.quantity < 0:
                trade.quantity = abs(trade.quantity)
            if trade.remaining_quantity < 0:
                trade.remaining_quantity = abs(trade.remaining_quantity)

        open_trade = self._open_trade_for_position(db, session.id, position.side)
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
            self._process_position_brackets(db, session, candle)
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
        session: BacktestSession,
        candle: Candle | None,
    ) -> PositionRead | None:
        position = self._position(db, session)
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

    def _session_or_404(self, db: Session, session_id: int) -> BacktestSession:
        session = db.scalar(select(BacktestSession).where(BacktestSession.id == session_id))
        if session is None:
            raise HTTPException(status_code=404, detail="Backtest session not found")
        return session

    def get_session(self, db: Session, session_id: int) -> BacktestSession:
        return self._session_or_404(db, session_id)

    def market_data_for_session(self, session: BacktestSession) -> MarketDataService:
        if self.dataset_catalog is not None:
            stored_market_data = self.dataset_catalog.stored_market_data_for(
                session.instrument,
                session.timeframe,
                session.csv_path,
            )
            if stored_market_data is not None:
                return stored_market_data
        return self.market_data_for_path(
            session.csv_path or str(self.market_data.csv_path),
            session.timezone or "UTC",
        )

    def market_data_for_path(self, csv_path: str, timestamp_timezone: str = "UTC") -> MarketDataService:
        cache_key = f"{csv_path}::{timestamp_timezone or 'UTC'}"
        if cache_key not in self._market_data_cache:
            cache = self.market_data.cache and Path(csv_path) == self.market_data.csv_path
            self._market_data_cache[cache_key] = MarketDataService(
                Path(csv_path),
                cache=cache,
                timestamp_timezone=timestamp_timezone or "UTC",
            )
        return self._market_data_cache[cache_key]

    def _order_or_404(self, db: Session, session_id: int, order_id: int) -> Order:
        order = db.scalar(
            select(Order).where(Order.session_id == session_id, Order.id == order_id)
        )
        if order is None:
            raise HTTPException(status_code=404, detail="Order not found")
        return order

    def _current_candle_or_404(self, session: BacktestSession) -> Candle:
        candle = self.market_data_for_session(session).get_candle(session.current_offset)
        if candle is None:
            raise HTTPException(status_code=404, detail="Current replay candle not found")
        return candle

    def _position(self, db: Session, session: BacktestSession) -> Position | None:
        position = db.scalar(select(Position).where(Position.session_id == session.id))
        if position is None:
            position = Position(session_id=session.id)
            db.add(position)
            db.flush()
        return position

    def _pending_orders(self, db: Session, session_id: int) -> list[Order]:
        return list(
            db.scalars(
                select(Order)
                .where(Order.session_id == session_id, Order.status == OPEN_ORDER)
                .order_by(asc(Order.created_at), asc(Order.id))
            ).all()
        )

    def _open_trade_for_position(
        self,
        db: Session,
        session_id: int,
        side: str,
    ) -> Trade | None:
        return db.scalar(
            select(Trade)
            .where(
                Trade.session_id == session_id,
                Trade.status == "OPEN",
                Trade.side == side,
            )
            .order_by(desc(Trade.id))
            .limit(1)
        )


def list_latest_session(db: Session) -> BacktestSession | None:
    return db.scalar(select(BacktestSession).order_by(desc(BacktestSession.id)).limit(1))


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
        realized_pnl=trade.realized_pnl,
        r_multiple=trade.r_multiple,
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
