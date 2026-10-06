from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, SecretStr, StrictStr, UUID4, field_validator, model_validator


OrderSide = Literal["BUY", "SELL"]
OrderType = Literal["MARKET", "LIMIT", "STOP"]
OrderStatus = Literal["PENDING", "FILLED", "CANCELLED"]
PositionSide = Literal["FLAT", "LONG", "SHORT"]
RiskBase = Literal["CURRENT_BALANCE", "INITIAL_BALANCE"]
CommissionMode = Literal["NONE", "FIXED", "PERCENT"]
FeedbackCategory = Literal["BUG", "FEATURE", "UX", "PERFORMANCE", "DATA", "OTHER"]
FeedbackStatus = Literal["NEW", "REVIEWED", "CLOSED"]
WorkspaceShareScope = Literal["chart-plus-panels", "panels-only", "complete-workspace"]
JournalTagCategory = Literal["SETUP", "POSITIVE", "MISTAKE", "PROCESS"]
JournalTradeSource = Literal["MANUAL", "CSV_IMPORT", "APP_STORAGE", "BACKTEST", "BROKER"]
JournalEntryType = Literal["TAKEN", "MISSED"]
JournalTradeStatus = Literal["OPEN", "CLOSED", "MISSED", "VOIDED"]
SetupGrade = Literal["A+", "A", "B", "C", "D", "F"]


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
    database_imported: bool = False
    database_imported_at: datetime | None = None


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


class JournalSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    default_broker: str = Field(default="Manual", max_length=80)
    default_currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")
    default_entry_type: Literal["TAKEN", "MISSED"] = "TAKEN"
    require_account_for_taken_trades: bool = Field(default=True, strict=True)


class AppStorageRead(BaseModel):
    namespace: str
    key: str
    value: Any = None
    updated_at: datetime | None = None


class ChartSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    timeHoursFormat: Literal["12-hour", "24-hour"] = "24-hour"
    dateFormat: Literal["dd MMM yy", "MMM dd yyyy", "yyyy-MM-dd"] = "dd MMM yy"
    textSize: int = Field(default=12, ge=10, le=18, strict=True)
    gridMode: Literal["both", "horizontal", "vertical", "none"] = "both"
    backgroundColor: str = Field(default="#09090b", pattern=r"^#[0-9a-fA-F]{6}$")
    textColor: str = Field(default="#ffffff", pattern=r"^#[0-9a-fA-F]{6}$")
    gridColor: str = Field(default="#27272a", pattern=r"^#[0-9a-fA-F]{6}$")
    candleUpColor: str = Field(default="#22c55e", pattern=r"^#[0-9a-fA-F]{6}$")
    candleDownColor: str = Field(default="#ef4444", pattern=r"^#[0-9a-fA-F]{6}$")


class ChartSettingsRead(BaseModel):
    presets: AppStorageRead
    active: AppStorageRead


class SettingsPreferencesUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    density: Literal["comfortable", "compact"] = "comfortable"
    includeDiagnosticsByDefault: bool = Field(default=True, strict=True)


class IntegrationSecretCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str = Field(
        min_length=1,
        max_length=64,
        pattern=r"^[A-Za-z][A-Za-z0-9_-]{0,63}$",
    )
    purpose: str = Field(
        min_length=1,
        max_length=64,
        pattern=r"^[A-Za-z][A-Za-z0-9_-]{0,63}$",
    )
    credentials: dict[str, SecretStr] = Field(min_length=1, max_length=32)

    @field_validator("provider", "purpose")
    @classmethod
    def normalize_identifier(cls, value: str) -> str:
        return value.strip().lower()


class IntegrationSecretReplace(BaseModel):
    model_config = ConfigDict(extra="forbid")

    credentials: dict[str, SecretStr] = Field(min_length=1, max_length=32)


class IntegrationSecretRead(BaseModel):
    id: int
    provider: str
    purpose: str
    key_id: str
    cipher_version: int
    version: int
    state: Literal["active", "revoked"]
    created_at: datetime
    updated_at: datetime
    rotated_at: datetime | None = None
    last_connected_at: datetime | None = None
    revoked_at: datetime | None = None


class IntegrationSecretConnectionRead(IntegrationSecretRead):
    connection_status: Literal["credentials-ready"] = "credentials-ready"


class BrokerCapabilityRead(BaseModel):
    accounts: bool = False
    incremental_sync: bool = False
    orders: bool = False
    fills: bool = False
    live_connectivity: bool = False


class BrokerProviderRead(BaseModel):
    provider_id: str
    display_name: str
    availability: Literal["offline-fixture", "available", "unconfigured", "planned"]
    capabilities: BrokerCapabilityRead
    requires_secret: bool
    description: str


class BrokerConnectionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str = Field(
        min_length=1,
        max_length=64,
        pattern=r"^[A-Za-z][A-Za-z0-9_-]{0,63}$",
    )
    display_name: str = Field(min_length=1, max_length=120)
    secret_id: int = Field(gt=0)

    @field_validator("provider")
    @classmethod
    def normalize_provider(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Connection name cannot be empty")
        return normalized


class BrokerConnectionRead(BaseModel):
    id: int
    provider: str
    display_name: str
    secret_id: int
    status: Literal["READY", "SYNCING", "HEALTHY", "DEGRADED", "ERROR", "REVOKED"]
    health: Literal["UNKNOWN", "HEALTHY", "DEGRADED", "ERROR"]
    last_error_code: str | None = None
    last_error_message: str | None = None
    last_sync_started_at: datetime | None = None
    last_sync_completed_at: datetime | None = None
    next_retry_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    revoked_at: datetime | None = None


class BrokerAccountRead(BaseModel):
    id: int
    connection_id: int
    external_account_id: str
    display_name: str
    currency: str
    status: str
    created_at: datetime
    updated_at: datetime


class BrokerOrderRead(BaseModel):
    id: int
    connection_id: int
    account_id: int
    external_order_id: str
    symbol: str
    side: Literal["BUY", "SELL"]
    order_type: str
    status: str
    quantity: Decimal
    filled_quantity: Decimal
    average_fill_price: Decimal | None = None
    commission_total: Decimal
    fees_total: Decimal
    source_revision: int
    placed_at: datetime
    provider_updated_at: datetime
    cancelled_at: datetime | None = None


class BrokerFillRead(BaseModel):
    id: int
    connection_id: int
    account_id: int
    order_id: int | None = None
    external_fill_id: str
    external_order_id: str
    symbol: str
    side: Literal["BUY", "SELL"]
    quantity: Decimal
    price: Decimal
    commission: Decimal
    fees: Decimal
    source_revision: int
    cancelled: bool
    executed_at: datetime
    provider_updated_at: datetime


class BrokerPositionRead(BaseModel):
    id: int
    connection_id: int
    account_id: int
    symbol: str
    signed_quantity: Decimal
    average_entry_price: Decimal | None = None
    open_costs: Decimal
    realized_gross_pnl: Decimal
    realized_costs: Decimal
    realized_net_pnl: Decimal
    fill_count: int
    reconciliation_hash: str
    last_fill_at: datetime | None = None
    updated_at: datetime


class BrokerSyncRefreshRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_attempts: int = Field(default=3, ge=1, le=5)


class BrokerSyncJobRead(BaseModel):
    id: int
    connection_id: int
    status: Literal["QUEUED", "RUNNING", "SUCCEEDED", "RETRYING", "DEAD_LETTER"]
    attempt: int
    max_attempts: int
    cursor_before: str | None = None
    cursor_after: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    stats: dict[str, int] = Field(default_factory=dict)
    started_at: datetime | None = None
    finished_at: datetime | None = None
    next_retry_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class BrokerAuditRead(BaseModel):
    id: int
    connection_id: int | None = None
    job_id: int | None = None
    provider: str
    action: str
    outcome: str
    details: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class FeedbackCreate(BaseModel):
    category: FeedbackCategory = "OTHER"
    message: str = Field(min_length=10, max_length=4000)
    context: dict[str, Any] | None = None

    @model_validator(mode="after")
    def normalize_message(self):
        self.message = self.message.strip()
        if len(self.message) < 10:
            raise ValueError("Feedback message must be at least 10 characters")
        return self


class FeedbackRead(BaseModel):
    id: int
    category: FeedbackCategory
    message: str
    status: FeedbackStatus = "NEW"
    created_at: datetime


class AppDataBundle(BaseModel):
    model_config = ConfigDict(extra="forbid")
    app: Literal["edgelab"]
    version: int = Field(strict=True, ge=1, le=1)
    exported_at: datetime | None = None
    tables: dict[str, list[dict[str, Any]]]


class AppDataImportResult(BaseModel):
    ok: bool = True
    imported_at: datetime
    summary: dict[str, int] = Field(default_factory=dict)


class AppDataOperationReserve(BaseModel):
    model_config = ConfigDict(extra="forbid")

    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"]
    path: StrictStr = Field(min_length=1, max_length=512)


class AppDataOperationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    operation_id: UUID4
    method: str | None
    path: str | None
    status: Literal["reserved", "running", "completed", "canceled"]
    http_status: int | None
    result: AppDataImportResult | None
    created_at: datetime
    completed_at: datetime | None


def share_field_alias(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class WorkspaceShareStrictModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=share_field_alias,
        allow_inf_nan=False,
        extra="forbid",
        populate_by_name=True,
    )


class WorkspaceShareCandle(WorkspaceShareStrictModel):
    time: int
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0


class WorkspaceShareIndicatorSettings(WorkspaceShareStrictModel):
    color: str = Field(default="#32D3EE", pattern=r"^#[0-9A-Fa-f]{6}$")
    period: int = Field(default=20, ge=1, le=10_000)
    fill_opacity: float | None = Field(default=None, ge=0, le=1)
    std_dev: float | None = Field(default=None, ge=0, le=100)
    fast_period: int | None = Field(default=None, ge=1, le=10_000)
    slow_period: int | None = Field(default=None, ge=1, le=10_000)
    signal_period: int | None = Field(default=None, ge=1, le=10_000)
    secondary_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    signal_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    show_labels: bool | None = None
    unmitigated_only: bool | None = None
    histogram_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    line_style: Literal["solid", "dashed", "dotted"] | None = None
    line_width: float | None = Field(default=None, ge=1, le=8)


class WorkspaceShareIndicator(WorkspaceShareStrictModel):
    id: str = Field(min_length=1, max_length=96)
    kind: Literal[
        "atr",
        "bar-delta",
        "bb",
        "cumulative-delta",
        "dema",
        "donchian",
        "ema",
        "fvg",
        "hma",
        "ifvg",
        "keltner",
        "macd",
        "momentum",
        "order-flow-imbalance",
        "rsi",
        "sma",
        "supertrend",
        "tema",
        "vwap",
        "wma",
    ]
    settings: WorkspaceShareIndicatorSettings = Field(
        default_factory=WorkspaceShareIndicatorSettings
    )
    visible: bool = True
    created_at: str | None = Field(default=None, max_length=64)


class WorkspaceShareDrawingPoint(WorkspaceShareStrictModel):
    logical: float | None = None
    time: float
    price: float


class WorkspaceShareFibLevel(WorkspaceShareStrictModel):
    id: str = Field(min_length=1, max_length=64)
    value: float
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    background_opacity: float | None = Field(default=None, ge=0, le=1)
    label: str | None = Field(default=None, max_length=80)
    line_style: Literal["solid", "dashed", "dotted"] | None = None
    visible: bool = True


class WorkspaceShareDrawing(WorkspaceShareStrictModel):
    id: str = Field(min_length=1, max_length=96)
    tool: Literal[
        "trendline",
        "horizontal",
        "vertical",
        "rectangle",
        "fib",
        "measure",
        "longPosition",
        "shortPosition",
        "text",
    ]
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    points: list[WorkspaceShareDrawingPoint] = Field(min_length=1, max_length=64)
    created_at: str = Field(min_length=1, max_length=64)
    fib_extend_left: bool | None = None
    fib_extend_right: bool | None = None
    fib_levels: list[WorkspaceShareFibLevel] = Field(default_factory=list, max_length=32)
    fill_opacity: float | None = Field(default=None, ge=0, le=1)
    line_style: Literal["solid", "dashed", "dotted"] | None = None
    line_width: float | None = Field(default=None, ge=1, le=8)
    locked: bool = False
    reward_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    risk_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    label: str | None = Field(default=None, max_length=160)
    label_background_opacity: float | None = Field(default=None, ge=0, le=1)
    visible: bool = True


class WorkspaceShareChartSettings(WorkspaceShareStrictModel):
    background_color: str = Field(default="#070B10", pattern=r"^#[0-9A-Fa-f]{6}$")
    bar_change_values: bool = True
    body_down_color: str = Field(default="#EF4444", pattern=r"^#[0-9A-Fa-f]{6}$")
    body_up_color: str = Field(default="#22C55E", pattern=r"^#[0-9A-Fa-f]{6}$")
    body_visible: bool = True
    border_down_color: str = Field(default="#EF4444", pattern=r"^#[0-9A-Fa-f]{6}$")
    border_up_color: str = Field(default="#22C55E", pattern=r"^#[0-9A-Fa-f]{6}$")
    border_visible: bool = True
    candle_down_color: str = Field(default="#EF4444", pattern=r"^#[0-9A-Fa-f]{6}$")
    candle_up_color: str = Field(default="#22C55E", pattern=r"^#[0-9A-Fa-f]{6}$")
    chart_values: bool = True
    closed_session_shading: bool = True
    color_bars_by_previous_close: bool = False
    crosshair_color: str = Field(default="#748094", pattern=r"^#[0-9A-Fa-f]{6}$")
    crosshair_visible: bool = True
    date_format: Literal["dd MMM yy", "MMM dd yyyy", "yyyy-MM-dd"] = "dd MMM yy"
    day_of_week_labels: bool = True
    footprint_alignment: Literal["left", "center", "right"] = "center"
    footprint_ask_color: str = Field(default="#22C55E", pattern=r"^#[0-9A-Fa-f]{6}$")
    footprint_bid_color: str = Field(default="#EF4444", pattern=r"^#[0-9A-Fa-f]{6}$")
    footprint_display_mode: Literal[
        "bid-ask", "volume-profile", "delta-profile", "absolute-delta"
    ] = "bid-ask"
    footprint_imbalance_ratio: int = Field(default=3, ge=2, le=10)
    footprint_neutral_color: str = Field(default="#748094", pattern=r"^#[0-9A-Fa-f]{6}$")
    footprint_show_average_trade_size: bool = False
    footprint_show_imbalances: bool = True
    footprint_show_stats: bool = True
    footprint_show_unfinished_auctions: bool = True
    footprint_stacked_imbalance_count: int = Field(default=3, ge=2, le=6)
    footprint_stats_metric: Literal[
        "volume", "delta", "trades", "average-size"
    ] = "delta"
    grid_color: str = Field(default="#1E293B", pattern=r"^#[0-9A-Fa-f]{6}$")
    grid_mode: Literal["both", "horizontal", "none", "vertical"] = "both"
    high_low_labels: Literal["hidden", "value", "valueLine"] = "hidden"
    indicator_titles: bool = True
    indicator_values: bool = True
    no_overlapping_labels: bool = True
    order_flow_template: Literal["classic", "delta", "high-contrast"] = "classic"
    previous_day_close: Literal["hidden", "value", "valueLine"] = "hidden"
    post_market_shading: bool = True
    pre_market_shading: bool = True
    price_precision: int = Field(default=5, ge=0, le=8)
    price_scale_border_visible: bool = True
    scale_placement: Literal["auto", "left", "right"] = "right"
    session_break_color: str = Field(default="#38BDF8", pattern=r"^#[0-9A-Fa-f]{6}$")
    session_break_line_style: Literal["solid", "dashed", "dotted"] = "dashed"
    session_break_line_width: int = Field(default=1, ge=1, le=8)
    session_breaks: bool = False
    session_template: Literal[
        "auto",
        "always-open",
        "crypto-24x7",
        "forex-24x5",
        "us-equity",
        "cme-futures",
        "eurex-futures",
        "nse-equity",
        "lse-equity",
        "tse-equity",
    ] = "auto"
    symbol_line: Literal["hidden", "value", "valueLine"] = "valueLine"
    text_color: str = Field(default="#F0F2F5", pattern=r"^#[0-9A-Fa-f]{6}$")
    text_size: int = Field(default=12, ge=10, le=18)
    time_scale_border_visible: bool = True
    time_hours_format: Literal["12-hour", "24-hour"] = "24-hour"
    time_zone: str = Field(default="UTC", min_length=1, max_length=80)
    title: bool = True
    tpo_bracket_minutes: int = Field(default=30, ge=5, le=240)
    tpo_show_point_of_control: bool = True
    tpo_show_value_area: bool = True
    tpo_value_area_percent: int = Field(default=70, ge=50, le=95)
    trading_hours_mode: Literal["regular", "extended"] = "extended"
    volume: bool = True
    watermark: Literal["hidden", "symbol", "text"] = "hidden"
    watermark_text: str = Field(default="EdgeLab", max_length=80)
    wick_down_color: str = Field(default="#EF4444", pattern=r"^#[0-9A-Fa-f]{6}$")
    wick_up_color: str = Field(default="#22C55E", pattern=r"^#[0-9A-Fa-f]{6}$")
    wick_visible: bool = True

    @field_validator("time_zone")
    @classmethod
    def validate_time_zone(cls, value: str) -> str:
        normalized = value.strip()
        try:
            ZoneInfo(normalized)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("timeZone must be a valid IANA timezone") from exc
        return normalized


class WorkspaceShareChartPane(WorkspaceShareStrictModel):
    id: str = Field(min_length=1, max_length=80)
    timeframe: str = Field(min_length=1, max_length=20)
    chart_style: Literal[
        "area", "candles", "footprint", "heikinAshi", "line", "tpo"
    ] = "candles"
    chart_settings: WorkspaceShareChartSettings = Field(
        default_factory=WorkspaceShareChartSettings
    )
    drawing_tool: Literal["cursor", "crosshair"] = "crosshair"
    drawings: list[WorkspaceShareDrawing] = Field(default_factory=list, max_length=500)
    indicator_instances: list[WorkspaceShareIndicator] = Field(default_factory=list, max_length=64)
    magnet_mode: Literal["off", "weak", "strong"] = "off"
    smooth_candles: bool = False


class WorkspaceShareChart(WorkspaceShareStrictModel):
    symbol: str = Field(min_length=1, max_length=40)
    timeframe: str = Field(min_length=1, max_length=20)
    pane_layout: Literal[
        "single",
        "vertical-2",
        "horizontal-2",
        "grid-4",
        "grid-6",
        "grid-9",
        "grid-12",
        "grid-16",
    ] = "single"
    active_pane_id: str | None = Field(default=None, max_length=80)
    panes: list[WorkspaceShareChartPane] = Field(min_length=1, max_length=16)
    candles: list[WorkspaceShareCandle] = Field(default_factory=list, max_length=500)
    current_timestamp: datetime | None = None


class WorkspaceShareMetrics(WorkspaceShareStrictModel):
    net_pnl: float = 0.0
    win_rate: float = Field(default=0.0, ge=0, le=100)
    total_trades: int = Field(default=0, ge=0)
    winning_trades: int = Field(default=0, ge=0)
    breakeven_trades: int = Field(default=0, ge=0)
    profit_factor: float | None = Field(default=None, ge=0)
    max_drawdown: float = Field(default=0.0, ge=0)
    average_r: float | None = None
    expectancy: float | None = None


class WorkspaceSharePanels(WorkspaceShareStrictModel):
    active_panel: Literal["none", "review", "results"] = "none"
    panel_order: list[Literal["review", "results"]] = Field(
        default_factory=lambda: ["review", "results"],
        max_length=2,
    )
    metrics: WorkspaceShareMetrics = Field(default_factory=WorkspaceShareMetrics)


class WorkspaceShareWorkspace(WorkspaceShareStrictModel):
    layout_name: str = Field(min_length=1, max_length=48)
    active_view: Literal["backtest"] = "backtest"
    sidebar_collapsed: bool = False
    timezone: str | None = Field(default=None, max_length=80)
    pane_layout: Literal[
        "single",
        "vertical-2",
        "horizontal-2",
        "grid-4",
        "grid-6",
        "grid-9",
        "grid-12",
        "grid-16",
    ] = "single"


class WorkspaceSharePayload(WorkspaceShareStrictModel):
    schema_version: Literal[1] = 1
    chart: WorkspaceShareChart | None = None
    panels: WorkspaceSharePanels | None = None
    workspace: WorkspaceShareWorkspace | None = None


class WorkspaceShareCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workspace_key: str = Field(
        min_length=1,
        max_length=96,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
    )
    title: str = Field(min_length=1, max_length=160)
    scope: WorkspaceShareScope
    recipient_email: str | None = Field(
        default=None,
        max_length=320,
        pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
    )
    expires_at: datetime | None = None
    payload: WorkspaceSharePayload

    @field_validator("recipient_email", mode="before")
    @classmethod
    def normalize_recipient_email(cls, value):
        if value is None:
            return None
        normalized = str(value).strip().lower()
        return normalized or None

    @model_validator(mode="after")
    def validate_scope_payload(self) -> "WorkspaceShareCreate":
        self.workspace_key = self.workspace_key.strip()
        self.title = self.title.strip()
        if not self.title:
            raise ValueError("Share title cannot be empty")

        required = {
            "chart-plus-panels": (True, True, False),
            "panels-only": (False, True, False),
            "complete-workspace": (True, True, True),
        }[self.scope]
        actual = (
            self.payload.chart is not None,
            self.payload.panels is not None,
            self.payload.workspace is not None,
        )
        if actual != required:
            raise ValueError(f"Payload does not match {self.scope} share scope")
        return self


class WorkspaceShareOwnerRead(BaseModel):
    id: int
    workspace_key: str
    snapshot_version: int
    schema_version: int
    scope: WorkspaceShareScope
    title: str
    payload_available: bool
    recipient_email: str | None = None
    created_at: datetime
    expires_at: datetime | None = None
    revoked_at: datetime | None = None


class WorkspaceShareCreatedRead(WorkspaceShareOwnerRead):
    public_token: str


class WorkspaceSharePublicRead(BaseModel):
    snapshot_version: int
    schema_version: int
    scope: WorkspaceShareScope
    title: str
    created_at: datetime
    expires_at: datetime | None = None
    payload: WorkspaceSharePayload


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
    dev_auth_bypass_enabled: bool = False


class UiRolloutConfig(BaseModel):
    """Server-owned route-group flags with one emergency fallback."""

    revision: str = "v2"
    kill_switch: bool = False
    flags: dict[str, bool] = Field(default_factory=dict)


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
    replay_ready: bool = False
    initial_balance: float
    realized_pnl: float
    default_commission_mode: CommissionMode = "NONE"
    default_commission_value: float = 0.0
    default_fee_mode: CommissionMode = "NONE"
    default_fee_value: float = 0.0
    created_at: datetime
    updated_at: datetime


class StrategySummaryAggregate(BaseModel):
    closed_trades: int = 0
    winning_trades: int = 0
    net_pnl: float = 0.0
    gross_profit: float = 0.0
    gross_loss: float = 0.0
    win_rate: float = 0.0
    average_r: float | None = None
    profit_factor: float | None = None
    r_sum: float = 0.0
    r_samples: int = 0


class StrategySummarySession(BaseModel):
    session: BacktestSessionRead
    aggregate: StrategySummaryAggregate


class StrategySummary(BaseModel):
    name: str
    aggregate: StrategySummaryAggregate
    sessions: list[StrategySummarySession]


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


class JournalAccountCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=160)
    provider: str = Field(default="Manual", min_length=1, max_length=80)
    currency: str = Field(default="USD", min_length=3, max_length=12)
    timezone: str = Field(default="UTC", min_length=1, max_length=80)
    initial_balance: Decimal = Field(default=Decimal("0"), ge=0)
    color: str | None = Field(default=None, max_length=32)
    notes: str | None = None
    broker_account_id: int | None = Field(default=None, gt=0)

    @field_validator("name", "provider")
    @classmethod
    def normalize_required_text(cls, value: str) -> str:
        clean = " ".join(value.strip().split())
        if not clean:
            raise ValueError("value cannot be blank")
        return clean

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        clean = value.strip()
        try:
            ZoneInfo(clean)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"Unknown timezone '{clean}'") from exc
        return clean

    @field_validator("currency")
    @classmethod
    def normalize_currency(cls, value: str) -> str:
        clean = value.strip().upper()
        if not clean.isalnum():
            raise ValueError("currency must contain only letters and numbers")
        return clean


class JournalAccountRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    broker_account_id: int | None
    source_type: str
    source_key: str
    name: str
    provider: str
    currency: str
    timezone: str
    initial_balance: Decimal
    color: str | None
    notes: str | None
    status: Literal["ACTIVE", "ARCHIVED"]
    created_at: datetime
    updated_at: datetime


class JournalTagCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: JournalTagCategory
    name: str = Field(min_length=1, max_length=80)
    color: str | None = Field(default=None, max_length=32)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        clean = " ".join(value.strip().split())
        if not clean:
            raise ValueError("name cannot be blank")
        return clean


class JournalTagRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    category: JournalTagCategory
    name: str
    color: str | None
    archived_at: datetime | None
    created_at: datetime


class CanonicalExecutionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_ref: str | None = Field(default=None, max_length=240)
    execution_type: Literal["ENTRY", "EXIT", "FILL"] = "FILL"
    side: OrderSide
    occurred_at: datetime
    price: Decimal = Field(gt=0)
    quantity: Decimal = Field(gt=0)
    commission: Decimal = Field(default=Decimal("0"), ge=0)
    fees: Decimal = Field(default=Decimal("0"), ge=0)
    source_revision: int = Field(default=1, ge=1)
    raw_payload: dict[str, Any] = Field(default_factory=dict)


class CanonicalExecutionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source_type: str
    source_ref: str
    execution_type: str
    side: OrderSide
    occurred_at: datetime
    price: Decimal
    quantity: Decimal
    commission: Decimal
    fees: Decimal
    sequence: int
    source_revision: int
    fingerprint: str
    raw_payload: dict[str, Any]
    created_at: datetime


class CanonicalTradeNoteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    body: str
    created_at: datetime


class CanonicalTradeScreenshotRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    url: str
    caption: str | None
    created_at: datetime


class CanonicalTradeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account_id: int = Field(gt=0)
    symbol: str = Field(min_length=1, max_length=120)
    currency: str | None = Field(default=None, min_length=3, max_length=12)
    source_timezone: str | None = Field(default=None, min_length=1, max_length=80)
    side: Literal["LONG", "SHORT"]
    entry_type: JournalEntryType = "TAKEN"
    entry_time: datetime
    exit_time: datetime | None = None
    entry_price: Decimal = Field(gt=0)
    exit_price: Decimal | None = Field(default=None, gt=0)
    quantity: Decimal = Field(ge=0)
    remaining_quantity: Decimal | None = Field(default=None, ge=0)
    gross_pnl: Decimal | None = None
    net_pnl: Decimal | None = None
    commission: Decimal = Field(default=Decimal("0"), ge=0)
    fees: Decimal = Field(default=Decimal("0"), ge=0)
    stop_loss: Decimal | None = Field(default=None, gt=0)
    take_profit: Decimal | None = Field(default=None, gt=0)
    planned_entry_price: Decimal | None = Field(default=None, gt=0)
    planned_exit_price: Decimal | None = Field(default=None, gt=0)
    planned_stop_loss: Decimal | None = Field(default=None, gt=0)
    planned_take_profit: Decimal | None = Field(default=None, gt=0)
    r_multiple: Decimal | None = None
    strategy_name: str | None = Field(default=None, max_length=120)
    emotional_state: str | None = Field(default=None, max_length=80)
    missed_reason: str | None = None
    rating: int | None = Field(default=None, ge=1, le=5)
    setup_grade: SetupGrade | None = None
    reviewed: bool = False
    tag_ids: list[int] = Field(default_factory=list)
    note: str | None = None
    screenshot_urls: list[str] = Field(default_factory=list, max_length=12)
    executions: list[CanonicalExecutionCreate] = Field(default_factory=list, max_length=500)

    @model_validator(mode="after")
    def validate_trade(self) -> "CanonicalTradeCreate":
        if self.entry_type == "TAKEN" and self.quantity <= 0:
            raise ValueError("taken trades require quantity greater than zero")
        if self.remaining_quantity is not None and self.remaining_quantity > self.quantity:
            raise ValueError("remaining_quantity cannot exceed quantity")
        if self.exit_time is not None:
            try:
                if self.exit_time < self.entry_time:
                    raise ValueError("exit_time cannot precede entry_time")
            except TypeError:
                pass
        if self.exit_price is not None and self.exit_time is None:
            raise ValueError("exit_price requires exit_time")
        if self.entry_type == "MISSED" and not (self.missed_reason or self.note):
            raise ValueError("missed entries require missed_reason or note")
        if len(set(self.tag_ids)) != len(self.tag_ids):
            raise ValueError("tag_ids must not contain duplicates")
        return self


class CanonicalTradeReviewUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reviewed: bool | None = None
    rating: int | None = Field(default=None, ge=1, le=5)
    setup_grade: SetupGrade | None = None
    tag_ids: list[int] | None = None
    entry_time: datetime | None = None
    exit_time: datetime | None = None
    entry_price: Decimal | None = Field(default=None, gt=0)
    exit_price: Decimal | None = Field(default=None, gt=0)
    stop_loss: Decimal | None = Field(default=None, gt=0)
    take_profit: Decimal | None = Field(default=None, gt=0)
    strategy_name: str | None = Field(default=None, max_length=120)
    emotional_state: str | None = Field(default=None, max_length=80)
    note: str | None = None
    screenshot_urls: list[str] | None = Field(default=None, max_length=12)

    @field_validator("tag_ids")
    @classmethod
    def unique_tag_ids(cls, value: list[int] | None) -> list[int] | None:
        if value is not None and len(set(value)) != len(value):
            raise ValueError("tag_ids must not contain duplicates")
        return value


class CanonicalTradeRead(BaseModel):
    id: int
    account_id: int
    import_run_id: int | None
    source_type: JournalTradeSource
    source_ref: str
    duplicate_key: str
    entry_type: JournalEntryType
    status: JournalTradeStatus
    symbol: str
    source_symbol: str | None
    currency: str
    source_timezone: str
    side: Literal["LONG", "SHORT"]
    entry_time: datetime
    exit_time: datetime | None
    entry_price: Decimal
    exit_price: Decimal | None
    quantity: Decimal
    remaining_quantity: Decimal
    gross_pnl: Decimal
    net_pnl: Decimal
    commission: Decimal
    fees: Decimal
    stop_loss: Decimal | None
    take_profit: Decimal | None
    planned_entry_price: Decimal | None
    planned_exit_price: Decimal | None
    planned_stop_loss: Decimal | None
    planned_take_profit: Decimal | None
    r_multiple: Decimal | None
    strategy_name: str | None
    emotional_state: str | None
    missed_reason: str | None
    rating: int | None
    setup_grade: SetupGrade | None
    reviewed: bool
    reviewed_at: datetime | None
    created_at: datetime
    updated_at: datetime
    tags: list[JournalTagRead] = Field(default_factory=list)
    notes: list[CanonicalTradeNoteRead] = Field(default_factory=list)
    screenshots: list[CanonicalTradeScreenshotRead] = Field(default_factory=list)
    executions: list[CanonicalExecutionRead] = Field(default_factory=list)


class JournalDailyNoteUpsert(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account_id: int | None = Field(default=None, gt=0)
    body: str = Field(max_length=200_000)


class JournalDailyNoteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    account_id: int | None
    note_date: date
    body: str
    created_at: datetime
    updated_at: datetime


class JournalImportGrouping(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["ROW", "COLUMN"] = "ROW"
    column: str | None = Field(default=None, max_length=160)

    @model_validator(mode="after")
    def validate_grouping(self) -> "JournalImportGrouping":
        if self.mode == "COLUMN" and not (self.column and self.column.strip()):
            raise ValueError("COLUMN grouping requires a column")
        return self


class JournalImportCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    csv_text: str = Field(min_length=1, max_length=20_000_000)
    destination_account_id: int | None = Field(default=None, gt=0)
    destination_account: JournalAccountCreate | None = None
    source_name: str = Field(default="CSV import", min_length=1, max_length=160)
    source_timezone: str = Field(default="UTC", min_length=1, max_length=80)
    currency: str | None = Field(default=None, min_length=3, max_length=12)
    default_symbol: str | None = Field(default=None, max_length=120)
    strategy_name: str | None = Field(default=None, max_length=120)
    default_commission_mode: CommissionMode = "NONE"
    default_commission_value: float = Field(default=0, ge=0)
    default_fee_mode: CommissionMode = "NONE"
    default_fee_value: float = Field(default=0, ge=0)
    column_mapping: dict[str, str] = Field(default_factory=dict)
    grouping: JournalImportGrouping = Field(default_factory=JournalImportGrouping)

    @model_validator(mode="after")
    def validate_import(self) -> "JournalImportCreate":
        if (self.destination_account_id is None) == (self.destination_account is None):
            raise ValueError("provide exactly one destination_account_id or destination_account")
        try:
            ZoneInfo(self.source_timezone)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"Unknown timezone '{self.source_timezone}'") from exc
        return self


class JournalImportRowRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    row_number: int
    group_key: str
    status: Literal["IMPORTED", "SKIPPED", "DUPLICATE", "ERROR", "ROLLED_BACK"]
    duplicate_key: str | None
    trade_id: int | None
    source_fingerprint: str
    normalized_payload: dict[str, Any] | None


class JournalImportDiagnosticRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    row_number: int | None
    severity: Literal["INFO", "WARNING", "ERROR"]
    code: str
    field: str | None
    message: str


class JournalImportRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    account_id: int
    source_name: str
    source_digest: str
    status: Literal["RUNNING", "COMPLETED", "FAILED", "ROLLED_BACK"]
    source_timezone: str
    currency: str
    default_symbol: str | None
    column_mapping: dict[str, str]
    grouping: dict[str, Any]
    detected_columns: list[str]
    total_rows: int
    imported_rows: int
    skipped_rows: int
    duplicate_rows: int
    error_rows: int
    created_at: datetime
    completed_at: datetime | None
    rolled_back_at: datetime | None
    rows: list[JournalImportRowRead] = Field(default_factory=list)
    diagnostics: list[JournalImportDiagnosticRead] = Field(default_factory=list)


class JournalImportResult(BaseModel):
    run: JournalImportRunRead
    trades: list[CanonicalTradeRead] = Field(default_factory=list)


class JournalBackfillResult(BaseModel):
    accounts_created: int = 0
    trades_created: int = 0
    executions_created: int = 0
    notes_created: int = 0
    screenshots_created: int = 0
    tags_created: int = 0
    sources_unchanged: int = 0
    diagnostics: list[str] = Field(default_factory=list)


MarketAssetClass = Literal[
    "CRYPTO", "EQUITY", "ETF", "FOREX", "INDEX", "COMMODITY", "FUTURE", "OPTION", "DERIVATIVE"
]
MarketCapability = Literal["CANDLES", "TRADES", "DEPTH", "FOOTPRINT"]


class ExchangeSessionTemplate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=40)
    weekdays: list[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4], min_length=1)
    opens_at: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    closes_at: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    crosses_midnight: bool = False

    @field_validator("weekdays")
    @classmethod
    def validate_weekdays(cls, value: list[int]) -> list[int]:
        if any(day < 0 or day > 6 for day in value):
            raise ValueError("weekdays must contain values from 0 (Monday) through 6 (Sunday)")
        return sorted(set(value))


class ExchangeCalendarCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, max_length=48)
    exchange: str = Field(min_length=1, max_length=80)
    timezone: str = Field(min_length=1, max_length=80)
    holidays: list[date] = Field(default_factory=list)
    session_templates: list[ExchangeSessionTemplate] = Field(min_length=1)

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"Unknown timezone '{value}'") from exc
        return value


class ExchangeCalendarRead(BaseModel):
    id: int
    code: str
    exchange: str
    timezone: str
    weekmask: str
    holidays: list[str]
    session_templates: list[ExchangeSessionTemplate]
    version: int
    created_at: datetime
    updated_at: datetime


class MarketIdentifierCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str = Field(min_length=1, max_length=64)
    provider_symbol: str = Field(min_length=1, max_length=160)
    metadata: dict[str, Any] = Field(default_factory=dict)


class MarketIdentifierRead(BaseModel):
    id: int
    provider: str
    provider_symbol: str
    metadata: dict[str, Any]


class MarketInstrumentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    canonical_symbol: str = Field(min_length=1, max_length=96)
    display_name: str = Field(min_length=1, max_length=160)
    asset_class: MarketAssetClass
    instrument_type: str = Field(min_length=1, max_length=32)
    exchange: str | None = Field(default=None, max_length=80)
    base_asset: str | None = Field(default=None, max_length=32)
    quote_asset: str | None = Field(default=None, max_length=32)
    currency: str = Field(default="USD", min_length=3, max_length=12)
    timezone: str = Field(default="UTC", min_length=1, max_length=80)
    calendar_id: int | None = Field(default=None, gt=0)
    tick_size: Decimal = Field(gt=0)
    tick_value: Decimal = Field(gt=0)
    contract_multiplier: Decimal = Field(default=Decimal("1"), gt=0)
    continuous: bool = False
    identifiers: list[MarketIdentifierCreate] = Field(default_factory=list, max_length=20)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"Unknown timezone '{value}'") from exc
        return value


class MarketInstrumentRead(BaseModel):
    id: int
    canonical_symbol: str
    display_name: str
    asset_class: MarketAssetClass
    instrument_type: str
    exchange: str | None
    base_asset: str | None
    quote_asset: str | None
    currency: str
    timezone: str
    calendar_id: int | None
    tick_size: Decimal
    tick_value: Decimal
    contract_multiplier: Decimal
    continuous: bool
    active: bool
    metadata: dict[str, Any]
    identifiers: list[MarketIdentifierRead] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class MarketContractCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_symbol: str = Field(min_length=1, max_length=96)
    provider: str = Field(min_length=1, max_length=64)
    provider_symbol: str = Field(min_length=1, max_length=160)
    expires_on: date
    first_notice_on: date | None = None
    last_trade_on: date | None = None
    roll_on: date | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class MarketContractRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    instrument_id: int
    contract_symbol: str
    provider: str
    provider_symbol: str
    expires_on: date
    first_notice_on: date | None
    last_trade_on: date | None
    roll_on: date | None
    status: str
    metadata_json: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class ContinuousContractRuleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    method: Literal["CALENDAR", "VOLUME", "OPEN_INTEREST"] = "CALENDAR"
    days_before_expiry: int = Field(default=5, ge=0, le=60)
    adjustment: Literal["NONE", "DIFFERENCE", "RATIO"] = "NONE"


class ContinuousContractRuleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    instrument_id: int
    method: str
    days_before_expiry: int
    adjustment: str
    active_contract_id: int | None
    next_contract_id: int | None
    last_evaluated_at: datetime | None
    created_at: datetime
    updated_at: datetime


class MarketProviderRead(BaseModel):
    provider_id: str
    display_name: str
    availability: Literal["AVAILABLE_OFFLINE", "UNAVAILABLE", "CONFIGURATION_REQUIRED"]
    capabilities: list[MarketCapability]
    asset_classes: list[MarketAssetClass]
    live: bool
    licensed: bool
    message: str


class MarketEntitlementRead(BaseModel):
    asset_class: MarketAssetClass
    capability: MarketCapability
    allowed: bool
    tier: Literal["FREE", "PAID", "UNAVAILABLE"]
    reason: str
    expires_at: datetime | None = None


class MarketProviderStateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    provider: str
    instrument_id: int | None
    availability: str
    health: str
    licensed: bool
    capabilities: list[str]
    last_sequence: int | None
    last_exchange_timestamp: datetime | None
    last_heartbeat_at: datetime | None
    stale_after_seconds: int
    reconnect_count: int
    gap_count: int
    incomplete: bool
    error_code: str | None
    error_message: str | None
    updated_at: datetime


class MarketDiagnosticRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    provider: str
    instrument_id: int | None
    code: str
    severity: str
    state: str
    message: str
    recovery_action: str | None
    details: dict[str, Any]
    created_at: datetime
    resolved_at: datetime | None


class NormalizedCandleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    instrument_id: int
    contract_id: int | None
    provider: str
    interval_seconds: int
    start_at: datetime
    end_at: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal
    sequence_start: int | None
    sequence_end: int | None
    source_revision: int
    complete: bool


class MarketTradeTickRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    instrument_id: int
    contract_id: int | None
    provider: str
    external_trade_id: str
    source_revision: int
    sequence: int
    exchange_timestamp: datetime
    received_timestamp: datetime
    price: Decimal
    size: Decimal
    aggressor_side: Literal["BID", "ASK", "UNKNOWN"]
    cancelled: bool


class FootprintLevelRead(BaseModel):
    price: Decimal
    bid_volume: Decimal
    ask_volume: Decimal
    unknown_volume: Decimal
    total_volume: Decimal
    delta: Decimal
    trade_count: int
    average_trade_size: Decimal


class FootprintRead(BaseModel):
    id: int
    instrument_id: int
    contract_id: int | None
    provider: str
    interval_seconds: int
    start_at: datetime
    end_at: datetime
    tick_size: Decimal
    bid_volume: Decimal
    ask_volume: Decimal
    unknown_volume: Decimal
    total_volume: Decimal
    delta: Decimal
    trade_count: int
    average_trade_size: Decimal
    complete: bool
    levels: list[FootprintLevelRead]


class FootprintBuildRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str = Field(default="offline-fixture", min_length=1, max_length=64)
    from_at: datetime
    to_at: datetime
    interval_seconds: int = Field(default=60, ge=1, le=86400)
    tick_size: Decimal | None = Field(default=None, gt=0)
    contract_id: int | None = Field(default=None, gt=0)
    include_empty: bool = False

    @model_validator(mode="after")
    def validate_window(self) -> "FootprintBuildRequest":
        start = self.from_at if self.from_at.tzinfo else self.from_at.replace(tzinfo=timezone.utc)
        end = self.to_at if self.to_at.tzinfo else self.to_at.replace(tzinfo=timezone.utc)
        if end.astimezone(timezone.utc) <= start.astimezone(timezone.utc):
            raise ValueError("to_at must be after from_at")
        return self


class OrderBookLevelInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    side: Literal["BID", "ASK"]
    price: Decimal = Field(gt=0)
    size: Decimal = Field(gt=0)
    order_count: int = Field(default=0, ge=0)


class OrderBookLevelRead(BaseModel):
    side: Literal["BID", "ASK"]
    price: Decimal
    size: Decimal
    order_count: int


class OrderBookRead(BaseModel):
    instrument_id: int
    contract_id: int | None
    provider: str | None
    sequence: int | None
    captured_at: datetime | None
    status: Literal["AVAILABLE", "STALE", "INCOMPLETE", "UNAVAILABLE", "ENTITLEMENT_REQUIRED"]
    aggregation_tick_size: Decimal
    levels: list[OrderBookLevelRead] = Field(default_factory=list)
    message: str | None = None


class MarketBackfillCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str = Field(default="offline-fixture", min_length=1, max_length=64)
    instrument_id: int = Field(gt=0)
    data_type: Literal["CANDLES", "TRADES", "DEPTH"]
    from_at: datetime
    to_at: datetime
    interval_seconds: int = Field(default=60, ge=1, le=86400)
    idempotency_key: str | None = Field(default=None, max_length=96)

    @model_validator(mode="after")
    def validate_window(self) -> "MarketBackfillCreate":
        start = self.from_at if self.from_at.tzinfo else self.from_at.replace(tzinfo=timezone.utc)
        end = self.to_at if self.to_at.tzinfo else self.to_at.replace(tzinfo=timezone.utc)
        if end.astimezone(timezone.utc) <= start.astimezone(timezone.utc):
            raise ValueError("to_at must be after from_at")
        return self


class MarketBackfillRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    idempotency_key: str
    provider: str
    instrument_id: int
    data_type: str
    from_at: datetime
    to_at: datetime
    status: str
    cursor: str | None
    received_count: int
    inserted_count: int
    duplicate_count: int
    gap_count: int
    error_code: str | None
    error_message: str | None
    created_at: datetime
    completed_at: datetime | None


class MarketAlertRuleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    instrument_id: int | None = Field(default=None, gt=0)
    name: str = Field(min_length=1, max_length=160)
    alert_type: Literal[
        "PRICE_ABOVE", "PRICE_BELOW", "PRICE_CROSSES_ABOVE", "PRICE_CROSSES_BELOW",
        "VOLUME_ABOVE", "DELTA_ABOVE", "DELTA_BELOW", "PROVIDER_STALE", "SEQUENCE_GAP"
    ]
    threshold: Decimal | None = None
    provider: str | None = Field(default=None, max_length=64)
    cooldown_seconds: int = Field(default=60, ge=0, le=86400)

    @model_validator(mode="after")
    def validate_condition(self) -> "MarketAlertRuleCreate":
        if self.alert_type not in {"PROVIDER_STALE", "SEQUENCE_GAP"} and self.threshold is None:
            raise ValueError("threshold is required for numeric alert types")
        return self


class MarketAlertRuleRead(BaseModel):
    id: int
    instrument_id: int | None
    name: str
    alert_type: str
    condition: dict[str, Any]
    enabled: bool
    cooldown_seconds: int
    last_value: Decimal | None
    last_evaluated_at: datetime | None
    last_triggered_at: datetime | None
    created_at: datetime
    updated_at: datetime


class MarketAlertEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    rule_id: int
    instrument_id: int | None
    observed_at: datetime
    observed_value: Decimal | None
    message: str
    payload: dict[str, Any]
    acknowledged_at: datetime | None
    created_at: datetime


class MarketSubscriptionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pane_id: str = Field(min_length=1, max_length=64)
    instrument_id: int = Field(gt=0)
    channels: list[Literal["CANDLES", "TRADES", "DEPTH", "FOOTPRINT", "DIAGNOSTICS"]] = Field(
        min_length=1, max_length=5
    )


class MarketSubscriptionRead(BaseModel):
    subscription_id: str
    pane_id: str
    instrument_id: int
    channels: list[str]
    queued_events: int
    dropped_events: int


class MarketStreamEventRead(BaseModel):
    sequence: int
    channel: str
    instrument_id: int
    occurred_at: datetime
    payload: dict[str, Any]


class QuantScriptCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    source: str = Field(min_length=2, max_length=65536)


class QuantScriptVersionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: str = Field(min_length=2, max_length=65536)
    parent_version_id: int | None = Field(default=None, gt=0)


class QuantScriptVersionRead(BaseModel):
    id: int
    script_id: int
    parent_version_id: int | None
    generation_job_id: int | None
    version: int
    dsl_version: int
    source: str
    source_hash: str
    created_by: str
    status: str
    validation_report: dict[str, Any]
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    created_at: datetime
    activated_at: datetime | None


class QuantScriptRead(BaseModel):
    id: int
    name: str
    slug: str
    description: str | None
    language: str
    visibility: str
    active_version_number: int | None
    status: str
    versions: list[QuantScriptVersionRead] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None


class QuantScriptPermissionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    grantee_user_id: int = Field(gt=0)
    permission: Literal["VIEW", "RUN", "EDIT"] = "VIEW"


class QuantScriptPermissionRead(BaseModel):
    id: int
    script_id: int
    grantee_user_id: int
    permission: str
    created_at: datetime
    revoked_at: datetime | None


class AIChartSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)


class AIChartContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str = Field(min_length=1, max_length=96)
    provider: str = Field(min_length=1, max_length=64)
    timeframe: str = Field(min_length=1, max_length=24)
    timezone: str = Field(default="UTC", min_length=1, max_length=80)
    visible_from: datetime | None = None
    visible_to: datetime | None = None
    history_bars: int = Field(default=0, ge=0, le=100000)
    session_mode: str = Field(default="ALL", max_length=32)
    active_indicators: list[dict[str, Any]] = Field(default_factory=list, max_length=64)
    settings: dict[str, Any] = Field(default_factory=dict)
    drawings: list[dict[str, Any]] = Field(default_factory=list, max_length=1000)
    selected_objects: list[str] = Field(default_factory=list, max_length=100)
    selected_region: AIChartSelection | None = None

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"Unknown timezone '{value}'") from exc
        return value


class AIChartImageMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    storage_ref: str = Field(min_length=1, max_length=500)
    sha256: str = Field(pattern=r"^[a-fA-F0-9]{64}$")
    mime_type: Literal["image/png", "image/jpeg", "image/webp"]
    width: int = Field(gt=0, le=16384)
    height: int = Field(gt=0, le=16384)
    byte_size: int = Field(gt=0, le=25 * 1024 * 1024)
    selected_region: AIChartSelection | None = None

    @field_validator("storage_ref")
    @classmethod
    def prevent_inline_image_data(cls, value: str) -> str:
        if value.lower().startswith(("data:", "http://", "https://")):
            raise ValueError("storage_ref must be an opaque server-managed reference, not image data or a URL")
        return value


class AIChartImageUpload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data_url: str = Field(min_length=32, max_length=6_000_000)
    width: int = Field(gt=0, le=16384)
    height: int = Field(gt=0, le=16384)
    selected_region: AIChartSelection | None = None


class AIConversationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["CHART_ANALYSIS", "INDICATOR_BUILD", "BACKTEST"]
    title: str = Field(min_length=1, max_length=160)
    retention_days: int = Field(default=30, ge=1, le=365)


class AIMessageRead(BaseModel):
    id: int
    conversation_id: int
    parent_message_id: int | None
    sequence: int
    role: str
    content: str
    content_digest: str
    chart_context: dict[str, Any]
    image_metadata: dict[str, Any]
    model_id: str | None
    created_at: datetime
    purged_at: datetime | None


class AIConversationRead(BaseModel):
    id: int
    kind: str
    title: str
    status: str
    retention_days: int
    retention_until: datetime
    messages: list[AIMessageRead] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


class AIModelRead(BaseModel):
    model_id: str
    display_name: str
    provider: str
    operations: list[str]
    input_token_cost_micros: int
    output_token_cost_micros: int
    max_output_tokens: int
    credential_required: bool
    adapter_configured: bool
    available: bool
    availability_reason: str


class AIAutoBacktestConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    instrument_id: int = Field(gt=0)
    interval_seconds: int = Field(ge=1, le=86400)
    from_at: datetime
    to_at: datetime
    entry_signal: str = Field(min_length=1, max_length=64)
    exit_signal: str | None = Field(default=None, max_length=64)
    position_size: Decimal = Field(default=Decimal("1"), gt=0, le=1_000_000)
    cost_per_trade: Decimal = Field(default=Decimal("0"), ge=0, le=1_000_000)

    @model_validator(mode="after")
    def validate_window(self) -> "AIAutoBacktestConfig":
        start = self.from_at if self.from_at.tzinfo else self.from_at.replace(tzinfo=timezone.utc)
        end = self.to_at if self.to_at.tzinfo else self.to_at.replace(tzinfo=timezone.utc)
        if end.astimezone(timezone.utc) <= start.astimezone(timezone.utc):
            raise ValueError("to_at must be after from_at")
        return self


class AIGenerationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_id: int = Field(gt=0)
    operation: Literal[
        "CHAT", "CHART_ANALYSIS", "GENERATE_INDICATOR", "EDIT_INDICATOR", "ANALYSIS_TO_INDICATOR"
    ]
    model_id: str = Field(min_length=1, max_length=96)
    prompt: str = Field(min_length=1, max_length=32000)
    chart_context: AIChartContext | None = None
    image: AIChartImageMetadata | None = None
    egress_consent: list[Literal["chart_context", "conversation_history", "chart_image"]] = Field(default_factory=list)
    script_id: int | None = Field(default=None, gt=0)
    base_version_id: int | None = Field(default=None, gt=0)
    prior_test_result: dict[str, Any] | None = None
    auto_backtest: AIAutoBacktestConfig | None = None
    max_output_tokens: int = Field(default=2048, ge=1, le=16384)
    hard_cost_ceiling_micros: int = Field(default=1_000_000, ge=0, le=10_000_000)
    idempotency_key: str | None = Field(default=None, max_length=96)

    @model_validator(mode="after")
    def validate_generation_context(self) -> "AIGenerationRequest":
        if self.operation == "EDIT_INDICATOR" and (self.script_id is None or self.base_version_id is None):
            raise ValueError("EDIT_INDICATOR requires script_id and base_version_id")
        if self.prior_test_result is not None and self.operation != "EDIT_INDICATOR":
            raise ValueError("prior_test_result is only valid for EDIT_INDICATOR")
        if self.operation == "CHART_ANALYSIS" and self.chart_context is None:
            raise ValueError("CHART_ANALYSIS requires structured chart_context")
        if self.image is not None and self.chart_context is None:
            raise ValueError("Image analysis requires structured chart_context")
        if self.auto_backtest is not None and self.operation not in {
            "GENERATE_INDICATOR", "EDIT_INDICATOR", "ANALYSIS_TO_INDICATOR"
        }:
            raise ValueError("auto_backtest is only valid for indicator-generation operations")
        return self


class AIGenerationJobRead(BaseModel):
    id: int
    conversation_id: int
    request_message_id: int
    operation: str
    model_id: str
    provider: str
    status: str
    estimated_input_tokens: int
    max_output_tokens: int
    estimated_cost_micros: int
    hard_cost_ceiling_micros: int
    actual_input_tokens: int | None
    actual_output_tokens: int | None
    actual_cost_micros: int | None
    cancel_requested_at: datetime | None
    started_at: datetime | None
    completed_at: datetime | None
    error_code: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime


class AIJobEventRead(BaseModel):
    id: int
    job_id: int
    sequence: int
    event_type: str
    payload: dict[str, Any]
    created_at: datetime


class AIGeneratedArtifactRead(BaseModel):
    id: int
    job_id: int
    conversation_id: int
    script_id: int | None
    script_version_id: int | None
    artifact_type: str
    content: dict[str, Any]
    content_digest: str
    provenance: dict[str, Any]
    created_at: datetime
    retention_until: datetime
    activated_at: datetime | None
    purged_at: datetime | None


class AIBacktestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    script_version_id: int = Field(gt=0)
    instrument_id: int = Field(gt=0)
    interval_seconds: int = Field(ge=1, le=86400)
    from_at: datetime
    to_at: datetime
    entry_signal: str = Field(min_length=1, max_length=64)
    exit_signal: str | None = Field(default=None, max_length=64)
    position_size: Decimal = Field(default=Decimal("1"), gt=0, le=1_000_000)
    cost_per_trade: Decimal = Field(default=Decimal("0"), ge=0, le=1_000_000)

    @model_validator(mode="after")
    def validate_window(self) -> "AIBacktestRequest":
        start = self.from_at if self.from_at.tzinfo else self.from_at.replace(tzinfo=timezone.utc)
        end = self.to_at if self.to_at.tzinfo else self.to_at.replace(tzinfo=timezone.utc)
        if end.astimezone(timezone.utc) <= start.astimezone(timezone.utc):
            raise ValueError("to_at must be after from_at")
        return self


class AIBacktestRead(BaseModel):
    id: int
    job_id: int | None
    artifact_id: int | None
    script_version_id: int
    instrument_id: int
    interval_seconds: int
    from_at: datetime
    to_at: datetime
    assumptions: dict[str, Any]
    metrics: dict[str, Any]
    warnings: list[str]
    reproducibility_hash: str
    status: str
    created_at: datetime
    completed_at: datetime | None


class AIUsageSummaryRead(BaseModel):
    period_start: datetime
    period_end: datetime
    jobs: int
    input_tokens: int
    output_tokens: int
    credits: int
    cost_micros: int
    job_limit: int
    token_limit: int
    cost_limit_micros: int


class AIRetentionResult(BaseModel):
    conversations_purged: int
    messages_purged: int
    artifacts_purged: int


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


class MetricsSummaryResponse(BaseModel):
    net_pnl: float
    win_rate: float
    total_trades: int
    winning_trades: int
    breakeven_trades: int
    open_trades: int
    profit_factor: float | None
    gross_pnl: float
    total_commissions: float
    total_fees: float
    max_drawdown: float
    recovery_factor: float | None
    sharpe_ratio: float | None
    average_r: float | None
    average_hold_minutes: float | None
    average_win: float | None
    average_loss: float | None
    expectancy: float | None
    best_trade: float | None
    worst_trade: float | None
    longest_win_streak: int
    longest_loss_streak: int


class MetricsCurvesResponse(BaseModel):
    equity_curve: list[EquityPoint]
    strategy_performance: list[StrategyPerformance]
    side_breakdown: list[SideBreakdown]
    calendar: list[CalendarPoint]


class MetricsResponse(MetricsSummaryResponse, MetricsCurvesResponse):
    pass


class BacktestState(BaseModel):
    session: BacktestSessionRead
    current_candle: Candle | None
    position: PositionRead | None
    orders: list[OrderRead]
    executions: list[ExecutionRead]
    trades: list[TradeRead]
    metrics: MetricsResponse


class BacktestReplayUpdate(BaseModel):
    session: BacktestSessionRead
    current_candle: Candle | None
    position: PositionRead | None
    orders: list[OrderRead] | None = None
    executions: list[ExecutionRead] | None = None
    trades: list[TradeRead] | None = None
    metrics: MetricsResponse | None = None
    history_changed: bool = False
    metrics_changed: bool = False


class BacktestSessionPage(BaseModel):
    items: list[BacktestSessionRead]
    offset: int
    limit: int
    next_offset: int
    next_cursor: str | None = None
    has_more: bool


class TradePage(BaseModel):
    items: list[TradeRead]
    offset: int
    limit: int
    next_offset: int
    next_cursor: str | None = None
    has_more: bool


class AppBootstrapShellResponse(BaseModel):
    playbooks: list[PlaybookRead]
    recent_sessions: list[BacktestSessionRead]
    strategy_summaries: list[StrategySummary]
    dashboard_summary: MetricsSummaryResponse | None = None
    active_session_id: int | None = None
    recent_sessions_next_offset: int
    recent_sessions_next_cursor: str | None = None
    recent_sessions_has_more: bool
    recent_session_limit: int


class AppBootstrapResponse(BaseModel):
    datasets: DatasetCatalogResponse
    playbooks: list[PlaybookRead]
    recent_sessions: list[BacktestSessionRead]
    strategy_summaries: list[StrategySummary]
    dashboard_summary: MetricsSummaryResponse | None = None
    active_session_id: int | None = None
    recent_sessions_next_offset: int
    recent_sessions_next_cursor: str | None = None
    recent_sessions_has_more: bool
    recent_trades: list[TradeRead]
    recent_session_limit: int
    recent_trade_limit: int
