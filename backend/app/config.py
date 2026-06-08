from dataclasses import dataclass
import os
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = Path(__file__).resolve().parents[1]


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
    cors_origins: tuple[str, ...] = tuple(
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174",
        ).split(",")
        if origin.strip()
    )
    cache_market_data: bool = os.getenv("EDGELAB_CACHE_MARKET_DATA", "1") != "0"


settings = Settings()
