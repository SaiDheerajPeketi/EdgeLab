from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from threading import Lock, Thread
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import pandas as pd
from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session, sessionmaker

from app.models import DatasetAsset, DatasetCandle, DatasetSettings, DatasetTimeframe, utcnow
from app.schemas import (
    DatasetAssetUpdate,
    DatasetCatalogResponse,
    DatasetInstrument,
    DatasetRefreshResponse,
    DatasetRefreshSummary,
    DatasetRefreshStatus,
    DatasetSettingsRead,
    DatasetSettingsUpdate,
    DatasetTimeframe as DatasetTimeframeRead,
)
from app.services.stored_market_data import (
    SOURCE_TIMESTAMP_FORMAT,
    StoredMarketDataService,
    parse_source_timestamp,
)


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

REQUIRED_COLUMNS = ["Timestamp", "Open", "High", "Low", "Close", "Volume"]
INSERT_BATCH_SIZE = 1_000
CSV_CHUNK_SIZE = 50_000
CATALOG_ROW_COUNT_MAX_BYTES = 25_000_000


@dataclass(frozen=True)
class DatasetResolution:
    csv_path: Path
    instrument: str | None
    timeframe: str | None
    symbol: str
    currency: str | None
    timezone: str | None
    stored: bool


@dataclass(frozen=True)
class DatasetFileMetadata:
    rows: int
    first_timestamp: str | None
    last_timestamp: str | None
    file_size: int
    file_mtime_ns: int


@dataclass
class DatasetRefreshState:
    running: bool = False
    current: str | None = None
    summary: DatasetRefreshSummary = field(
        default_factory=lambda: DatasetRefreshSummary(assets=0, timeframes=0, candles=0)
    )
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None


class DatasetRefreshInProgress(RuntimeError):
    pass


