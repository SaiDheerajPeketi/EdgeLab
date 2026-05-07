from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class BacktestSession(Base):
    __tablename__ = "backtest_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(160), default="EURUSD Replay")
    symbol: Mapped[str] = mapped_column(String(40), default="EURUSD")
    instrument: Mapped[str | None] = mapped_column(String(80), nullable=True)
    timeframe: Mapped[str | None] = mapped_column(String(20), nullable=True)
    csv_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    currency: Mapped[str | None] = mapped_column(String(12), nullable=True)
    timezone: Mapped[str | None] = mapped_column(String(80), nullable=True)
    pnl_multiplier: Mapped[float] = mapped_column(Float, default=1.0)
    strategy_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    playbook_id: Mapped[int | None] = mapped_column(ForeignKey("playbooks.id"), nullable=True)
    start_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    end_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    start_offset: Mapped[int] = mapped_column(Integer, default=0)
    end_offset: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE", index=True)
    current_offset: Mapped[int] = mapped_column(Integer, default=299)
    initial_balance: Mapped[float] = mapped_column(Float, default=100_000.0)
    realized_pnl: Mapped[float] = mapped_column(Float, default=0.0)
    commission_per_unit: Mapped[float] = mapped_column(Float, default=0.0)
    slippage_per_unit: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    orders: Mapped[list["Order"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )
    executions: Mapped[list["Execution"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )
    trades: Mapped[list["Trade"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )
    position: Mapped["Position | None"] = relationship(
        back_populates="session", cascade="all, delete-orphan", uselist=False
    )


class DatasetAsset(Base):
    __tablename__ = "dataset_assets"

    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    symbol: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    folder_path: Mapped[str] = mapped_column(Text, nullable=False)
    currency: Mapped[str] = mapped_column(String(12), default="USD", nullable=False)
    timezone: Mapped[str] = mapped_column(String(80), default="UTC", nullable=False)
    pnl_multiplier: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    timeframes: Mapped[list["DatasetTimeframe"]] = relationship(
        back_populates="asset", cascade="all, delete-orphan"
    )


class DatasetTimeframe(Base):
    __tablename__ = "dataset_timeframes"
    __table_args__ = (
        UniqueConstraint("asset_id", "timeframe", name="uq_dataset_timeframes_asset_timeframe"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    asset_id: Mapped[str] = mapped_column(ForeignKey("dataset_assets.id"), index=True)
    timeframe: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    csv_path: Mapped[str] = mapped_column(Text, nullable=False)
    rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    first_timestamp: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_timestamp: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_size: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    file_mtime_ns: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    imported: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    asset: Mapped[DatasetAsset] = relationship(back_populates="timeframes")


class DatasetSettings(Base):
    __tablename__ = "dataset_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    root_path: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class AppStorageItem(Base):
    __tablename__ = "app_storage"
    __table_args__ = (
        UniqueConstraint("namespace", "key", name="uq_app_storage_namespace_key"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    namespace: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    value: Mapped[object | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class Playbook(Base):
    __tablename__ = "playbooks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    rules: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    trades: Mapped[list["Trade"]] = relationship(back_populates="playbook")
    orders: Mapped[list["Order"]] = relationship(back_populates="playbook")


class Position(Base):
    __tablename__ = "positions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("backtest_sessions.id"), unique=True)
    side: Mapped[str] = mapped_column(String(12), default="FLAT")
    quantity: Mapped[float] = mapped_column(Float, default=0.0)
    avg_price: Mapped[float] = mapped_column(Float, default=0.0)
    stop_loss: Mapped[float | None] = mapped_column(Float, nullable=True)
    take_profit: Mapped[float | None] = mapped_column(Float, nullable=True)
    breakeven_trigger_r: Mapped[float | None] = mapped_column(Float, nullable=True)
    breakeven_moved: Mapped[bool] = mapped_column(Boolean, default=False)
    strategy_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    playbook_id: Mapped[int | None] = mapped_column(ForeignKey("playbooks.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    session: Mapped[BacktestSession] = relationship(back_populates="position")


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("backtest_sessions.id"), index=True)
    playbook_id: Mapped[int | None] = mapped_column(ForeignKey("playbooks.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="PENDING", index=True)
    side: Mapped[str] = mapped_column(String(8), index=True)
    order_type: Mapped[str] = mapped_column(String(12), default="MARKET")
    quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    risk_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    limit_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    stop_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    stop_loss: Mapped[float | None] = mapped_column(Float, nullable=True)
    take_profit: Mapped[float | None] = mapped_column(Float, nullable=True)
    breakeven_trigger_r: Mapped[float | None] = mapped_column(Float, nullable=True)
    reduce_only: Mapped[bool] = mapped_column(Boolean, default=False)
    strategy_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    mistake_tags: Mapped[str] = mapped_column(Text, default="[]")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_offset: Mapped[int] = mapped_column(Integer, default=0)
    filled_offset: Mapped[int | None] = mapped_column(Integer, nullable=True)
    filled_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    filled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    session: Mapped[BacktestSession] = relationship(back_populates="orders")
    playbook: Mapped[Playbook | None] = relationship(back_populates="orders")
    executions: Mapped[list["Execution"]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
    )


class Execution(Base):
    __tablename__ = "executions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("backtest_sessions.id"), index=True)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), nullable=True)
    side: Mapped[str] = mapped_column(String(8), index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, index=True)
    offset: Mapped[int] = mapped_column(Integer, index=True)
    price: Mapped[float] = mapped_column(Float)
    quantity: Mapped[float] = mapped_column(Float)
    realized_pnl: Mapped[float] = mapped_column(Float, default=0.0)
    position_side_after: Mapped[str] = mapped_column(String(12), default="FLAT")
    position_quantity_after: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    session: Mapped[BacktestSession] = relationship(back_populates="executions")
    order: Mapped[Order | None] = relationship(back_populates="executions")


class Trade(Base):
    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("backtest_sessions.id"), index=True)
    playbook_id: Mapped[int | None] = mapped_column(ForeignKey("playbooks.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(12), default="OPEN", index=True)
    side: Mapped[str] = mapped_column(String(12), index=True)

    entry_time: Mapped[datetime] = mapped_column(DateTime, index=True)
    entry_offset: Mapped[int] = mapped_column(Integer, default=0)
    entry_price: Mapped[float] = mapped_column(Float)
    quantity: Mapped[float] = mapped_column(Float)
    remaining_quantity: Mapped[float] = mapped_column(Float)
    stop_loss: Mapped[float | None] = mapped_column(Float, nullable=True)
    take_profit: Mapped[float | None] = mapped_column(Float, nullable=True)

    exit_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    exit_offset: Mapped[int | None] = mapped_column(Integer, nullable=True)
    exit_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    realized_pnl: Mapped[float] = mapped_column(Float, default=0.0)
    r_multiple: Mapped[float | None] = mapped_column(Float, nullable=True)

    strategy_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    mistake_tags: Mapped[str] = mapped_column(Text, default="[]")
    emotional_state: Mapped[str | None] = mapped_column(String(80), nullable=True)
    screenshot_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    session: Mapped[BacktestSession] = relationship(back_populates="trades")
    playbook: Mapped[Playbook | None] = relationship(back_populates="trades")
    notes_list: Mapped[list["TradeNote"]] = relationship(
        back_populates="trade", cascade="all, delete-orphan"
    )


class TradeNote(Base):
    __tablename__ = "trade_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    trade_id: Mapped[int] = mapped_column(ForeignKey("trades.id"), index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    mistake_tags: Mapped[str] = mapped_column(Text, default="[]")
    emotional_state: Mapped[str | None] = mapped_column(String(80), nullable=True)
    screenshot_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    trade: Mapped[Trade] = relationship(back_populates="notes_list")
