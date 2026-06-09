from dataclasses import dataclass
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


@dataclass(frozen=True)
class Settings:
    csv_path: Path | None = optional_path_env("EDGELAB_CSV_PATH")
    datasets_root: Path = Path(
        os.getenv(
            "EDGELAB_DATASETS_ROOT",
            PROJECT_ROOT / "datasets",
        )
    )
    database_url: str = os.getenv(
        "DATABASE_URL", f"sqlite:///{BACKEND_ROOT / 'trade_journal_v2.db'}"
    )
    api_token: str = os.getenv("EDGELAB_API_TOKEN", "").strip()
    cors_origins: tuple[str, ...] = tuple(
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174",
        ).split(",")
        if origin.strip()
    )
    cache_market_data: bool = os.getenv("EDGELAB_CACHE_MARKET_DATA", "1") != "0"
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


settings = Settings()
