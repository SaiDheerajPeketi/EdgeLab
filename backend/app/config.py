from dataclasses import dataclass, field
import json
import math
import os
from pathlib import Path

from sqlalchemy.engine import URL
from sqlalchemy.pool import QueuePool


PROJECT_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = Path(__file__).resolve().parents[1]


def int_env(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    try:
        return int(raw_value)
    except ValueError:
        return default


def bool_env(name: str, default: bool) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return raw_value.strip().lower() not in {"", "0", "false", "no", "off"}


def tuple_env(name: str, default: str) -> tuple[str, ...]:
    return tuple(
        item.strip()
        for item in os.getenv(name, default).split(",")
        if item.strip()
    )


def float_env(name: str, default: float) -> float:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    try:
        return float(raw_value)
    except ValueError:
        return default


def _bounded_number(name: str, value, minimum, maximum, *, integer=False):
    description = "an integer" if integer else "a finite number"
    if (isinstance(value, bool) or not isinstance(value, (int, float))
            or (integer and not isinstance(value, int))
            or not minimum <= value <= maximum or not math.isfinite(value)):
        raise ValueError(f"{name} must be {description} between {minimum} and {maximum}")
    return value


def _bounded_number_env(name: str, default, minimum, maximum, *, integer=False):
    try:
        value = (int if integer else float)(os.getenv(name, str(default)))
    except ValueError:
        description = "an integer" if integer else "a finite number"
        raise ValueError(f"{name} must be {description} between {minimum} and {maximum}") from None
    return _bounded_number(name, value, minimum, maximum, integer=integer)


def optional_path_env(name: str) -> Path | None:
    raw_value = os.getenv(name, "").strip()
    if not raw_value:
        return None
    return Path(raw_value)


def postgres_database_url(host: str, port: str) -> str:
    return URL.create(
        "postgresql+psycopg",
        username=os.getenv("POSTGRES_USER", "edgelab").strip() or "edgelab",
        password=os.getenv("POSTGRES_PASSWORD", "edgelab").strip() or "edgelab",
        host=host,
        port=int(port),
        database=os.getenv("POSTGRES_DB", "edgelab").strip() or "edgelab",
    ).render_as_string(hide_password=False)


def default_database_url() -> str:
    explicit_url = os.getenv("DATABASE_URL", "").strip()
    if explicit_url:
        return explicit_url
    return postgres_database_url(
        os.getenv("EDGELAB_POSTGRES_HOST", "127.0.0.1").strip() or "127.0.0.1",
        os.getenv("EDGELAB_POSTGRES_CONNECT_PORT", "5432").strip() or "5432",
    )


def default_market_data_database_url() -> str:
    explicit_url = os.getenv("EDGELAB_MARKET_DATA_DATABASE_URL", "").strip()
    if explicit_url:
        return explicit_url
    market_host = os.getenv("EDGELAB_MARKET_DATA_POSTGRES_HOST", "").strip()
    if market_host:
        return postgres_database_url(
            market_host,
            os.getenv("EDGELAB_MARKET_DATA_POSTGRES_PORT", "6432").strip() or "6432",
        )
    return default_database_url()


def database_connect_args(database_url: str) -> dict[str, object]:
    if database_url.startswith("sqlite"):
        return {"check_same_thread": False, "timeout": _bounded_number_env("EDGELAB_DB_SQLITE_LOCK_TIMEOUT_SECONDS", 60, 0, 300)}
    if database_url.startswith("postgresql+psycopg"):
        return {
            "prepare_threshold": None,
            "connect_timeout": _bounded_number_env("EDGELAB_DB_CONNECT_TIMEOUT_SECONDS", 10, 1, 120, integer=True),
        }
    return {}


def database_engine_options(database_url: str) -> dict[str, object]:
    options: dict[str, object] = {"pool_pre_ping": True}
    if not database_url.startswith("sqlite"):
        options.update(
            pool_recycle=_bounded_number_env("EDGELAB_DB_POOL_RECYCLE_SECONDS", 1800, 1, 86400, integer=True),
            pool_size=_bounded_number_env("EDGELAB_DB_POOL_SIZE", 5, 1, 1000, integer=True),
            max_overflow=_bounded_number_env("EDGELAB_DB_POOL_MAX_OVERFLOW", 10, 0, 1000, integer=True),
            pool_timeout=_bounded_number_env("EDGELAB_DB_POOL_TIMEOUT_SECONDS", 5.0, 0.1, 60),
        )
    return options


@dataclass(frozen=True)
class RequestAdmissionConfig:
    queue_wait_seconds: float = 0.25
    queue_depth: int = 0
    probe_budget: int = 2
    validation_thread_reserve: int = 8
    sql_checkout_multiplier: int = 2

    def __post_init__(self):
        _bounded_number("EDGELAB_HTTP_QUEUE_WAIT_SECONDS", self.queue_wait_seconds, 0, 5)
        _bounded_number("EDGELAB_HTTP_QUEUE_DEPTH", self.queue_depth, 0, 1024, integer=True)
        _bounded_number("EDGELAB_HTTP_PROBE_BUDGET", self.probe_budget, 0, 32, integer=True)
        _bounded_number("EDGELAB_HTTP_VALIDATION_THREAD_RESERVE", self.validation_thread_reserve, 1, 256, integer=True)
        _bounded_number("EDGELAB_HTTP_SQL_CHECKOUT_MULTIPLIER", self.sql_checkout_multiplier, 1, 8, integer=True)

    @classmethod
    def from_env(cls):
        return cls(
            queue_wait_seconds=_bounded_number_env("EDGELAB_HTTP_QUEUE_WAIT_SECONDS", 0.25, 0, 5),
            queue_depth=_bounded_number_env("EDGELAB_HTTP_QUEUE_DEPTH", 0, 0, 1024, integer=True),
            probe_budget=_bounded_number_env("EDGELAB_HTTP_PROBE_BUDGET", 2, 0, 32, integer=True),
            validation_thread_reserve=_bounded_number_env("EDGELAB_HTTP_VALIDATION_THREAD_RESERVE", 8, 1, 256, integer=True),
            sql_checkout_multiplier=_bounded_number_env("EDGELAB_HTTP_SQL_CHECKOUT_MULTIPLIER", 2, 1, 8, integer=True),
        )


def database_request_admission_limits(db_engine, configured_limit: int = 0, *, thread_tokens: float,
                                      admission_config: RequestAdmissionConfig | None = None) -> tuple[int | None, int]:
    _bounded_number("EDGELAB_HTTP_REQUEST_LIMIT", configured_limit, 0, 10000, integer=True)
    tuning = admission_config if admission_config is not None else RequestAdmissionConfig()
    pool = db_engine.pool
    if isinstance(pool, QueuePool) and pool.size() > 0 and pool._max_overflow >= 0:
        if db_engine.dialect.name == "sqlite" and configured_limit == 0:
            return None, 0
        capacity = pool.size() + pool._max_overflow
        if not thread_tokens > 0:
            raise ValueError("The request thread budget must be positive")
        # Allow a bounded checkout queue, while preserving shared worker threads
        # for response validation and dependency cleanup. With 40 tokens this
        # leaves eight free; small limiters retain at least one where possible.
        if math.isfinite(thread_tokens):
            tokens = max(1, int(thread_tokens))
            reserve = min(tuning.validation_thread_reserve, max(1, tokens // 5))
            request_budget = max(1, tokens - reserve)
        else:
            request_budget = tuning.sql_checkout_multiplier * capacity + tuning.probe_budget
        probe_limit = min(tuning.probe_budget, capacity, request_budget - 1)
        safe_limit = min(tuning.sql_checkout_multiplier * capacity, request_budget - probe_limit)
        limit = min(configured_limit or safe_limit, safe_limit)
        return limit, probe_limit
    # Static/Null/unbounded pools have no finite checkout queue to starve.
    return configured_limit or None, 0


@dataclass(frozen=True)
class GoogleOAuthCredentials:
    client_id: str = ""
    client_secret: str = ""
    source_file: Path | None = None


def load_google_oauth_credentials() -> GoogleOAuthCredentials:
    source_file = optional_path_env("GOOGLE_CLIENT_SECRETS_FILE")
    client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET", "").strip()

    if source_file is None:
        return GoogleOAuthCredentials(
            client_id=client_id,
            client_secret=client_secret,
        )

    try:
        payload = json.loads(source_file.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return GoogleOAuthCredentials(
            client_id=client_id,
            client_secret=client_secret,
            source_file=source_file,
        )

    oauth_payload = payload
    if isinstance(payload, dict):
        nested_payload = payload.get("web") or payload.get("installed")
        if isinstance(nested_payload, dict):
            oauth_payload = nested_payload

    if isinstance(oauth_payload, dict):
        file_client_id = str(oauth_payload.get("client_id") or "").strip()
        file_client_secret = str(oauth_payload.get("client_secret") or "").strip()
        client_id = client_id or file_client_id
        client_secret = client_secret or file_client_secret

    return GoogleOAuthCredentials(
        client_id=client_id,
        client_secret=client_secret,
        source_file=source_file,
    )


GOOGLE_OAUTH_CREDENTIALS = load_google_oauth_credentials()


@dataclass(frozen=True)
class Settings:
    environment: str = os.getenv("EDGELAB_ENVIRONMENT", "development").strip().lower()
    csv_path: Path | None = optional_path_env("EDGELAB_CSV_PATH")
    datasets_root: Path = Path(
        os.getenv(
            "EDGELAB_DATASETS_ROOT",
            PROJECT_ROOT / "datasets",
        )
    )
    database_url: str = default_database_url()
    market_data_database_url: str = default_market_data_database_url()
    api_token: str = os.getenv("EDGELAB_API_TOKEN", "").strip()
    jwt_secret: str = os.getenv("EDGELAB_JWT_SECRET", "").strip()
    auth_provider: str = os.getenv("EDGELAB_AUTH_PROVIDER", "legacy").strip()
    better_auth_internal_url: str = os.getenv("EDGELAB_BETTER_AUTH_INTERNAL_URL", "http://127.0.0.1:3002").strip()
    auth_service_key: str = os.getenv("EDGELAB_AUTH_SERVICE_KEY", "").strip()
    google_client_id: str = GOOGLE_OAUTH_CREDENTIALS.client_id
    google_client_secret: str = GOOGLE_OAUTH_CREDENTIALS.client_secret
    google_client_secrets_file: Path | None = GOOGLE_OAUTH_CREDENTIALS.source_file
    public_origin: str = os.getenv("EDGELAB_PUBLIC_ORIGIN", "").strip().rstrip("/")
    deployment_mode: str = os.getenv("EDGELAB_DEPLOYMENT_MODE", "production").strip().lower()
    billing_enabled: bool = bool_env("EDGELAB_BILLING_ENABLED", False)
    stripe_secret_key: str = os.getenv("STRIPE_SECRET_KEY", "").strip()
    stripe_webhook_secret: str = os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()
    stripe_mode: str = os.getenv("EDGELAB_STRIPE_MODE", "test").strip().lower()
    stripe_monthly_price_id: str = os.getenv("STRIPE_PRO_MONTHLY_PRICE_ID", "").strip()
    stripe_annual_price_id: str = os.getenv("STRIPE_PRO_ANNUAL_PRICE_ID", "").strip()
    google_redirect_uri: str = os.getenv("GOOGLE_REDIRECT_URI", "").strip()
    cors_origins: tuple[str, ...] = tuple(
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174",
        ).split(",")
        if origin.strip()
    )
    cache_market_data: bool = os.getenv("EDGELAB_CACHE_MARKET_DATA", "1") != "0"
    market_data_import_enabled: bool = bool_env(
        "EDGELAB_MARKET_DATA_IMPORT_ENABLED",
        True,
    )
    data_populator_interval_seconds: int = int_env(
        "EDGELAB_DATA_POPULATOR_INTERVAL_SECONDS",
        3600,
    )
    data_populator_backfill_mode: str = os.getenv(
        "EDGELAB_DATA_POPULATOR_BACKFILL_MODE",
        "max",
    ).strip().lower()
    data_populator_lookback_days: int = int_env(
        "EDGELAB_DATA_POPULATOR_LOOKBACK_DAYS",
        30,
    )
    data_populator_derived_timeframes: tuple[str, ...] = tuple_env(
        "EDGELAB_DATA_POPULATOR_DERIVED_TIMEFRAMES",
        "M5,M15,M30,H1,H4,Daily",
    )
    data_populator_request_timeout_seconds: int = int_env(
        "EDGELAB_DATA_POPULATOR_REQUEST_TIMEOUT_SECONDS",
        20,
    )
    data_populator_backfill_write_batch_candles: int = int_env(
        "EDGELAB_DATA_POPULATOR_BACKFILL_WRITE_BATCH_CANDLES",
        250_000,
    )
    data_populator_binance_archive_workers: int = int_env(
        "EDGELAB_DATA_POPULATOR_BINANCE_ARCHIVE_WORKERS",
        2,
    )
    data_populator_forex_start_date: str = os.getenv(
        "EDGELAB_DATA_POPULATOR_FOREX_START_DATE",
        "2003-01-01",
    ).strip()
    data_populator_crypto_start_date: str = os.getenv(
        "EDGELAB_DATA_POPULATOR_CRYPTO_START_DATE",
        "2017-08-17",
    ).strip()
    data_populator_forex_symbols: tuple[str, ...] = tuple_env(
        "EDGELAB_DATA_POPULATOR_FOREX_SYMBOLS",
        "EUR/USD,GBP/USD,USD/JPY,USD/CHF,AUD/USD,USD/CAD,NZD/USD,"
        "EUR/JPY,GBP/JPY,AUD/JPY,CAD/JPY,CHF/JPY,NZD/JPY,EUR/GBP,EUR/CHF,"
        "EUR/AUD,EUR/CAD,GBP/CHF,GBP/AUD,AUD/NZD,XAU/USD,XAG/USD,E_Brent,"
        "E_Light,E_SandP-500,E_NQ-100,E_D&J-Ind,E_DAAX",
    )
    data_populator_crypto_symbols: tuple[str, ...] = tuple_env(
        "EDGELAB_DATA_POPULATOR_CRYPTO_SYMBOLS",
        "BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,XRPUSDT,ADAUSDT,DOGEUSDT,"
        "AVAXUSDT,LINKUSDT,DOTUSDT,TRXUSDT,MATICUSDT,LTCUSDT,BCHUSDT,"
        "UNIUSDT,ATOMUSDT,ETCUSDT,APTUSDT,NEARUSDT,FILUSDT,ARBUSDT,OPUSDT",
    )
    max_request_body_bytes: int = int_env(
        "EDGELAB_MAX_REQUEST_BODY_BYTES",
        25 * 1024 * 1024,
    )
    http_request_limit: int = field(default_factory=lambda: _bounded_number_env("EDGELAB_HTTP_REQUEST_LIMIT", 0, 0, 10000, integer=True))
    request_admission: RequestAdmissionConfig = field(default_factory=RequestAdmissionConfig.from_env)
    quant_capture_root: Path = Path(
        os.getenv("EDGELAB_QUANT_CAPTURE_ROOT", BACKEND_ROOT / "data" / "quant-captures")
    )
    max_app_data_rows: int = int_env("EDGELAB_MAX_APP_DATA_ROWS", 100_000)
    bootstrap_shell_cache_ttl_seconds: int = int_env(
        "EDGELAB_BOOTSTRAP_SHELL_CACHE_TTL_SECONDS",
        3,
    )
    dataset_catalog_cache_ttl_seconds: int = int_env(
        "EDGELAB_DATASET_CATALOG_CACHE_TTL_SECONDS",
        5,
    )
    redis_url: str = os.getenv("EDGELAB_REDIS_URL", "").strip()
    rate_limit_window_seconds: int = int_env("EDGELAB_RATE_LIMIT_WINDOW_SECONDS", 60)
    dataset_refresh_rate_limit: int = int_env("EDGELAB_DATASET_REFRESH_RATE_LIMIT", 6)
    market_data_meta_rate_limit: int = int_env("EDGELAB_MARKET_DATA_META_RATE_LIMIT", 240)
    market_data_bars_rate_limit: int = int_env("EDGELAB_MARKET_DATA_BARS_RATE_LIMIT", 240)
    dataset_auto_discovery_enabled: bool = bool_env(
        "EDGELAB_DATASET_AUTO_DISCOVERY_ENABLED",
        True,
    )
    analytics_interval_seconds: int = int_env(
        "EDGELAB_ANALYTICS_INTERVAL_SECONDS",
        60,
    )
    observability_log_level: str = os.getenv(
        "EDGELAB_OBSERVABILITY_LOG_LEVEL",
        "INFO",
    ).strip() or "INFO"
    observability_json_logs: bool = bool_env(
        "EDGELAB_OBSERVABILITY_JSON_LOGS",
        True,
    )
    otel_service_name: str = os.getenv("OTEL_SERVICE_NAME", "").strip()
    otel_service_namespace: str = os.getenv("OTEL_SERVICE_NAMESPACE", "edgelab").strip()
    otel_environment: str = os.getenv("EDGELAB_OTEL_ENVIRONMENT", "production").strip()
    otel_exporter_otlp_endpoint: str = os.getenv(
        "OTEL_EXPORTER_OTLP_ENDPOINT",
        "",
    ).strip()
    otel_exporter_otlp_headers: str = os.getenv(
        "OTEL_EXPORTER_OTLP_HEADERS",
        "",
    ).strip()
    otel_trace_sample_ratio: float = _bounded_number_env("EDGELAB_OTEL_TRACE_SAMPLE_RATIO", 0.1, 0, 1)
    beta_seats_total: int = int_env("EDGELAB_BETA_SEATS_TOTAL", 500)
    beta_manual_access_enabled: bool = bool_env(
        "EDGELAB_BETA_MANUAL_ACCESS_ENABLED",
        False,
    )
    dev_auth_bypass_enabled: bool = bool_env(
        "EDGELAB_DEV_AUTH_BYPASS",
        False,
    )


settings = Settings()
if settings.auth_provider not in {"legacy", "better-auth"}:
    raise ValueError("EDGELAB_AUTH_PROVIDER must be legacy or better-auth")

if not settings.google_redirect_uri and settings.public_origin:
    settings = Settings(
        environment=settings.environment,
        csv_path=settings.csv_path,
        datasets_root=settings.datasets_root,
        database_url=settings.database_url,
        market_data_database_url=settings.market_data_database_url,
        api_token=settings.api_token,
        jwt_secret=settings.jwt_secret,
        auth_provider=settings.auth_provider,
        better_auth_internal_url=settings.better_auth_internal_url,
        auth_service_key=settings.auth_service_key,
        google_client_id=settings.google_client_id,
        google_client_secret=settings.google_client_secret,
        google_client_secrets_file=settings.google_client_secrets_file,
        public_origin=settings.public_origin,
        deployment_mode=settings.deployment_mode,
        billing_enabled=settings.billing_enabled,
        stripe_secret_key=settings.stripe_secret_key,
        stripe_webhook_secret=settings.stripe_webhook_secret,
        stripe_mode=settings.stripe_mode,
        stripe_monthly_price_id=settings.stripe_monthly_price_id,
        stripe_annual_price_id=settings.stripe_annual_price_id,
        google_redirect_uri=f"{settings.public_origin}/auth/callback/google",
        cors_origins=settings.cors_origins,
        cache_market_data=settings.cache_market_data,
        market_data_import_enabled=settings.market_data_import_enabled,
        data_populator_interval_seconds=settings.data_populator_interval_seconds,
        data_populator_backfill_mode=settings.data_populator_backfill_mode,
        data_populator_lookback_days=settings.data_populator_lookback_days,
        data_populator_derived_timeframes=settings.data_populator_derived_timeframes,
        data_populator_request_timeout_seconds=settings.data_populator_request_timeout_seconds,
        data_populator_forex_start_date=settings.data_populator_forex_start_date,
        data_populator_crypto_start_date=settings.data_populator_crypto_start_date,
        data_populator_forex_symbols=settings.data_populator_forex_symbols,
        data_populator_crypto_symbols=settings.data_populator_crypto_symbols,
        max_request_body_bytes=settings.max_request_body_bytes,
        http_request_limit=settings.http_request_limit,
        request_admission=settings.request_admission,
        max_app_data_rows=settings.max_app_data_rows,
        bootstrap_shell_cache_ttl_seconds=settings.bootstrap_shell_cache_ttl_seconds,
        dataset_catalog_cache_ttl_seconds=settings.dataset_catalog_cache_ttl_seconds,
        redis_url=settings.redis_url,
        rate_limit_window_seconds=settings.rate_limit_window_seconds,
        dataset_refresh_rate_limit=settings.dataset_refresh_rate_limit,
        market_data_meta_rate_limit=settings.market_data_meta_rate_limit,
        market_data_bars_rate_limit=settings.market_data_bars_rate_limit,
        dataset_auto_discovery_enabled=settings.dataset_auto_discovery_enabled,
        analytics_interval_seconds=settings.analytics_interval_seconds,
        observability_log_level=settings.observability_log_level,
        observability_json_logs=settings.observability_json_logs,
        otel_service_name=settings.otel_service_name,
        otel_service_namespace=settings.otel_service_namespace,
        otel_environment=settings.otel_environment,
        otel_exporter_otlp_endpoint=settings.otel_exporter_otlp_endpoint,
        otel_exporter_otlp_headers=settings.otel_exporter_otlp_headers,
        otel_trace_sample_ratio=settings.otel_trace_sample_ratio,
        beta_seats_total=settings.beta_seats_total,
        beta_manual_access_enabled=settings.beta_manual_access_enabled,
        dev_auth_bypass_enabled=settings.dev_auth_bypass_enabled,
    )
