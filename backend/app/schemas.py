from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


OrderSide = Literal["BUY", "SELL"]
OrderType = Literal["MARKET", "LIMIT", "STOP"]
OrderStatus = Literal["PENDING", "FILLED", "CANCELLED"]
PositionSide = Literal["FLAT", "LONG", "SHORT"]
RiskBase = Literal["CURRENT_BALANCE", "INITIAL_BALANCE"]
CommissionMode = Literal["NONE", "FIXED", "PERCENT"]


class Candle(BaseModel):
    time: int
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float
    ema_20: float | None = None
    ema_50: float | None = None
    rsi_14: float | None = None


class BarsResponse(BaseModel):
    offset: int
    limit: int
    next_offset: int
    bars: list[Candle]


class BinanceInstrument(BaseModel):
    symbol: str
    label: str
    description: str
    asset_class: str = "crypto"
    base_asset: str
    quote_asset: str
    status: str


class BinanceInstrumentsResponse(BaseModel):
    instruments: list[BinanceInstrument]


class DukascopyInstrument(BaseModel):
    symbol: str
    label: str
    description: str
    asset_class: str
    base_currency: str
    quote_currency: str
    tags: list[str] = Field(default_factory=list)


class DukascopyInstrumentsResponse(BaseModel):
    instruments: list[DukascopyInstrument]


class DukascopyCandlesResponse(BaseModel):
    candles: list[Candle]


class AngelOneInstrument(BaseModel):
    token: str
    symbol: str
    label: str
    description: str
    exchange: str
    exchange_type: int
    asset_class: str
    name: str
    expiry: str | None = None
    instrument_type: str = ""
    lot_size: int | None = None
    tick_size: float | None = None


class AngelOneInstrumentsResponse(BaseModel):
    instruments: list[AngelOneInstrument]


class EconomicCalendarEvent(BaseModel):
    title: str
    currency: str
    starts_at: datetime
    impact: str
    forecast: str | None = None
    previous: str | None = None
    actual: str | None = None


class EconomicCalendarResponse(BaseModel):
    provider: Literal["forex_factory"] = "forex_factory"
    source_url: str
    updated_at: datetime
    cache_expires_at: datetime
    stale: bool = False
    events: list[EconomicCalendarEvent]


class DatasetMeta(BaseModel):
    csv_path: str
    rows: int
    first_timestamp: datetime | None
    last_timestamp: datetime | None


class DatasetTimeframe(BaseModel):
    timeframe: str
    csv_path: str
    rows: int
    first_timestamp: datetime | None
    last_timestamp: datetime | None
    imported: bool = False
    imported_at: datetime | None = None


class DatasetInstrument(BaseModel):
    id: str
    name: str
    symbol: str
    currency: str = "USD"
    timezone: str = "UTC"
    pnl_multiplier: float = 1.0
    folder_path: str | None = None
    updated_at: datetime | None = None
    timeframes: list[DatasetTimeframe]


class DatasetCatalogResponse(BaseModel):
    root: str
    instruments: list[DatasetInstrument]


class DatasetRefreshSummary(BaseModel):
    assets: int
    timeframes: int
    candles: int


class DatasetRefreshStatus(BaseModel):
    running: bool = False
    current: str | None = None
    summary: DatasetRefreshSummary = Field(
        default_factory=lambda: DatasetRefreshSummary(assets=0, timeframes=0, candles=0)
    )
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None


class DatasetRefreshResponse(BaseModel):
    catalog: DatasetCatalogResponse
    summary: DatasetRefreshSummary
    status: DatasetRefreshStatus | None = None


class DatasetSettingsRead(BaseModel):
    root_path: str


class DatasetSettingsUpdate(BaseModel):
    root_path: str = Field(min_length=1)


class DatasetAssetUpdate(BaseModel):
    currency: str | None = Field(default=None, min_length=1, max_length=12)
    timezone: str | None = Field(default=None, min_length=1, max_length=80)
    pnl_multiplier: float | None = Field(default=None, gt=0)


