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


@dataclass(frozen=True)
class Settings:
    csv_path: Path = Path(
        os.getenv("EDGELAB_CSV_PATH", PROJECT_ROOT / "EURUSD_M1.csv")
    )
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
    max_request_body_bytes: int = int_env(
        "EDGELAB_MAX_REQUEST_BODY_BYTES",
        25 * 1024 * 1024,
    )
    max_app_data_rows: int = int_env("EDGELAB_MAX_APP_DATA_ROWS", 100_000)


settings = Settings()
