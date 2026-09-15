from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    LargeBinary,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    event,
    inspect as sqlalchemy_inspect,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UserOwnedMixin:
    user_id: Mapped[int] = mapped_column(
        ForeignKey("beta_users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )


class BacktestSession(UserOwnedMixin, Base):
    __tablename__ = "backtest_sessions"
    __table_args__ = (
        Index("ix_backtest_sessions_user_created_id", "user_id", "created_at", "id"),
        Index("ix_backtest_sessions_user_dataset_asset_timeframe", "user_id", "dataset_asset_id", "timeframe"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(160), default="Dataset Replay")
    symbol: Mapped[str] = mapped_column(String(40), default="DATASET")
    instrument: Mapped[str | None] = mapped_column(String(120), nullable=True)
    timeframe: Mapped[str | None] = mapped_column(String(20), nullable=True)
    dataset_asset_id: Mapped[int | None] = mapped_column(
        ForeignKey("dataset_assets.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    csv_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    currency: Mapped[str | None] = mapped_column(String(12), nullable=True)
    timezone: Mapped[str | None] = mapped_column(String(80), nullable=True)
    pnl_multiplier: Mapped[float] = mapped_column(Float, default=1.0)
    strategy_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    playbook_id: Mapped[int | None] = mapped_column(
        ForeignKey("playbooks.id", ondelete="SET NULL"),
        nullable=True,
    )
    start_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    end_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    start_offset: Mapped[int] = mapped_column(Integer, default=0)
    end_offset: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE", index=True)
    current_offset: Mapped[int] = mapped_column(Integer, default=299)
    replay_ready: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    initial_balance: Mapped[float] = mapped_column(Float, default=100_000.0)
    realized_pnl: Mapped[float] = mapped_column(Float, default=0.0)
    default_commission_mode: Mapped[str] = mapped_column(String(16), default="NONE")
    default_commission_value: Mapped[float] = mapped_column(Float, default=0.0)
    default_fee_mode: Mapped[str] = mapped_column(String(16), default="NONE")
    default_fee_value: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    orders: Mapped[list["Order"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
    )
    executions: Mapped[list["Execution"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
    )
    trades: Mapped[list["Trade"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
    )
    summary: Mapped["BacktestSessionSummary | None"] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        uselist=False,
    )
    position: Mapped["Position | None"] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        uselist=False,
    )


class BacktestSessionSummary(UserOwnedMixin, Base):
    __tablename__ = "backtest_session_summaries"
    __table_args__ = (
        UniqueConstraint("user_id", "session_id", name="uq_backtest_session_summaries_user_session"),
        Index("ix_backtest_session_summaries_user_updated_id", "user_id", "updated_at", "session_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("backtest_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    closed_trades: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    winning_trades: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    breakeven_trades: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    net_pnl: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    gross_profit: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    gross_loss: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    r_sum: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    r_samples: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    session: Mapped[BacktestSession] = relationship(back_populates="summary")


class UserDashboardSummary(UserOwnedMixin, Base):
    __tablename__ = "user_dashboard_summaries"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_user_dashboard_summaries_user"),
        Index("ix_user_dashboard_summaries_user_updated_at", "user_id", "updated_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    net_pnl: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    win_rate: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    total_trades: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    winning_trades: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    breakeven_trades: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    open_trades: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    profit_factor: Mapped[float | None] = mapped_column(Float, nullable=True)
    gross_pnl: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    total_commissions: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    total_fees: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    max_drawdown: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    recovery_factor: Mapped[float | None] = mapped_column(Float, nullable=True)
    sharpe_ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    average_r: Mapped[float | None] = mapped_column(Float, nullable=True)
    average_hold_minutes: Mapped[float | None] = mapped_column(Float, nullable=True)
    average_win: Mapped[float | None] = mapped_column(Float, nullable=True)
    average_loss: Mapped[float | None] = mapped_column(Float, nullable=True)
    expectancy: Mapped[float | None] = mapped_column(Float, nullable=True)
    best_trade: Mapped[float | None] = mapped_column(Float, nullable=True)
    worst_trade: Mapped[float | None] = mapped_column(Float, nullable=True)
    longest_win_streak: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    longest_loss_streak: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class DatasetAsset(UserOwnedMixin, Base):
    __tablename__ = "dataset_assets"
    __table_args__ = (
        UniqueConstraint("user_id", "asset_key", name="uq_dataset_assets_user_asset_key"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    asset_key: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    symbol: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    folder_path: Mapped[str] = mapped_column(Text, nullable=False)
    currency: Mapped[str] = mapped_column(String(12), default="USD", nullable=False)
    timezone: Mapped[str] = mapped_column(String(80), default="UTC", nullable=False)
    pnl_multiplier: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    timeframes: Mapped[list["DatasetTimeframe"]] = relationship(
        back_populates="asset",
        cascade="all, delete-orphan",
    )


class DatasetTimeframe(UserOwnedMixin, Base):
    __tablename__ = "dataset_timeframes"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "asset_id",
            "timeframe",
            name="uq_dataset_timeframes_user_asset_timeframe",
        ),
        Index("ix_dataset_timeframes_user_csv_path", "user_id", "csv_path"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    asset_id: Mapped[int] = mapped_column(
        ForeignKey("dataset_assets.id", ondelete="CASCADE"),
        index=True,
    )
    timeframe: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    csv_path: Mapped[str] = mapped_column(Text, nullable=False)
    rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    first_timestamp: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_timestamp: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_size: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    file_mtime_ns: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    imported: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    database_imported: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    database_imported_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    asset: Mapped[DatasetAsset] = relationship(back_populates="timeframes")


class MarketCandle(UserOwnedMixin, Base):
    __tablename__ = "market_candles"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "asset_id",
            "timeframe",
            "offset",
            name="uq_market_candles_user_asset_timeframe_offset",
        ),
        UniqueConstraint(
            "user_id",
            "asset_id",
            "timeframe",
            "timestamp",
            name="uq_market_candles_user_asset_timeframe_timestamp",
        ),
        Index(
            "ix_market_candles_user_asset_timeframe_offset",
            "user_id",
            "asset_id",
            "timeframe",
            "offset",
        ),
        Index(
            "ix_market_candles_user_asset_timeframe_timestamp",
            "user_id",
            "asset_id",
            "timeframe",
            "timestamp",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    asset_id: Mapped[int] = mapped_column(
        ForeignKey("dataset_assets.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    timeframe: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    offset: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    open: Mapped[float] = mapped_column(Float, nullable=False)
    high: Mapped[float] = mapped_column(Float, nullable=False)
    low: Mapped[float] = mapped_column(Float, nullable=False)
    close: Mapped[float] = mapped_column(Float, nullable=False)
    volume: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    asset: Mapped[DatasetAsset] = relationship()


class DatasetSettings(UserOwnedMixin, Base):
    __tablename__ = "dataset_settings"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_dataset_settings_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    root_path: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class AppStorageItem(UserOwnedMixin, Base):
    __tablename__ = "app_storage"
    __table_args__ = (
        UniqueConstraint("user_id", "namespace", "key", name="uq_app_storage_user_namespace_key"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    namespace: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    value: Mapped[object | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class IntegrationSecret(UserOwnedMixin, Base):
    __tablename__ = "integration_secrets"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "provider",
            "purpose",
            name="uq_integration_secrets_user_provider_purpose",
        ),
        Index(
            "ix_integration_secrets_user_updated_id",
            "user_id",
            "updated_at",
            "id",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    provider: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    purpose: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    key_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    cipher_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    nonce: Mapped[bytes] = mapped_column(LargeBinary(12), nullable=False)
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=utcnow,
        onupdate=utcnow,
        nullable=False,
    )
    rotated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_connected_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)


@event.listens_for(IntegrationSecret, "before_update")
def prevent_integration_secret_binding_mutation(_mapper, _connection, target) -> None:
    state = sqlalchemy_inspect(target)
    binding_fields = ("user_id", "provider", "purpose", "created_at")
    if any(state.attrs[field].history.has_changes() for field in binding_fields):
        raise ValueError("Integration secret ownership and purpose are immutable")


class BrokerConnection(UserOwnedMixin, Base):
    __tablename__ = "broker_connections"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "provider",
            "display_name",
            name="uq_broker_connections_user_provider_name",
        ),
        Index("ix_broker_connections_user_updated_id", "user_id", "updated_at", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    provider: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    secret_id: Mapped[int] = mapped_column(
        ForeignKey("integration_secrets.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    status: Mapped[str] = mapped_column(String(24), default="READY", nullable=False, index=True)
    health: Mapped[str] = mapped_column(String(24), default="UNKNOWN", nullable=False, index=True)
    last_error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_error_message: Mapped[str | None] = mapped_column(String(240), nullable=True)
    last_sync_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_sync_completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    next_retry_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=utcnow,
        onupdate=utcnow,
        nullable=False,
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)


class BrokerAccount(UserOwnedMixin, Base):
    __tablename__ = "broker_accounts"
    __table_args__ = (
        UniqueConstraint(
            "connection_id",
            "external_account_id",
            name="uq_broker_accounts_connection_external",
        ),
        Index("ix_broker_accounts_user_connection", "user_id", "connection_id", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    connection_id: Mapped[int] = mapped_column(
        ForeignKey("broker_connections.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    external_account_id: Mapped[str] = mapped_column(String(160), nullable=False)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    currency: Mapped[str] = mapped_column(String(12), default="USD", nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="ACTIVE", nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=utcnow,
        onupdate=utcnow,
        nullable=False,
    )


class BrokerSyncCursor(UserOwnedMixin, Base):
    __tablename__ = "broker_sync_cursors"
    __table_args__ = (
        UniqueConstraint(
            "connection_id",
            "stream",
            "scope_key",
            name="uq_broker_sync_cursors_connection_stream_scope",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    connection_id: Mapped[int] = mapped_column(
        ForeignKey("broker_connections.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    account_id: Mapped[int | None] = mapped_column(
        ForeignKey("broker_accounts.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    stream: Mapped[str] = mapped_column(String(32), nullable=False)
    scope_key: Mapped[str] = mapped_column(String(160), default="*", nullable=False)
    cursor: Mapped[str | None] = mapped_column(String(512), nullable=True)
    high_watermark: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class BrokerOrder(UserOwnedMixin, Base):
    __tablename__ = "broker_orders"
    __table_args__ = (
        UniqueConstraint(
            "connection_id",
            "external_order_id",
            name="uq_broker_orders_connection_external",
        ),
        Index("ix_broker_orders_user_account_updated", "user_id", "account_id", "updated_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    connection_id: Mapped[int] = mapped_column(
        ForeignKey("broker_connections.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    account_id: Mapped[int] = mapped_column(
        ForeignKey("broker_accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    external_order_id: Mapped[str] = mapped_column(String(160), nullable=False)
    symbol: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    side: Mapped[str] = mapped_column(String(8), nullable=False)
    order_type: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(28, 10), nullable=False)
    filled_quantity: Mapped[Decimal] = mapped_column(Numeric(28, 10), nullable=False)
    average_fill_price: Mapped[Decimal | None] = mapped_column(Numeric(28, 10), nullable=True)
    commission_total: Mapped[Decimal] = mapped_column(
        Numeric(28, 10), default=Decimal("0"), nullable=False
    )
    fees_total: Mapped[Decimal] = mapped_column(
        Numeric(28, 10), default=Decimal("0"), nullable=False
    )
    source_revision: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    placed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    provider_updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class BrokerFill(UserOwnedMixin, Base):
    __tablename__ = "broker_fills"
    __table_args__ = (
        UniqueConstraint(
            "connection_id",
            "external_fill_id",
            name="uq_broker_fills_connection_external",
        ),
        Index("ix_broker_fills_user_account_executed", "user_id", "account_id", "executed_at", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    connection_id: Mapped[int] = mapped_column(
        ForeignKey("broker_connections.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    account_id: Mapped[int] = mapped_column(
        ForeignKey("broker_accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    order_id: Mapped[int | None] = mapped_column(
        ForeignKey("broker_orders.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    external_fill_id: Mapped[str] = mapped_column(String(160), nullable=False)
    external_order_id: Mapped[str] = mapped_column(String(160), nullable=False)
    symbol: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    side: Mapped[str] = mapped_column(String(8), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(28, 10), nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(28, 10), nullable=False)
    commission: Mapped[Decimal] = mapped_column(
        Numeric(28, 10), default=Decimal("0"), nullable=False
    )
    fees: Mapped[Decimal] = mapped_column(
        Numeric(28, 10), default=Decimal("0"), nullable=False
    )
    source_revision: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    cancelled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    executed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    provider_updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class BrokerPositionSnapshot(UserOwnedMixin, Base):
    __tablename__ = "broker_position_snapshots"
    __table_args__ = (
        UniqueConstraint(
            "connection_id",
            "account_id",
            "symbol",
            name="uq_broker_positions_connection_account_symbol",
        ),
        Index("ix_broker_positions_user_account", "user_id", "account_id", "symbol"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    connection_id: Mapped[int] = mapped_column(
        ForeignKey("broker_connections.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    account_id: Mapped[int] = mapped_column(
        ForeignKey("broker_accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    symbol: Mapped[str] = mapped_column(String(80), nullable=False)
    signed_quantity: Mapped[Decimal] = mapped_column(Numeric(28, 10), nullable=False)
    average_entry_price: Mapped[Decimal | None] = mapped_column(Numeric(28, 10), nullable=True)
    open_costs: Mapped[Decimal] = mapped_column(Numeric(28, 10), nullable=False)
    realized_gross_pnl: Mapped[Decimal] = mapped_column(Numeric(28, 10), nullable=False)
    realized_costs: Mapped[Decimal] = mapped_column(Numeric(28, 10), nullable=False)
    realized_net_pnl: Mapped[Decimal] = mapped_column(Numeric(28, 10), nullable=False)
    fill_count: Mapped[int] = mapped_column(Integer, nullable=False)
    reconciliation_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    last_fill_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class BrokerSyncJob(UserOwnedMixin, Base):
    __tablename__ = "broker_sync_jobs"
    __table_args__ = (
        Index("ix_broker_sync_jobs_user_created_id", "user_id", "created_at", "id"),
        Index("ix_broker_sync_jobs_status_retry", "status", "next_retry_at", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    connection_id: Mapped[int] = mapped_column(
        ForeignKey("broker_connections.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    status: Mapped[str] = mapped_column(String(24), default="QUEUED", nullable=False, index=True)
    attempt: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    cursor_before: Mapped[str | None] = mapped_column(String(512), nullable=True)
    cursor_after: Mapped[str | None] = mapped_column(String(512), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(240), nullable=True)
    stats: Mapped[object] = mapped_column(JSON, default=dict, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    next_retry_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class BrokerAuditLog(UserOwnedMixin, Base):
    __tablename__ = "broker_audit_logs"
    __table_args__ = (
        Index("ix_broker_audit_logs_user_created_id", "user_id", "created_at", "id"),
        Index("ix_broker_audit_logs_connection_created", "connection_id", "created_at", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    connection_id: Mapped[int | None] = mapped_column(
        ForeignKey("broker_connections.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    job_id: Mapped[int | None] = mapped_column(
        ForeignKey("broker_sync_jobs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    provider: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    outcome: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    details: Mapped[object] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class WorkspaceShareSnapshot(UserOwnedMixin, Base):
    __tablename__ = "workspace_share_snapshots"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "workspace_key",
            "snapshot_version",
            name="uq_workspace_share_snapshots_user_workspace_version",
        ),
        Index(
            "ix_workspace_share_snapshots_user_created_id",
            "user_id",
            "created_at",
            "id",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    workspace_key: Mapped[str] = mapped_column(String(96), nullable=False, index=True)
    snapshot_version: Mapped[int] = mapped_column(Integer, nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    scope: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    recipient_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("beta_users.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    recipient_email: Mapped[str | None] = mapped_column(String(320), index=True, nullable=True)
    token_digest: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    payload: Mapped[object] = mapped_column(JSON, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


@event.listens_for(WorkspaceShareSnapshot, "before_update")
def prevent_workspace_share_snapshot_mutation(_mapper, _connection, target) -> None:
    state = sqlalchemy_inspect(target)
    immutable_fields = (
        "workspace_key",
        "snapshot_version",
        "schema_version",
        "scope",
        "title",
        "recipient_user_id",
        "recipient_email",
        "token_digest",
        "expires_at",
        "created_at",
        "user_id",
    )
    if any(state.attrs[field].history.has_changes() for field in immutable_fields):
        raise ValueError("Workspace share snapshots are immutable")
    payload_history = state.attrs.payload.history
    if payload_history.has_changes():
        expires_at = target.expires_at
        if expires_at is not None and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        revoked_before_update = (
            target.revoked_at is not None
            and not state.attrs.revoked_at.history.has_changes()
        )
        expired = expires_at is not None and expires_at <= utcnow()
        previous_was_available = any(
            previous not in ({}, None) for previous in payload_history.deleted
        )
        if (
            target.payload != {}
            or not previous_was_available
            or not (revoked_before_update or expired)
        ):
            raise ValueError("Workspace share snapshots are immutable")


class FeedbackSubmission(UserOwnedMixin, Base):
    __tablename__ = "feedback_submissions"
    __table_args__ = (
        Index("ix_feedback_submissions_user_created_id", "user_id", "created_at", "id"),
        Index("ix_feedback_submissions_status_created_id", "status", "created_at", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    category: Mapped[str] = mapped_column(String(24), default="OTHER", nullable=False, index=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    context: Mapped[object | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="NEW", nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class BetaUser(Base):
    __tablename__ = "beta_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160), default="Beta Trader")
    provider: Mapped[str] = mapped_column(String(16), default="email", index=True)
    status: Mapped[str] = mapped_column(String(16), default="WAITLISTED", index=True)
    beta_position: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    sessions: Mapped[list["BetaSession"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )


class BetaSession(Base):
    __tablename__ = "beta_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("beta_users.id", ondelete="CASCADE"),
        index=True,
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    user: Mapped[BetaUser] = relationship(back_populates="sessions")


class Playbook(UserOwnedMixin, Base):
    __tablename__ = "playbooks"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_playbooks_user_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    rules: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    trades: Mapped[list["Trade"]] = relationship(back_populates="playbook")
    orders: Mapped[list["Order"]] = relationship(back_populates="playbook")


class Position(UserOwnedMixin, Base):
    __tablename__ = "positions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("backtest_sessions.id", ondelete="CASCADE"),
        unique=True,
    )
    side: Mapped[str] = mapped_column(String(12), default="FLAT")
    quantity: Mapped[float] = mapped_column(Float, default=0.0)
    avg_price: Mapped[float] = mapped_column(Float, default=0.0)
    stop_loss: Mapped[float | None] = mapped_column(Float, nullable=True)
    take_profit: Mapped[float | None] = mapped_column(Float, nullable=True)
    breakeven_trigger_r: Mapped[float | None] = mapped_column(Float, nullable=True)
    breakeven_moved: Mapped[bool] = mapped_column(Boolean, default=False)
    strategy_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    playbook_id: Mapped[int | None] = mapped_column(
        ForeignKey("playbooks.id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    session: Mapped[BacktestSession] = relationship(back_populates="position")


class Order(UserOwnedMixin, Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("backtest_sessions.id", ondelete="CASCADE"),
        index=True,
    )
    playbook_id: Mapped[int | None] = mapped_column(
        ForeignKey("playbooks.id", ondelete="SET NULL"),
        nullable=True,
    )
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
    commission_mode: Mapped[str] = mapped_column(String(16), default="NONE")
    commission_value: Mapped[float] = mapped_column(Float, default=0.0)
    fee_mode: Mapped[str] = mapped_column(String(16), default="NONE")
    fee_value: Mapped[float] = mapped_column(Float, default=0.0)
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
        back_populates="order",
        cascade="all, delete-orphan",
    )


class Execution(UserOwnedMixin, Base):
    __tablename__ = "executions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("backtest_sessions.id", ondelete="CASCADE"),
        index=True,
    )
    order_id: Mapped[int | None] = mapped_column(
        ForeignKey("orders.id", ondelete="SET NULL"),
        nullable=True,
    )
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


class Trade(UserOwnedMixin, Base):
    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("backtest_sessions.id", ondelete="CASCADE"),
        index=True,
    )
    playbook_id: Mapped[int | None] = mapped_column(
        ForeignKey("playbooks.id", ondelete="SET NULL"),
        nullable=True,
    )
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
    gross_pnl: Mapped[float | None] = mapped_column(Float, nullable=True)
    realized_pnl: Mapped[float] = mapped_column(Float, default=0.0)
    r_multiple: Mapped[float | None] = mapped_column(Float, nullable=True)
    commission_mode: Mapped[str] = mapped_column(String(16), default="NONE")
    commission_value: Mapped[float] = mapped_column(Float, default=0.0)
    commission_amount: Mapped[float] = mapped_column(Float, default=0.0)
    fee_mode: Mapped[str] = mapped_column(String(16), default="NONE")
    fee_value: Mapped[float] = mapped_column(Float, default=0.0)
    fee_amount: Mapped[float] = mapped_column(Float, default=0.0)
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
        back_populates="trade",
        cascade="all, delete-orphan",
    )


class TradeNote(UserOwnedMixin, Base):
    __tablename__ = "trade_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    trade_id: Mapped[int] = mapped_column(
        ForeignKey("trades.id", ondelete="CASCADE"),
        index=True,
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    mistake_tags: Mapped[str] = mapped_column(Text, default="[]")
    emotional_state: Mapped[str | None] = mapped_column(String(80), nullable=True)
    screenshot_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    trade: Mapped[Trade] = relationship(back_populates="notes_list")


class JournalAccount(UserOwnedMixin, Base):
    __tablename__ = "journal_accounts"
    __table_args__ = (
        UniqueConstraint("user_id", "source_key", name="uq_journal_accounts_user_source"),
        UniqueConstraint("user_id", "broker_account_id", name="uq_journal_accounts_user_broker_account"),
        Index("ix_journal_accounts_user_status_name", "user_id", "status", "name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    broker_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("broker_accounts.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    source_type: Mapped[str] = mapped_column(String(24), default="MANUAL", nullable=False)
    source_key: Mapped[str] = mapped_column(String(240), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    provider: Mapped[str] = mapped_column(String(80), default="Manual", nullable=False)
    currency: Mapped[str] = mapped_column(String(12), default="USD", nullable=False)
    timezone: Mapped[str] = mapped_column(String(80), default="UTC", nullable=False)
    initial_balance: Mapped[Decimal] = mapped_column(Numeric(28, 10), default=Decimal("0"), nullable=False)
    color: Mapped[str | None] = mapped_column(String(32), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE", nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    trades: Mapped[list["CanonicalTrade"]] = relationship(back_populates="account")
    daily_notes: Mapped[list["JournalDailyNote"]] = relationship(back_populates="account")


class JournalImportRun(UserOwnedMixin, Base):
    __tablename__ = "journal_import_runs"
    __table_args__ = (
        Index("ix_journal_import_runs_user_created_id", "user_id", "created_at", "id"),
        Index("ix_journal_import_runs_user_account", "user_id", "account_id", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("journal_accounts.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    source_name: Mapped[str] = mapped_column(String(160), nullable=False)
    source_digest: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(24), default="RUNNING", nullable=False, index=True)
    source_timezone: Mapped[str] = mapped_column(String(80), default="UTC", nullable=False)
    currency: Mapped[str] = mapped_column(String(12), default="USD", nullable=False)
    default_symbol: Mapped[str | None] = mapped_column(String(80), nullable=True)
    column_mapping: Mapped[object] = mapped_column(JSON, default=dict, nullable=False)
    grouping: Mapped[object] = mapped_column(JSON, default=dict, nullable=False)
    detected_columns: Mapped[object] = mapped_column(JSON, default=list, nullable=False)
    total_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    imported_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    skipped_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    duplicate_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    rolled_back_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    rows: Mapped[list["JournalImportRow"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="JournalImportRow.row_number",
    )
    diagnostics: Mapped[list["JournalImportDiagnostic"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="JournalImportDiagnostic.id",
    )
    trades: Mapped[list["CanonicalTrade"]] = relationship(back_populates="import_run")


class CanonicalTrade(UserOwnedMixin, Base):
    __tablename__ = "canonical_trades"
    __table_args__ = (
        UniqueConstraint("user_id", "source_type", "source_ref", name="uq_canonical_trades_user_source"),
        UniqueConstraint("user_id", "account_id", "duplicate_key", name="uq_canonical_trades_user_account_duplicate"),
        CheckConstraint("rating IS NULL OR (rating >= 1 AND rating <= 5)", name="ck_canonical_trades_rating"),
        Index("ix_canonical_trades_user_account_entry", "user_id", "account_id", "entry_time", "id"),
        Index("ix_canonical_trades_user_review_queue", "user_id", "reviewed", "entry_time", "id"),
        Index("ix_canonical_trades_user_symbol_entry", "user_id", "symbol", "entry_time", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("journal_accounts.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    import_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("journal_import_runs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    source_type: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    source_ref: Mapped[str] = mapped_column(String(240), nullable=False)
    duplicate_key: Mapped[str] = mapped_column(String(64), nullable=False)
    entry_type: Mapped[str] = mapped_column(String(16), default="TAKEN", nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(16), default="CLOSED", nullable=False, index=True)
    symbol: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    source_symbol: Mapped[str | None] = mapped_column(String(120), nullable=True)
    currency: Mapped[str] = mapped_column(String(12), default="USD", nullable=False)
    source_timezone: Mapped[str] = mapped_column(String(80), default="UTC", nullable=False)
    side: Mapped[str] = mapped_column(String(12), nullable=False, index=True)
    entry_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    exit_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    entry_price: Mapped[Decimal] = mapped_column(Numeric(28, 10), nullable=False)
    exit_price: Mapped[Decimal | None] = mapped_column(Numeric(28, 10), nullable=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(28, 10), nullable=False)
    remaining_quantity: Mapped[Decimal] = mapped_column(Numeric(28, 10), default=Decimal("0"), nullable=False)
    gross_pnl: Mapped[Decimal] = mapped_column(Numeric(28, 10), default=Decimal("0"), nullable=False)
    net_pnl: Mapped[Decimal] = mapped_column(Numeric(28, 10), default=Decimal("0"), nullable=False)
    commission: Mapped[Decimal] = mapped_column(Numeric(28, 10), default=Decimal("0"), nullable=False)
    fees: Mapped[Decimal] = mapped_column(Numeric(28, 10), default=Decimal("0"), nullable=False)
    stop_loss: Mapped[Decimal | None] = mapped_column(Numeric(28, 10), nullable=True)
    take_profit: Mapped[Decimal | None] = mapped_column(Numeric(28, 10), nullable=True)
    planned_entry_price: Mapped[Decimal | None] = mapped_column(Numeric(28, 10), nullable=True)
    planned_exit_price: Mapped[Decimal | None] = mapped_column(Numeric(28, 10), nullable=True)
    planned_stop_loss: Mapped[Decimal | None] = mapped_column(Numeric(28, 10), nullable=True)
    planned_take_profit: Mapped[Decimal | None] = mapped_column(Numeric(28, 10), nullable=True)
    r_multiple: Mapped[Decimal | None] = mapped_column(Numeric(18, 8), nullable=True)
    strategy_name: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    emotional_state: Mapped[str | None] = mapped_column(String(80), nullable=True)
    missed_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    setup_grade: Mapped[str | None] = mapped_column(String(8), nullable=True, index=True)
    reviewed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    account: Mapped[JournalAccount] = relationship(back_populates="trades")
    import_run: Mapped[JournalImportRun | None] = relationship(back_populates="trades")
    executions: Mapped[list["CanonicalExecution"]] = relationship(
        back_populates="trade",
        cascade="all, delete-orphan",
        order_by="CanonicalExecution.sequence",
    )
    tag_links: Mapped[list["CanonicalTradeTag"]] = relationship(
        back_populates="trade",
        cascade="all, delete-orphan",
    )
    notes: Mapped[list["CanonicalTradeNote"]] = relationship(
        back_populates="trade",
        cascade="all, delete-orphan",
        order_by="CanonicalTradeNote.created_at",
    )
    screenshots: Mapped[list["CanonicalTradeScreenshot"]] = relationship(
        back_populates="trade",
        cascade="all, delete-orphan",
        order_by="CanonicalTradeScreenshot.created_at",
    )


class CanonicalExecution(UserOwnedMixin, Base):
    __tablename__ = "canonical_executions"
    __table_args__ = (
        UniqueConstraint("trade_id", "fingerprint", name="uq_canonical_executions_trade_fingerprint"),
        Index("ix_canonical_executions_user_trade_time", "user_id", "trade_id", "occurred_at", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    trade_id: Mapped[int] = mapped_column(
        ForeignKey("canonical_trades.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_type: Mapped[str] = mapped_column(String(24), nullable=False)
    source_ref: Mapped[str] = mapped_column(String(240), nullable=False)
    execution_type: Mapped[str] = mapped_column(String(16), default="FILL", nullable=False)
    side: Mapped[str] = mapped_column(String(8), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    price: Mapped[Decimal] = mapped_column(Numeric(28, 10), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(28, 10), nullable=False)
    commission: Mapped[Decimal] = mapped_column(Numeric(28, 10), default=Decimal("0"), nullable=False)
    fees: Mapped[Decimal] = mapped_column(Numeric(28, 10), default=Decimal("0"), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    source_revision: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    raw_payload: Mapped[object] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    trade: Mapped[CanonicalTrade] = relationship(back_populates="executions")


@event.listens_for(CanonicalExecution, "before_update")
def prevent_canonical_execution_update(_mapper, _connection, _target: CanonicalExecution) -> None:
    raise ValueError("Canonical executions are immutable; append a corrected source revision")


class JournalTag(UserOwnedMixin, Base):
    __tablename__ = "journal_tags"
    __table_args__ = (
        UniqueConstraint("user_id", "category", "normalized_name", name="uq_journal_tags_user_category_name"),
        CheckConstraint(
            "category IN ('SETUP', 'POSITIVE', 'MISTAKE', 'PROCESS')",
            name="ck_journal_tags_category",
        ),
        Index("ix_journal_tags_user_category_name", "user_id", "category", "name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    category: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(80), nullable=False)
    color: Mapped[str | None] = mapped_column(String(32), nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    trade_links: Mapped[list["CanonicalTradeTag"]] = relationship(
        back_populates="tag",
        cascade="all, delete-orphan",
    )


class CanonicalTradeTag(UserOwnedMixin, Base):
    __tablename__ = "canonical_trade_tags"
    __table_args__ = (
        UniqueConstraint("trade_id", "tag_id", name="uq_canonical_trade_tags_trade_tag"),
        Index("ix_canonical_trade_tags_user_tag_trade", "user_id", "tag_id", "trade_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trade_id: Mapped[int] = mapped_column(
        ForeignKey("canonical_trades.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    tag_id: Mapped[int] = mapped_column(
        ForeignKey("journal_tags.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    trade: Mapped[CanonicalTrade] = relationship(back_populates="tag_links")
    tag: Mapped[JournalTag] = relationship(back_populates="trade_links")


class CanonicalTradeNote(UserOwnedMixin, Base):
    __tablename__ = "canonical_trade_notes"
    __table_args__ = (Index("ix_canonical_trade_notes_user_trade", "user_id", "trade_id", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    trade_id: Mapped[int] = mapped_column(
        ForeignKey("canonical_trades.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(24), default="REVIEW", nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    trade: Mapped[CanonicalTrade] = relationship(back_populates="notes")


class CanonicalTradeScreenshot(UserOwnedMixin, Base):
    __tablename__ = "canonical_trade_screenshots"
    __table_args__ = (Index("ix_canonical_trade_screenshots_user_trade", "user_id", "trade_id", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    trade_id: Mapped[int] = mapped_column(
        ForeignKey("canonical_trades.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    url: Mapped[str] = mapped_column(Text, nullable=False)
    caption: Mapped[str | None] = mapped_column(String(240), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    trade: Mapped[CanonicalTrade] = relationship(back_populates="screenshots")


class JournalDailyNote(UserOwnedMixin, Base):
    __tablename__ = "journal_daily_notes"
    __table_args__ = (
        UniqueConstraint("user_id", "note_date", "account_scope_key", name="uq_journal_daily_notes_user_date_scope"),
        Index("ix_journal_daily_notes_user_date", "user_id", "note_date", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    account_id: Mapped[int | None] = mapped_column(
        ForeignKey("journal_accounts.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    account_scope_key: Mapped[str] = mapped_column(String(32), nullable=False)
    note_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    body: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    account: Mapped[JournalAccount | None] = relationship(back_populates="daily_notes")


class JournalImportRow(UserOwnedMixin, Base):
    __tablename__ = "journal_import_rows"
    __table_args__ = (
        UniqueConstraint("run_id", "row_number", name="uq_journal_import_rows_run_row"),
        Index("ix_journal_import_rows_user_run_status", "user_id", "run_id", "status"),
        Index("ix_journal_import_rows_duplicate_key", "duplicate_key"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    run_id: Mapped[int] = mapped_column(
        ForeignKey("journal_import_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    trade_id: Mapped[int | None] = mapped_column(
        ForeignKey("canonical_trades.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    row_number: Mapped[int] = mapped_column(Integer, nullable=False)
    group_key: Mapped[str] = mapped_column(String(240), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    duplicate_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    normalized_payload: Mapped[object | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    run: Mapped[JournalImportRun] = relationship(back_populates="rows")


class JournalImportDiagnostic(UserOwnedMixin, Base):
    __tablename__ = "journal_import_diagnostics"
    __table_args__ = (Index("ix_journal_import_diagnostics_user_run", "user_id", "run_id", "id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    run_id: Mapped[int] = mapped_column(
        ForeignKey("journal_import_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    row_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    severity: Mapped[str] = mapped_column(String(16), default="ERROR", nullable=False)
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    field: Mapped[str | None] = mapped_column(String(80), nullable=True)
    message: Mapped[str] = mapped_column(String(500), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    run: Mapped[JournalImportRun] = relationship(back_populates="diagnostics")


class JournalBackfillCheckpoint(UserOwnedMixin, Base):
    __tablename__ = "journal_backfill_checkpoints"
    __table_args__ = (
        UniqueConstraint("user_id", "source_key", name="uq_journal_backfill_user_source"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    source_key: Mapped[str] = mapped_column(String(240), nullable=False)
    source_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    accounts_created: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    trades_created: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    diagnostics: Mapped[object] = mapped_column(JSON, default=list, nullable=False)
    completed_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
