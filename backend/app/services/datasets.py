from pathlib import Path
from threading import Lock

from app.schemas import DatasetCatalogResponse, DatasetInstrument, DatasetMeta, DatasetTimeframe
from app.services.market_data import MarketDataService


TIMEFRAME_ORDER = {
    "M1": 1,
    "M5": 5,
    "M15": 15,
    "M30": 30,
    "H1": 60,
    "H4": 240,
    "Daily": 1440,
    "Weekly": 10080,
    "Monthly": 43200,
}


class DatasetCatalogService:
    def __init__(self, root: Path):
        self.root = root
        self._cache: DatasetCatalogResponse | None = None
        self._lock = Lock()

    def list_catalog(self, refresh: bool = False) -> DatasetCatalogResponse:
        if self._cache is not None and not refresh:
            return self._cache

        with self._lock:
            if self._cache is None or refresh:
                self._cache = self._scan()
        return self._cache

    def resolve_csv(
        self,
        *,
        csv_path: str | None = None,
        instrument: str | None = None,
        timeframe: str | None = None,
    ) -> tuple[Path, str | None, str | None, str]:
        if csv_path:
            path = Path(csv_path).expanduser()
            if not path.exists():
                raise FileNotFoundError(f"Dataset CSV not found: {path}")
            symbol = self._symbol_from_file(path)
            return path, instrument, timeframe, symbol

        if not instrument or not timeframe:
            raise ValueError("instrument and timeframe are required when csv_path is not provided")

        wanted_instrument = normalize_key(instrument)
        wanted_timeframe = normalize_timeframe(timeframe)
        catalog = self.list_catalog()
        for item in catalog.instruments:
            if normalize_key(item.id) != wanted_instrument and normalize_key(item.name) != wanted_instrument:
                continue
            for candidate in item.timeframes:
                if normalize_timeframe(candidate.timeframe) == wanted_timeframe:
                    return Path(candidate.csv_path), item.id, candidate.timeframe, item.symbol
        raise FileNotFoundError(f"No dataset found for {instrument} {timeframe}")

    def _scan(self) -> DatasetCatalogResponse:
        instruments: list[DatasetInstrument] = []
        if not self.root.exists():
            return DatasetCatalogResponse(root=str(self.root), instruments=[])

        for directory in sorted(item for item in self.root.iterdir() if item.is_dir()):
            timeframes: list[DatasetTimeframe] = []
            symbol = directory.name.replace("_", "")
            for csv_path in sorted(directory.glob("*.csv")):
                timeframe = self._timeframe_from_file(csv_path)
                if timeframe is None:
                    continue
                metadata = self._metadata(csv_path)
                symbol = self._symbol_from_file(csv_path) or symbol
                timeframes.append(
                    DatasetTimeframe(
                        timeframe=timeframe,
                        csv_path=str(csv_path),
                        rows=metadata.rows,
                        first_timestamp=metadata.first_timestamp,
                        last_timestamp=metadata.last_timestamp,
                    )
                )
            if timeframes:
                timeframes.sort(key=lambda item: TIMEFRAME_ORDER.get(item.timeframe, 999999))
                instruments.append(
                    DatasetInstrument(
                        id=directory.name,
                        name=directory.name.replace("_", "/"),
                        symbol=symbol,
                        timeframes=timeframes,
                    )
                )

        return DatasetCatalogResponse(root=str(self.root), instruments=instruments)

    def _metadata(self, csv_path: Path) -> DatasetMeta:
        return MarketDataService(csv_path, cache=False).get_metadata()

    def _timeframe_from_file(self, csv_path: Path) -> str | None:
        suffix = csv_path.stem.split("_")[-1]
        return suffix if suffix in TIMEFRAME_ORDER else None

    def _symbol_from_file(self, csv_path: Path) -> str:
        parts = csv_path.stem.split("_")
        return parts[0] if parts else csv_path.stem


def normalize_key(value: str) -> str:
    return value.replace("/", "_").upper()


def normalize_timeframe(value: str) -> str:
    aliases = {
        "1M": "M1",
        "1MIN": "M1",
        "1MINUTE": "M1",
        "1m": "M1",
        "5M": "M5",
        "5MIN": "M5",
        "5m": "M5",
        "15M": "M15",
        "15m": "M15",
        "30M": "M30",
        "30m": "M30",
        "1H": "H1",
        "1h": "H1",
        "4H": "H4",
        "4h": "H4",
        "D": "Daily",
        "1D": "Daily",
        "Daily": "Daily",
        "W": "Weekly",
        "1W": "Weekly",
        "Weekly": "Weekly",
        "M": "Monthly",
        "1MO": "Monthly",
        "Monthly": "Monthly",
    }
    return aliases.get(value, aliases.get(value.upper(), value))