class AppStoragePayload(BaseModel):
    value: Any = None


class AppStorageRead(BaseModel):
    namespace: str
    key: str
    value: Any = None
    updated_at: datetime | None = None


class AppDataBundle(BaseModel):
    app: Literal["edgelab"] = "edgelab"
    version: int = 1
    exported_at: datetime | None = None
    tables: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)


class AppDataImportResult(BaseModel):
    ok: bool = True
    imported_at: datetime
    summary: dict[str, int] = Field(default_factory=dict)


class BetaProgramStatus(BaseModel):
    mode: Literal["beta"] = "beta"
    seats_total: int = Field(ge=1)
    seats_taken: int = Field(ge=0)
    seats_remaining: int = Field(ge=0)
    waitlist_count: int = Field(ge=0)


class BetaAuthConfig(BaseModel):
    google_enabled: bool = False
    google_client_id: str | None = None
    google_redirect_uri: str | None = None
    manual_access_enabled: bool = False


class BetaAccessRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    name: str | None = Field(default=None, max_length=160)
    provider: Literal["email", "google"] = "email"


class BetaAuthUser(BaseModel):
    id: int
    email: str
    name: str
    provider: Literal["email", "google"]
    approved: bool
    beta_position: int | None = None
    is_beta_user: Literal[True] = True
    plan: Literal["beta"] = "beta"


class BetaAuthSessionRead(BaseModel):
    token: str
    created_at: datetime
    expires_at: datetime
    user: BetaAuthUser


class BetaAccessResponse(BaseModel):
    session: BetaAuthSessionRead
    program: BetaProgramStatus


class GoogleAuthExchangeRequest(BaseModel):
    code: str = Field(min_length=1)
    redirect_uri: str = Field(min_length=1, max_length=1024)


class PlaybookCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    rules: str | None = None


class PlaybookUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    rules: str | None = None


