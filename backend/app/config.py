from dataclasses import dataclass
import json
import os
from pathlib import Path


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


def optional_path_env(name: str) -> Path | None:
    raw_value = os.getenv(name, "").strip()
    if not raw_value:
        return None
    return Path(raw_value)


def default_database_url() -> str:
    explicit_url = os.getenv("DATABASE_URL", "").strip()
    if explicit_url:
        return explicit_url
    postgres_user = os.getenv("POSTGRES_USER", "edgelab").strip() or "edgelab"
    postgres_password = os.getenv("POSTGRES_PASSWORD", "edgelab").strip() or "edgelab"
    postgres_db = os.getenv("POSTGRES_DB", "edgelab").strip() or "edgelab"
    postgres_host = os.getenv("EDGELAB_POSTGRES_HOST", "127.0.0.1").strip() or "127.0.0.1"
    postgres_port = os.getenv("EDGELAB_POSTGRES_CONNECT_PORT", "5432").strip() or "5432"
    return (
        "postgresql+psycopg://"
        f"{postgres_user}:{postgres_password}@{postgres_host}:{postgres_port}/{postgres_db}"
    )


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
    csv_path: Path | None = optional_path_env("EDGELAB_CSV_PATH")
    datasets_root: Path = Path(
        os.getenv(
            "EDGELAB_DATASETS_ROOT",
            PROJECT_ROOT / "datasets",
        )
    )
    database_url: str = default_database_url()
    api_token: str = os.getenv("EDGELAB_API_TOKEN", "").strip()
    jwt_secret: str = os.getenv("EDGELAB_JWT_SECRET", "").strip()
    google_client_id: str = GOOGLE_OAUTH_CREDENTIALS.client_id
    google_client_secret: str = GOOGLE_OAUTH_CREDENTIALS.client_secret
    google_client_secrets_file: Path | None = GOOGLE_OAUTH_CREDENTIALS.source_file
    public_origin: str = os.getenv("EDGELAB_PUBLIC_ORIGIN", "").strip().rstrip("/")
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
        "EUR/USD,GBP/USD,USD/JPY,USD/CHF,AUD/USD,USD/CAD,NZD/USD",
    )
    data_populator_crypto_symbols: tuple[str, ...] = tuple_env(
        "EDGELAB_DATA_POPULATOR_CRYPTO_SYMBOLS",
        "BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,XRPUSDT,ADAUSDT,DOGEUSDT",
    )
    max_request_body_bytes: int = int_env(
        "EDGELAB_MAX_REQUEST_BODY_BYTES",
        25 * 1024 * 1024,
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
    dataset_auto_discovery_enabled: bool = bool_env(
        "EDGELAB_DATASET_AUTO_DISCOVERY_ENABLED",
        True,
    )
    analytics_interval_seconds: int = int_env(
        "EDGELAB_ANALYTICS_INTERVAL_SECONDS",
        60,
    )
    beta_seats_total: int = int_env("EDGELAB_BETA_SEATS_TOTAL", 500)
    beta_manual_access_enabled: bool = bool_env(
        "EDGELAB_BETA_MANUAL_ACCESS_ENABLED",
        False,
    )


settings = Settings()

if not settings.google_redirect_uri and settings.public_origin:
    settings = Settings(
        csv_path=settings.csv_path,
        datasets_root=settings.datasets_root,
        database_url=settings.database_url,
        api_token=settings.api_token,
        jwt_secret=settings.jwt_secret,
        google_client_id=settings.google_client_id,
        google_client_secret=settings.google_client_secret,
        google_client_secrets_file=settings.google_client_secrets_file,
        public_origin=settings.public_origin,
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
        max_app_data_rows=settings.max_app_data_rows,
        bootstrap_shell_cache_ttl_seconds=settings.bootstrap_shell_cache_ttl_seconds,
        dataset_catalog_cache_ttl_seconds=settings.dataset_catalog_cache_ttl_seconds,
        redis_url=settings.redis_url,
        dataset_auto_discovery_enabled=settings.dataset_auto_discovery_enabled,
        analytics_interval_seconds=settings.analytics_interval_seconds,
        beta_seats_total=settings.beta_seats_total,
        beta_manual_access_enabled=settings.beta_manual_access_enabled,
    )