class DatasetCatalogService:
    def __init__(self, root: Path, session_factory: sessionmaker):
        self.default_root = root
        self.session_factory = session_factory
        self._lock = Lock()
        self._status_lock = Lock()
        self._refresh_state = DatasetRefreshState()

    def list_catalog(self, db: Session) -> DatasetCatalogResponse:
        self.discover_catalog(db)
        return self._catalog_from_store(db)

    def get_settings(self, db: Session) -> DatasetSettingsRead:
        return DatasetSettingsRead(root_path=str(self._root_path(db)))

    def discover_catalog(self, db: Session) -> None:
        if self._lock.locked():
            return
        self._scan_filesystem_index(db, strict=False, prune_missing=False)
        db.commit()

    def update_settings(
        self,
        db: Session,
        payload: DatasetSettingsUpdate,
    ) -> DatasetCatalogResponse:
        if self._lock.locked():
            raise DatasetRefreshInProgress("Dataset refresh is running. Try again after it completes.")
        root_path = Path(payload.root_path).expanduser()
        if not root_path.is_absolute():
            raise ValueError("Dataset root path must be absolute")
        settings = self._settings_row(db)
        settings.root_path = str(root_path)
        settings.updated_at = utcnow()
        db.commit()
        self.discover_catalog(db)
        return self._catalog_from_store(db)

    def refresh_catalog(self, db: Session) -> DatasetRefreshResponse:
        if not self._lock.acquire(blocking=False):
            raise DatasetRefreshInProgress("Dataset refresh is already running.")
        try:
            summary = self._scan_and_upsert(db)
            db.commit()
            return DatasetRefreshResponse(
                catalog=self._catalog_from_store(db),
                summary=summary,
            )
        finally:
            self._lock.release()

    def start_refresh(self, db: Session) -> DatasetRefreshResponse:
        if not self._lock.acquire(blocking=False):
            return DatasetRefreshResponse(
                catalog=self._catalog_from_store(db),
                summary=self.refresh_status().summary,
                status=self.refresh_status(),
            )

        try:
            summary = self._scan_filesystem_index(db, strict=False, prune_missing=False)
            db.commit()
            self._set_refresh_state(
                running=True,
                current="Starting import",
                summary=summary,
                started_at=utcnow(),
                finished_at=None,
                error=None,
            )
            Thread(target=self._run_refresh_job, daemon=True).start()
            return DatasetRefreshResponse(
                catalog=self._catalog_from_store(db),
                summary=summary,
                status=self.refresh_status(),
            )
        except Exception:
            self._lock.release()
            self._set_refresh_state(
                running=False,
                current=None,
                finished_at=utcnow(),
                error="Dataset refresh could not start",
            )
            raise

    def refresh_status(self) -> DatasetRefreshStatus:
        with self._status_lock:
            return DatasetRefreshStatus(
                running=self._refresh_state.running,
                current=self._refresh_state.current,
                summary=self._refresh_state.summary,
                started_at=self._refresh_state.started_at,
                finished_at=self._refresh_state.finished_at,
                error=self._refresh_state.error,
            )

    def _set_refresh_state(self, **changes: object) -> None:
        with self._status_lock:
            for key, value in changes.items():
                setattr(self._refresh_state, key, value)

    def _run_refresh_job(self) -> None:
        try:
            with self.session_factory() as db:
                summary = self._scan_and_upsert(db, track_progress=True)
                db.commit()
                self._set_refresh_state(
                    running=False,
                    current=None,
                    summary=summary,
                    finished_at=utcnow(),
                    error=None,
                )
        except Exception as exc:
            self._set_refresh_state(
                running=False,
                current=None,
                finished_at=utcnow(),
                error=str(exc),
            )
        finally:
            self._lock.release()

    def update_asset(
        self,
        db: Session,
        asset_id: str,
        payload: DatasetAssetUpdate,
    ) -> DatasetCatalogResponse:
        if self._lock.locked():
            raise DatasetRefreshInProgress("Dataset refresh is running. Try again after it completes.")
        asset = db.get(DatasetAsset, asset_id)
        if asset is None:
            raise FileNotFoundError(f"Dataset asset not found: {asset_id}")
        if payload.currency is not None:
            asset.currency = payload.currency.strip().upper()
        if payload.timezone is not None:
            timezone = payload.timezone.strip()
            validate_timezone(timezone)
            asset.timezone = timezone
        asset.updated_at = utcnow()
        db.commit()
        return self._catalog_from_store(db)

    def resolve_dataset(
        self,
        db: Session,
        *,
        csv_path: str | None = None,
        instrument: str | None = None,
        timeframe: str | None = None,
    ) -> DatasetResolution:
        if csv_path:
            path = Path(csv_path).expanduser()
            stored = db.scalar(
                select(DatasetTimeframe).where(DatasetTimeframe.csv_path == str(path))
            )
            if stored is not None:
                asset = db.get(DatasetAsset, stored.asset_id)
                stored_ready = bool(stored.imported and stored.rows > 0)
                return DatasetResolution(
                    csv_path=Path(stored.csv_path),
                    instrument=stored.asset_id,
                    timeframe=stored.timeframe,
                    symbol=asset.symbol if asset else self._symbol_from_asset_id(stored.asset_id),
                    currency=asset.currency if asset else None,
                    timezone=asset.timezone if asset else None,
                    stored=stored_ready,
                )
            if not path.exists():
                raise FileNotFoundError(f"Dataset CSV not found: {path}")
            return DatasetResolution(
                csv_path=path,
                instrument=instrument,
                timeframe=timeframe,
                symbol=self._symbol_from_file(path, instrument),
                currency=None,
                timezone=None,
                stored=False,
            )

        if not instrument or not timeframe:
            raise ValueError("instrument and timeframe are required when csv_path is not provided")

        wanted_instrument = normalize_key(instrument)
        wanted_timeframe = normalize_timeframe(timeframe)
        rows = db.scalars(select(DatasetAsset)).all()
        for asset in rows:
            if (
                normalize_key(asset.id) != wanted_instrument
                and normalize_key(asset.name) != wanted_instrument
                and normalize_key(asset.symbol) != wanted_instrument
            ):
                continue
            dataset_timeframe = db.scalar(
                select(DatasetTimeframe).where(
                    DatasetTimeframe.asset_id == asset.id,
                    DatasetTimeframe.timeframe == wanted_timeframe,
                )
            )
            if dataset_timeframe is not None:
                stored_ready = bool(dataset_timeframe.imported and dataset_timeframe.rows > 0)
                return DatasetResolution(
                    csv_path=Path(dataset_timeframe.csv_path),
                    instrument=asset.id,
                    timeframe=dataset_timeframe.timeframe,
                    symbol=asset.symbol,
                    currency=asset.currency,
                    timezone=asset.timezone,
                    stored=stored_ready,
                )
        raise FileNotFoundError(f"No imported dataset found for {instrument} {timeframe}")

    def market_data_for_dataset(self, asset_id: str, timeframe: str) -> StoredMarketDataService:
        return StoredMarketDataService(asset_id, timeframe, self.session_factory)

    def stored_market_data_for(
        self,
        asset_id: str | None,
        timeframe: str | None,
        csv_path: str | None = None,
    ) -> StoredMarketDataService | None:
        if not asset_id or not timeframe:
            return None
        with self.session_factory() as db:
            stored = db.scalar(
                select(DatasetTimeframe).where(
                    DatasetTimeframe.asset_id == asset_id,
                    DatasetTimeframe.timeframe == timeframe,
                )
            )
        if stored is None:
            return None
        if not stored.imported or stored.rows <= 0:
            return None
        if csv_path is not None and stored.csv_path != csv_path:
            return None
        return self.market_data_for_dataset(asset_id, timeframe)

    def _scan_and_upsert(
        self,
        db: Session,
        *,
        track_progress: bool = False,
    ) -> DatasetRefreshSummary:
        summary = self._scan_filesystem_index(db, strict=True, prune_missing=True)
        imported_candles = 0
        timeframes = db.scalars(select(DatasetTimeframe).order_by(DatasetTimeframe.asset_id.asc())).all()
        for timeframe in sorted(
            timeframes,
            key=lambda row: (row.asset_id, TIMEFRAME_ORDER.get(row.timeframe, 999999)),
        ):
            asset = db.get(DatasetAsset, timeframe.asset_id)
            if asset is None:
                continue
            if track_progress:
                self._set_refresh_state(
                    current=f"{asset.symbol} {timeframe.timeframe}",
                    summary=DatasetRefreshSummary(
                        assets=summary.assets,
                        timeframes=summary.timeframes,
                        candles=imported_candles,
                    ),
                )
            imported_candles += self._upsert_timeframe(
                db,
                asset,
                timeframe.timeframe,
                Path(timeframe.csv_path),
            )
            db.commit()
            if track_progress:
                self._set_refresh_state(
                    summary=DatasetRefreshSummary(
                        assets=summary.assets,
                        timeframes=summary.timeframes,
                        candles=imported_candles,
                    ),
                )

        return DatasetRefreshSummary(
            assets=summary.assets,
            timeframes=summary.timeframes,
            candles=imported_candles,
        )

    def _scan_filesystem_index(
        self,
        db: Session,
        *,
        strict: bool,
        prune_missing: bool,
    ) -> DatasetRefreshSummary:
        root = self._root_path(db)
        if not root.exists():
            return DatasetRefreshSummary(assets=0, timeframes=0, candles=0)

        seen_assets: set[str] = set()
        discovered_assets = 0
        discovered_timeframes = 0

        for directory in sorted(item for item in root.iterdir() if item.is_dir()):
            asset_id = directory.name
            seen_assets.add(asset_id)
            asset = self._upsert_asset_record(db, asset_id, directory)
            discovered_assets += 1

            seen_timeframes: set[str] = set()
            for csv_path in sorted(directory.glob("*.csv")):
                timeframe = self._timeframe_from_file(csv_path)
                if timeframe is None:
                    continue
                seen_timeframes.add(timeframe)
                try:
                    self._index_timeframe_file(db, asset, timeframe, csv_path)
                except ValueError:
                    if strict:
                        raise
                    continue
                discovered_timeframes += 1

            if prune_missing:
                for stale_timeframe in list(asset.timeframes):
                    if stale_timeframe.timeframe not in seen_timeframes:
                        db.execute(
                            delete(DatasetCandle).where(
                                DatasetCandle.asset_id == asset.id,
                                DatasetCandle.timeframe == stale_timeframe.timeframe,
                            )
                        )
                        db.delete(stale_timeframe)

        if prune_missing:
            for stale_asset in db.scalars(select(DatasetAsset)).all():
                if stale_asset.id in seen_assets:
                    continue
                db.execute(delete(DatasetCandle).where(DatasetCandle.asset_id == stale_asset.id))
                db.delete(stale_asset)

        return DatasetRefreshSummary(
            assets=discovered_assets,
            timeframes=discovered_timeframes,
            candles=0,
        )

    def _upsert_asset_record(self, db: Session, asset_id: str, directory: Path) -> DatasetAsset:
        asset = db.get(DatasetAsset, asset_id)
        if asset is None:
            asset = DatasetAsset(
                id=asset_id,
                name=directory.name.replace("_", "/"),
                symbol=self._symbol_from_asset_id(asset_id),
                folder_path=str(directory),
                currency="USD",
                timezone="UTC",
            )
            db.add(asset)
            db.flush()
        else:
            asset.name = directory.name.replace("_", "/")
            asset.symbol = self._symbol_from_asset_id(asset_id)
            asset.folder_path = str(directory)
            asset.updated_at = utcnow()
        return asset

    def _index_timeframe_file(
        self,
        db: Session,
        asset: DatasetAsset,
        timeframe: str,
        csv_path: Path,
    ) -> DatasetTimeframe:
        stat = csv_path.stat()
        existing = db.scalar(
            select(DatasetTimeframe).where(
                DatasetTimeframe.asset_id == asset.id,
                DatasetTimeframe.timeframe == timeframe,
            )
        )
        unchanged = (
            existing is not None
            and existing.csv_path == str(csv_path)
            and existing.file_size == stat.st_size
            and existing.file_mtime_ns == stat.st_mtime_ns
        )
        if unchanged:
            existing.updated_at = utcnow()
            return existing

        metadata = self._read_csv_metadata(csv_path)
        if existing is None:
            existing = DatasetTimeframe(
                asset_id=asset.id,
                timeframe=timeframe,
                csv_path=str(csv_path),
                imported=False,
            )
            db.add(existing)
        existing.csv_path = str(csv_path)
        existing.rows = metadata.rows
        existing.first_timestamp = metadata.first_timestamp
        existing.last_timestamp = metadata.last_timestamp
        existing.file_size = metadata.file_size
        existing.file_mtime_ns = metadata.file_mtime_ns
        existing.imported = False
        existing.updated_at = utcnow()
        db.flush()
        return existing

    def _read_csv_metadata(self, csv_path: Path) -> DatasetFileMetadata:
        stat = csv_path.stat()
        try:
            first_row = pd.read_csv(csv_path, nrows=1)
        except pd.errors.EmptyDataError as exc:
            raise ValueError(f"CSV is empty: {csv_path}") from exc

        missing = [column for column in REQUIRED_COLUMNS if column not in first_row.columns]
        if missing:
            raise ValueError(f"CSV is missing required columns: {', '.join(missing)}")

        rows = self._count_data_rows(csv_path) if stat.st_size <= CATALOG_ROW_COUNT_MAX_BYTES else 0
        first_timestamp = None
        last_timestamp = None
        if not first_row.empty:
            first_timestamp = self._normalize_timestamp(first_row.iloc[0]["Timestamp"])
            last_line = self._read_last_data_line(csv_path)
            if last_line:
                last_timestamp = self._normalize_timestamp(last_line.split(",", 1)[0])

        return DatasetFileMetadata(
            rows=rows,
            first_timestamp=first_timestamp,
            last_timestamp=last_timestamp,
            file_size=stat.st_size,
            file_mtime_ns=stat.st_mtime_ns,
        )

    def _normalize_timestamp(self, value: object) -> str | None:
        parsed = pd.to_datetime(pd.Series([value]), format="mixed", errors="coerce").iloc[0]
        if pd.isna(parsed):
            return None
        return parsed.strftime(SOURCE_TIMESTAMP_FORMAT)

    def _count_data_rows(self, csv_path: Path) -> int:
        with csv_path.open("rb") as handle:
            return max(sum(1 for _ in handle) - 1, 0)

    def _read_last_data_line(self, csv_path: Path) -> str | None:
        with csv_path.open("rb") as handle:
            handle.seek(0, 2)
            position = handle.tell()
            buffer = bytearray()
            while position > 0:
                position -= 1
                handle.seek(position)
                byte = handle.read(1)
                if byte == b"\n" and buffer:
                    break
                if byte not in {b"\n", b"\r"}:
                    buffer.extend(byte)
            line = bytes(reversed(buffer)).decode("utf-8").strip()
            return line or None

    def _upsert_timeframe(
        self,
        db: Session,
        asset: DatasetAsset,
        timeframe: str,
        csv_path: Path,
    ) -> int:
        stat = csv_path.stat()
        existing = db.scalar(
            select(DatasetTimeframe).where(
                DatasetTimeframe.asset_id == asset.id,
                DatasetTimeframe.timeframe == timeframe,
            )
        )
        unchanged = (
            existing is not None
            and existing.imported
            and existing.csv_path == str(csv_path)
            and existing.file_size == stat.st_size
            and existing.file_mtime_ns == stat.st_mtime_ns
            and existing.rows > 0
        )
        if unchanged:
            existing.updated_at = utcnow()
            return 0

        db.execute(
            delete(DatasetCandle).where(
                DatasetCandle.asset_id == asset.id,
                DatasetCandle.timeframe == timeframe,
            )
        )
        rows, first_timestamp, last_timestamp = self._import_candles(
            db,
            asset_id=asset.id,
            timeframe=timeframe,
            csv_path=csv_path,
        )
        if existing is None:
            existing = DatasetTimeframe(asset_id=asset.id, timeframe=timeframe, csv_path=str(csv_path))
            db.add(existing)
        existing.csv_path = str(csv_path)
        existing.rows = rows
        existing.first_timestamp = first_timestamp
        existing.last_timestamp = last_timestamp
        existing.file_size = stat.st_size
        existing.file_mtime_ns = stat.st_mtime_ns
        existing.imported = True
        existing.imported_at = utcnow()
        existing.updated_at = utcnow()
        return rows

    def _import_candles(
        self,
        db: Session,
        *,
        asset_id: str,
        timeframe: str,
        csv_path: Path,
    ) -> tuple[int, str | None, str | None]:
        rows = 0
        first_timestamp = None
        last_timestamp = None
        for chunk in pd.read_csv(csv_path, chunksize=CSV_CHUNK_SIZE):
            missing = [column for column in REQUIRED_COLUMNS if column not in chunk.columns]
            if missing:
                raise ValueError(f"CSV is missing required columns: {', '.join(missing)}")

            parsed_timestamps = pd.to_datetime(chunk["Timestamp"], format="mixed", errors="coerce")
            normalized = parsed_timestamps.dt.strftime(SOURCE_TIMESTAMP_FORMAT)
            normalized = normalized.where(parsed_timestamps.notna(), None)
            valid = chunk.assign(_timestamp=normalized).dropna(subset=["_timestamp"])
            if valid.empty:
                continue

            records = []
            for row in valid[["_timestamp", "Open", "High", "Low", "Close", "Volume"]].to_dict(
                "records"
            ):
                records.append(
                    {
                        "asset_id": asset_id,
                        "timeframe": timeframe,
                        "timestamp": str(row["_timestamp"]),
                        "open": float(row["Open"]),
                        "high": float(row["High"]),
                        "low": float(row["Low"]),
                        "close": float(row["Close"]),
                        "volume": float(row["Volume"]),
                    }
                )
            for start in range(0, len(records), INSERT_BATCH_SIZE):
                batch = records[start : start + INSERT_BATCH_SIZE]
                statement = sqlite_insert(DatasetCandle).values(batch)
                statement = statement.on_conflict_do_update(
                    index_elements=["asset_id", "timeframe", "timestamp"],
                    set_={
                        "open": statement.excluded.open,
                        "high": statement.excluded.high,
                        "low": statement.excluded.low,
                        "close": statement.excluded.close,
                        "volume": statement.excluded.volume,
                    },
                )
                db.execute(statement)

            rows += len(records)
            first_timestamp = first_timestamp or records[0]["timestamp"]
            last_timestamp = records[-1]["timestamp"]

        return rows, first_timestamp, last_timestamp

    def _catalog_from_store(self, db: Session) -> DatasetCatalogResponse:
        instruments: list[DatasetInstrument] = []
        assets = db.scalars(select(DatasetAsset).order_by(DatasetAsset.name.asc())).all()
        for asset in assets:
            timeframes = db.scalars(
                select(DatasetTimeframe).where(DatasetTimeframe.asset_id == asset.id)
            ).all()
            timeframe_reads = [
                DatasetTimeframeRead(
                    timeframe=item.timeframe,
                    csv_path=item.csv_path,
                    rows=item.rows,
                    first_timestamp=parse_source_timestamp(item.first_timestamp, asset.timezone),
                    last_timestamp=parse_source_timestamp(item.last_timestamp, asset.timezone),
                    imported=item.imported,
                    imported_at=item.imported_at,
                )
                for item in sorted(
                    timeframes,
                    key=lambda row: TIMEFRAME_ORDER.get(row.timeframe, 999999),
                )
            ]
            if not timeframe_reads:
                continue
            instruments.append(
                DatasetInstrument(
                    id=asset.id,
                    name=asset.name,
                    symbol=asset.symbol,
                    currency=asset.currency,
                    timezone=asset.timezone,
                    folder_path=asset.folder_path,
                    updated_at=asset.updated_at,
                    timeframes=timeframe_reads,
                )
            )
        return DatasetCatalogResponse(root=str(self._root_path(db)), instruments=instruments)

    def _root_path(self, db: Session) -> Path:
        return Path(self._settings_row(db).root_path)

    def _settings_row(self, db: Session) -> DatasetSettings:
        settings = db.get(DatasetSettings, 1)
        if settings is None:
            settings = DatasetSettings(id=1, root_path=str(self.default_root))
            db.add(settings)
            db.flush()
        return settings

    def _timeframe_from_file(self, csv_path: Path) -> str | None:
        suffix = csv_path.stem.split("_")[-1]
        return normalize_timeframe(suffix) if normalize_timeframe(suffix) in TIMEFRAME_ORDER else None

    def _symbol_from_asset_id(self, asset_id: str) -> str:
        return asset_id.replace("_", "").replace("/", "").upper()

    def _symbol_from_file(self, csv_path: Path, fallback: str | None = None) -> str:
        if fallback:
            return self._symbol_from_asset_id(fallback)
        return self._symbol_from_asset_id(csv_path.parent.name or csv_path.stem)


def validate_timezone(value: str) -> None:
    try:
        ZoneInfo(value or "UTC")
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"Unknown timestamp timezone: {value}") from exc


def normalize_key(value: str) -> str:
    return value.replace("/", "_").replace(" ", "_").upper()


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
    normalized = aliases.get(value, aliases.get(value.upper(), value))
    return normalized.upper() if normalized.upper() in TIMEFRAME_ORDER else normalized