class PlaybookRead(PlaybookCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime


class BacktestCreate(BaseModel):
    name: str | None = None
    symbol: str | None = None
    instrument: str | None = None
    timeframe: str | None = None
    csv_path: str | None = None
    currency: str | None = None
    timezone: str | None = None
    pnl_multiplier: float | None = Field(default=None, gt=0)
    strategy_name: str | None = None
    playbook_id: int | None = None
    start_timestamp: datetime | None = None
    end_timestamp: datetime | None = None
    initial_balance: float = Field(default=100_000.0, gt=0)
    initial_offset: int = Field(default=0, ge=0)
    default_commission_mode: CommissionMode = "NONE"
    default_commission_value: float | None = Field(default=0.0, ge=0)
    default_fee_mode: CommissionMode = "NONE"
    default_fee_value: float | None = Field(default=0.0, ge=0)


class BacktestSessionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    currency: str | None = Field(default=None, max_length=12)
    timezone: str | None = Field(default=None, max_length=80)
    pnl_multiplier: float | None = Field(default=None, gt=0)
    strategy_name: str | None = Field(default=None, max_length=120)
    playbook_id: int | None = None
    status: Literal["ACTIVE", "COMPLETE"] | None = None
    initial_balance: float | None = Field(default=None, gt=0)
    default_commission_mode: CommissionMode | None = None
    default_commission_value: float | None = Field(default=None, ge=0)
    default_fee_mode: CommissionMode | None = None
    default_fee_value: float | None = Field(default=None, ge=0)


class BacktestSessionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    symbol: str
    instrument: str | None = None
    timeframe: str | None = None
    csv_path: str | None = None
    currency: str | None = None
    timezone: str | None = None
    pnl_multiplier: float = 1.0
    strategy_name: str | None = None
    playbook_id: int | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    start_offset: int = 0
    end_offset: int | None = None
    status: Literal["ACTIVE", "COMPLETE"]
    current_offset: int
    initial_balance: float
    realized_pnl: float
    default_commission_mode: CommissionMode = "NONE"
    default_commission_value: float = 0.0
    default_fee_mode: CommissionMode = "NONE"
    default_fee_value: float = 0.0
    created_at: datetime
    updated_at: datetime


class BacktestTradeImport(BaseModel):
    account_name: str = Field(default="Imported Backtest", min_length=1, max_length=160)
    source_name: str | None = Field(default=None, max_length=120)
    csv_text: str = Field(min_length=1)
    initial_balance: float = Field(default=100_000.0, gt=0)
    currency: str | None = Field(default=None, max_length=12)
    symbol: str | None = Field(default=None, max_length=40)
    instrument: str | None = Field(default=None, max_length=80)
    timeframe: str | None = Field(default=None, max_length=20)
    strategy_name: str | None = Field(default=None, max_length=120)
    default_commission_mode: CommissionMode = "NONE"
    default_commission_value: float | None = Field(default=0.0, ge=0)
    default_fee_mode: CommissionMode = "NONE"
    default_fee_value: float | None = Field(default=0.0, ge=0)
    column_mapping: dict[str, str] = Field(default_factory=dict)


class PositionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    side: PositionSide
    quantity: float
    avg_price: float
    stop_loss: float | None
    take_profit: float | None
    breakeven_trigger_r: float | None
    breakeven_moved: bool
    strategy_name: str | None
    playbook_id: int | None
    unrealized_pnl: float = 0.0


class PositionUpdate(BaseModel):
    stop_loss: float | None = Field(default=None, gt=0)
    take_profit: float | None = Field(default=None, gt=0)


class OrderCreate(BaseModel):
    side: OrderSide
    order_type: OrderType = "MARKET"
    quantity: float | None = Field(default=None, gt=0)
    risk_percent: float | None = Field(default=None, gt=0, le=100)
    risk_base: RiskBase | None = "CURRENT_BALANCE"
    limit_price: float | None = Field(default=None, gt=0)
    stop_price: float | None = Field(default=None, gt=0)
    stop_loss: float | None = Field(default=None, gt=0)
    take_profit: float | None = Field(default=None, gt=0)
    breakeven_trigger_r: float | None = Field(default=None, gt=0)
    reduce_only: bool = False
    commission_mode: CommissionMode = "NONE"
    commission_value: float | None = Field(default=0.0, ge=0)
    fee_mode: CommissionMode = "NONE"
    fee_value: float | None = Field(default=0.0, ge=0)
    strategy_name: str | None = None
    playbook_id: int | None = None
    mistake_tags: list[str] = Field(default_factory=list)
    notes: str | None = None

    @model_validator(mode="after")
    def validate_order(self) -> "OrderCreate":
        if self.quantity is None and self.risk_percent is None:
            raise ValueError("Provide quantity or risk_percent")
        if self.risk_percent is not None and self.stop_loss is None:
            raise ValueError("risk_percent requires stop_loss")
        if self.order_type == "LIMIT" and self.limit_price is None:
            raise ValueError("LIMIT orders require limit_price")
        if self.order_type == "STOP" and self.stop_price is None:
            raise ValueError("STOP orders require stop_price")
        return self


class OrderUpdate(BaseModel):
    quantity: float | None = Field(default=None, gt=0)
    limit_price: float | None = Field(default=None, gt=0)
    stop_price: float | None = Field(default=None, gt=0)
    stop_loss: float | None = Field(default=None, gt=0)
    take_profit: float | None = Field(default=None, gt=0)
    breakeven_trigger_r: float | None = Field(default=None, gt=0)
    reduce_only: bool | None = None
    commission_mode: CommissionMode | None = None
    commission_value: float | None = Field(default=None, ge=0)
    fee_mode: CommissionMode | None = None
    fee_value: float | None = Field(default=None, ge=0)
    strategy_name: str | None = None
    playbook_id: int | None = None
    mistake_tags: list[str] | None = None
    notes: str | None = None


class OrderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    playbook_id: int | None
    status: OrderStatus
    side: OrderSide
    order_type: OrderType
    quantity: float | None
    risk_percent: float | None
    limit_price: float | None
    stop_price: float | None
    stop_loss: float | None
    take_profit: float | None
    breakeven_trigger_r: float | None
    reduce_only: bool
    commission_mode: CommissionMode
    commission_value: float
    fee_mode: CommissionMode
    fee_value: float
    strategy_name: str | None
    mistake_tags: list[str]
    notes: str | None
    created_offset: int
    filled_offset: int | None
    filled_price: float | None
    created_at: datetime
    updated_at: datetime
    filled_at: datetime | None


class ExecutionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    order_id: int | None
    side: OrderSide
    timestamp: datetime
    offset: int
    price: float
    quantity: float
    realized_pnl: float
    position_side_after: PositionSide
    position_quantity_after: float
    created_at: datetime


class TradeRead(BaseModel):
    id: int
    session_id: int
    status: Literal["OPEN", "CLOSED"]
    side: Literal["LONG", "SHORT"]
    entry_time: datetime
    entry_offset: int
    entry_price: float
    quantity: float
    remaining_quantity: float
    stop_loss: float | None
    take_profit: float | None
    exit_time: datetime | None
    exit_offset: int | None
    exit_price: float | None
    gross_pnl: float
    realized_pnl: float
    r_multiple: float | None
    commission_mode: CommissionMode
    commission_value: float
    commission_amount: float
    fee_mode: CommissionMode
    fee_value: float
    fee_amount: float
    strategy_name: str | None
    playbook_id: int | None
    notes: str | None
    mistake_tags: list[str]
    emotional_state: str | None
    screenshot_url: str | None


class BacktestTradeImportResult(BaseModel):
    session: BacktestSessionRead
    trades: list[TradeRead]
    imported_rows: int
    skipped_rows: int
    errors: list[str] = Field(default_factory=list)
    detected_columns: list[str] = Field(default_factory=list)


class JournalUpdate(BaseModel):
    notes: str | None = None
    mistake_tags: list[str] = Field(default_factory=list)
    strategy_name: str | None = None
    emotional_state: str | None = None
    screenshot_url: str | None = None
    commission_mode: CommissionMode | None = None
    commission_value: float | None = Field(default=None, ge=0)
    commission_amount: float | None = Field(default=None, ge=0)
    fee_mode: CommissionMode | None = None
    fee_value: float | None = Field(default=None, ge=0)
    fee_amount: float | None = Field(default=None, ge=0)


class TradeStrategyUpdate(BaseModel):
    strategy_name: str | None = Field(default=None, max_length=120)


class BacktestAdvanceRequest(BaseModel):
    steps: int = Field(default=1, ge=1, le=5000)


class BacktestJumpRequest(BaseModel):
    offset: int | None = Field(default=None, ge=0)
    timestamp: datetime | None = None

    @model_validator(mode="after")
    def validate_jump(self) -> "BacktestJumpRequest":
        if self.offset is None and self.timestamp is None:
            raise ValueError("Provide offset or timestamp")
        return self


class EquityPoint(BaseModel):
    timestamp: datetime
    equity: float


class StrategyPerformance(BaseModel):
    strategy_name: str
    trades: int
    net_pnl: float
    win_rate: float
    average_r: float | None


class SideBreakdown(BaseModel):
    side: Literal["LONG", "SHORT"]
    trades: int
    net_pnl: float
    win_rate: float


class CalendarPoint(BaseModel):
    date: str
    pnl: float
    trades: int


class MetricsResponse(BaseModel):
    net_pnl: float
    win_rate: float
    total_trades: int
    profit_factor: float | None
    max_drawdown: float
    sharpe_ratio: float | None
    average_r: float | None
    best_trade: float | None
    worst_trade: float | None
    longest_win_streak: int
    longest_loss_streak: int
    equity_curve: list[EquityPoint]
    strategy_performance: list[StrategyPerformance]
    side_breakdown: list[SideBreakdown]
    calendar: list[CalendarPoint]


class BacktestState(BaseModel):
    session: BacktestSessionRead
    current_candle: Candle | None
    position: PositionRead | None
    orders: list[OrderRead]
    executions: list[ExecutionRead]
    trades: list[TradeRead]
    metrics: MetricsResponse
