from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
import logging
from pathlib import Path
from threading import Lock
from time import monotonic
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.models import BacktestSession, DatasetAsset, DatasetSettings, DatasetTimeframe, utcnow
from app.schemas import (
    DatasetAssetUpdate,
    DatasetCatalogResponse,
    DatasetInstrument,
    DatasetRefreshResponse,
    DatasetRefreshStatus,
    DatasetRefreshSummary,
    DatasetSettingsRead,
    DatasetSettingsUpdate,
    DatasetTimeframe as DatasetTimeframeRead,
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
CATALOG_ROW_COUNT_MAX_BYTES = 25_000_000
CATALOG_AUTO_DISCOVERY_TTL_SECONDS = 30.0
SOURCE_TIMESTAMP_FORMAT = "%Y-%m-%d %H:%M:%S"
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DatasetResolution:
    csv_path: Path
    instrument: str | None
    timeframe: str | None
    symbol: str
    currency: str | None
    timezone: str | None
    pnl_multiplier: float
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
    def __init__(
        self,
        root: Path,
        session_factory: sessionmaker,
        catalog_discovery_ttl_seconds: float = CATALOG_AUTO_DISCOVERY_TTL_SECONDS,
    ):
        self.default_root = root
        self.session_factory = session_factory
        self.catalog_discovery_ttl_seconds = catalog_discovery_ttl_seconds
        self._state_lock = Lock()
        self._locks_by_user: dict[int, Lock] = {}
        self._refresh_state_by_user: dict[int, DatasetRefreshState] = {}
        self._last_discovery_root_by_user: dict[int, str] = {}
        self._last_discovery_at_by_user: dict[int, float] = {}

    def list_catalog(self, db: Session, user_id: int) -> DatasetCatalogResponse:
        self.discover_catalog(db, user_id)
        return self._catalog_from_store(db, user_id)

    def get_settings(self, db: Session, user_id: int) -> DatasetSettingsRead:
        return DatasetSettingsRead(root_path=str(self._root_path(db, user_id)))

    def discover_catalog(self, db: Session, user_id: int, *, force: bool = False) -> None:
        root = str(self._root_path(db, user_id))
        now = monotonic()
        if (
            not force
            and self._last_discovery_root_by_user.get(user_id) == root
            and (last_at := self._last_discovery_at_by_user.get(user_id)) is not None
            and now - last_at < self.catalog_discovery_ttl_seconds
        ):
            return

        lock = self._lock_for_user(user_id)
        if not lock.acquire(blocking=False):
            return
        try:
            try:
                self._scan_filesystem_index(db, user_id, strict=False, prune_missing=False)
                self._sync_session_replay_ready(db, user_id)
                db.commit()
            except (OSError, ValueError):
                db.rollback()
                logger.exception("Dataset auto-discovery failed; using stored catalog")
            self._last_discovery_root_by_user[user_id] = root
            self._last_discovery_at_by_user[user_id] = monotonic()
        finally:
            lock.release()

    def update_settings(
        self,
        db: Session,
        user_id: int,
        payload: DatasetSettingsUpdate,
    ) -> DatasetCatalogResponse:
        if self._lock_for_user(user_id).locked():
            raise DatasetRefreshInProgress("Dataset refresh is running. Try again after it completes.")
        root_path = Path(payload.root_path).expanduser()
        if not root_path.is_absolute():
            raise ValueError("Dataset root path must be absolute")
        settings = self._settings_row(db, user_id)
        settings.root_path = str(root_path)
        settings.updated_at = utcnow()
        db.commit()
        self.discover_catalog(db, user_id, force=True)
        return self._catalog_from_store(db, user_id)

    def refresh_catalog(self, db: Session, user_id: int) -> DatasetRefreshResponse:
        lock = self._lock_for_user(user_id)
        if not lock.acquire(blocking=False):
            raise DatasetRefreshInProgress("Dataset refresh is already running.")
        try:
            summary = self._scan_filesystem_index(db, user_id, strict=True, prune_missing=True)
            self._sync_session_replay_ready(db, user_id)
            db.commit()
            self._last_discovery_root_by_user[user_id] = str(self._root_path(db, user_id))
            self._last_discovery_at_by_user[user_id] = monotonic()
            return DatasetRefreshResponse(
                catalog=self._catalog_from_store(db, user_id),
                summary=summary,
            )
        finally:
            lock.release()

    def start_refresh(self, db: Session, user_id: int) -> DatasetRefreshResponse:
        lock = self._lock_for_user(user_id)
        if not lock.acquire(blocking=False):
            return DatasetRefreshResponse(
                catalog=self._catalog_from_store(db, user_id),
                summary=self.refresh_status(user_id).summary,
                status=self.refresh_status(user_id),
            )

        try:
            self._set_refresh_state(
                user_id,
                running=True,
                current="Scanning CSV folders",
                summary=DatasetRefreshSummary(assets=0, timeframes=0, candles=0),
                started_at=utcnow(),
                finished_at=None,
                error=None,
            )
            summary = self._scan_filesystem_index(db, user_id, strict=True, prune_missing=True)
            self._sync_session_replay_ready(db, user_id)
            db.commit()
            self._last_discovery_root_by_user[user_id] = str(self._root_path(db, user_id))
            self._last_discovery_at_by_user[user_id] = monotonic()
            self._set_refresh_state(
                user_id,
                running=False,
                current=None,
                summary=summary,
                finished_at=utcnow(),
                error=None,
            )
            return DatasetRefreshResponse(
                catalog=self._catalog_from_store(db, user_id),
                summary=summary,
                status=self.refresh_status(user_id),
            )
        except Exception:
            self._set_refresh_state(
                user_id,
                running=False,
                current=None,
                finished_at=utcnow(),
                error="Dataset refresh failed",
            )
            raise
        finally:
            lock.release()

    def refresh_status(self, user_id: int) -> DatasetRefreshStatus:
        with self._state_lock:
            state = self._refresh_state_by_user.setdefault(user_id, DatasetRefreshState())
            return DatasetRefreshStatus(
                running=state.running,
                current=state.current,
                summary=state.summary,
                started_at=state.started_at,
                finished_at=state.finished_at,
                error=state.error,
            )

    def update_asset(
        self,
        db: Session,
        user_id: int,
        asset_key: str,
        payload: DatasetAssetUpdate,
    ) -> DatasetCatalogResponse:
        if self._lock_for_user(user_id).locked():
            raise DatasetRefreshInProgress("Dataset refresh is running. Try again after it completes.")
        asset = db.scalar(
            select(DatasetAsset).where(
                DatasetAsset.user_id == user_id,
                DatasetAsset.asset_key == asset_key,
            )
        )
        if asset is None:
            raise FileNotFoundError(f"Dataset asset not found: {asset_key}")
        if payload.currency is not None:
            asset.currency = payload.currency.strip().upper()
        if payload.timezone is not None:
            timezone = payload.timezone.strip()
            validate_timezone(timezone)
            asset.timezone = timezone
        if payload.pnl_multiplier is not None:
            asset.pnl_multiplier = float(payload.pnl_multiplier)
        asset.updated_at = utcnow()
        db.commit()
        return self._catalog_from_store(db, user_id)

    def resolve_dataset(
        self,
        db: Session,
        user_id: int,
        *,
        csv_path: str | None = None,
        instrument: str | None = None,
        timeframe: str | None = None,
    ) -> DatasetResolution:
        if csv_path:
            requested_path = str(Path(csv_path).expanduser())
            stored = db.scalar(
                select(DatasetTimeframe).where(
                    DatasetTimeframe.user_id == user_id,
                    DatasetTimeframe.csv_path == requested_path,
                )
            )
            if stored is None:
                self.discover_catalog(db, user_id, force=True)
                stored = db.scalar(
                    select(DatasetTimeframe).where(
                        DatasetTimeframe.user_id == user_id,
                        DatasetTimeframe.csv_path == requested_path,
                    )
                )
            if stored is not None:
                asset = db.scalar(
                    select(DatasetAsset).where(
                        DatasetAsset.id == stored.asset_id,
                        DatasetAsset.user_id == user_id,
                    )
                )
                return DatasetResolution(
                    csv_path=Path(stored.csv_path),
                    instrument=asset.asset_key if asset else instrument,
                    timeframe=stored.timeframe,
                    symbol=asset.symbol if asset else self._symbol_from_asset_key(instrument or path.parent.name),
                    currency=asset.currency if asset else None,
                    timezone=asset.timezone if asset else None,
                    pnl_multiplier=asset.pnl_multiplier if asset else 1.0,
                    stored=True,
                )
            raise FileNotFoundError("Dataset CSV not found in the authenticated user's catalog")

        if not instrument or not timeframe:
            raise ValueError("instrument and timeframe are required when csv_path is not provided")

        wanted_instrument = normalize_key(instrument)
        wanted_timeframe = normalize_timeframe(timeframe)
        assets = db.scalars(
            select(DatasetAsset).where(DatasetAsset.user_id == user_id)
        ).all()
        for asset in assets:
            if (
                normalize_key(asset.asset_key) != wanted_instrument
                and normalize_key(asset.name) != wanted_instrument
                and normalize_key(asset.symbol) != wanted_instrument
            ):
                continue
            dataset_timeframe = db.scalar(
                select(DatasetTimeframe).where(
                    DatasetTimeframe.user_id == user_id,
                    DatasetTimeframe.asset_id == asset.id,
                    DatasetTimeframe.timeframe == wanted_timeframe,
                )
            )
            if dataset_timeframe is not None:
                return DatasetResolution(
                    csv_path=Path(dataset_timeframe.csv_path),
                    instrument=asset.asset_key,
                    timeframe=dataset_timeframe.timeframe,
                    symbol=asset.symbol,
                    currency=asset.currency,
                    timezone=asset.timezone,
                    pnl_multiplier=asset.pnl_multiplier,
                    stored=True,
                )
        raise FileNotFoundError(f"No dataset found for {instrument} {timeframe}")

    def resolve_default_dataset(self, db: Session, user_id: int) -> DatasetResolution:
        catalog = self.list_catalog(db, user_id)
        for instrument in catalog.instruments:
            if not instrument.timeframes:
                continue
            return self.resolve_dataset(
                db,
                user_id,
                instrument=instrument.id,
                timeframe=instrument.timeframes[0].timeframe,
            )
        raise FileNotFoundError(f"No datasets found under {self._root_path(db, user_id)}")

    def _lock_for_user(self, user_id: int) -> Lock:
        with self._state_lock:
            return self._locks_by_user.setdefault(user_id, Lock())

    def _set_refresh_state(self, user_id: int, **changes: object) -> None:
        with self._state_lock:
            state = self._refresh_state_by_user.setdefault(user_id, DatasetRefreshState())
            for key, value in changes.items():
                setattr(state, key, value)

    def _scan_filesystem_index(
        self,
        db: Session,
        user_id: int,
        *,
        strict: bool,
        prune_missing: bool,
    ) -> DatasetRefreshSummary:
        root = self._root_path(db, user_id)
        if not root.exists():
            return DatasetRefreshSummary(assets=0, timeframes=0, candles=0)

        seen_asset_keys: set[str] = set()
        discovered_assets = 0
        discovered_timeframes = 0

        for directory in sorted(item for item in root.iterdir() if item.is_dir()):
            asset_key = directory.name
            seen_asset_keys.add(asset_key)
            asset = self._upsert_asset_record(db, user_id, asset_key, directory)
            discovered_assets += 1

            seen_timeframes: set[str] = set()
            for csv_path in sorted(directory.glob("*.csv")):
                timeframe = self._timeframe_from_file(csv_path)
                if timeframe is None:
                    continue
                seen_timeframes.add(timeframe)
                try:
                    self._index_timeframe_file(db, user_id, asset, timeframe, csv_path)
                except ValueError:
                    if strict:
                        raise
                    continue
                discovered_timeframes += 1

            if prune_missing:
                stale_timeframes = db.scalars(
                    select(DatasetTimeframe).where(
                        DatasetTimeframe.user_id == user_id,
                        DatasetTimeframe.asset_id == asset.id,
                    )
                ).all()
                for stale_timeframe in stale_timeframes:
                    if stale_timeframe.timeframe not in seen_timeframes:
                        db.delete(stale_timeframe)

        if prune_missing:
            stale_assets = db.scalars(
                select(DatasetAsset).where(DatasetAsset.user_id == user_id)
            ).all()
            for stale_asset in stale_assets:
                if stale_asset.asset_key in seen_asset_keys:
                    continue
                db.delete(stale_asset)

        return DatasetRefreshSummary(
            assets=discovered_assets,
            timeframes=discovered_timeframes,
            candles=0,
        )

    def _sync_session_replay_ready(self, db: Session, user_id: int) -> None:
        known_csv_paths = {
            row
            for row in db.scalars(
                select(DatasetTimeframe.csv_path).where(DatasetTimeframe.user_id == user_id)
            ).all()
            if row
        }
        sessions = db.scalars(
            select(BacktestSession).where(BacktestSession.user_id == user_id)
        ).all()
        for session in sessions:
            if session.timeframe == "Imported":
                continue
            next_ready = bool(session.csv_path and session.csv_path in known_csv_paths)
            if session.replay_ready != next_ready:
                session.replay_ready = next_ready
                session.updated_at = utcnow()

    def _upsert_asset_record(
        self,
        db: Session,
        user_id: int,
        asset_key: str,
        directory: Path,
    ) -> DatasetAsset:
        asset = db.scalar(
            select(DatasetAsset).where(
                DatasetAsset.user_id == user_id,
                DatasetAsset.asset_key == asset_key,
            )
        )
        if asset is None:
            asset = DatasetAsset(
                user_id=user_id,
                asset_key=asset_key,
                name=directory.name.replace("_", "/"),
                symbol=self._symbol_from_asset_key(asset_key),
                folder_path=str(directory),
                currency="USD",
                timezone="UTC",
                pnl_multiplier=1.0,
            )
            db.add(asset)
            db.flush()
        else:
            name = directory.name.replace("_", "/")
            symbol = self._symbol_from_asset_key(asset_key)
            folder_path = str(directory)
            if asset.name != name or asset.symbol != symbol or asset.folder_path != folder_path:
                asset.name = name
                asset.symbol = symbol
                asset.folder_path = folder_path
                asset.updated_at = utcnow()
        return asset

    def _index_timeframe_file(
        self,
        db: Session,
        user_id: int,
        asset: DatasetAsset,
        timeframe: str,
        csv_path: Path,
    ) -> DatasetTimeframe:
        stat = csv_path.stat()
        existing = db.scalar(
            select(DatasetTimeframe).where(
                DatasetTimeframe.user_id == user_id,
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
            if existing.imported:
                existing.imported = False
                existing.updated_at = utcnow()
            return existing

        metadata = self._read_csv_metadata(csv_path)
        if existing is None:
            existing = DatasetTimeframe(
                user_id=user_id,
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

    def _catalog_from_store(self, db: Session, user_id: int) -> DatasetCatalogResponse:
        instruments: list[DatasetInstrument] = []
        assets = db.scalars(
            select(DatasetAsset)
            .where(DatasetAsset.user_id == user_id)
            .order_by(DatasetAsset.name.asc())
        ).all()
        timeframes_by_asset_id: dict[int, list[DatasetTimeframe]] = defaultdict(list)
        for timeframe in db.scalars(
            select(DatasetTimeframe)
            .where(DatasetTimeframe.user_id == user_id)
            .order_by(DatasetTimeframe.asset_id.asc())
        ).all():
            timeframes_by_asset_id[timeframe.asset_id].append(timeframe)

        for asset in assets:
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
                    timeframes_by_asset_id.get(asset.id, []),
                    key=lambda row: TIMEFRAME_ORDER.get(row.timeframe, 999999),
                )
            ]
            if not timeframe_reads:
                continue
            instruments.append(
                DatasetInstrument(
                    id=asset.asset_key,
                    name=asset.name,
                    symbol=asset.symbol,
                    currency=asset.currency,
                    timezone=asset.timezone,
                    pnl_multiplier=asset.pnl_multiplier,
                    folder_path=asset.folder_path,
                    updated_at=asset.updated_at,
                    timeframes=timeframe_reads,
                )
            )
        return DatasetCatalogResponse(root=str(self._root_path(db, user_id)), instruments=instruments)

    def _root_path(self, db: Session, user_id: int) -> Path:
        return Path(self._settings_row(db, user_id).root_path)

    def _settings_row(self, db: Session, user_id: int) -> DatasetSettings:
        settings_row = db.scalar(
            select(DatasetSettings).where(DatasetSettings.user_id == user_id)
        )
        if settings_row is None:
            settings_row = DatasetSettings(user_id=user_id, root_path=str(self.default_root))
            db.add(settings_row)
            db.flush()
        return settings_row

    def _timeframe_from_file(self, csv_path: Path) -> str | None:
        suffix = csv_path.stem.split("_")[-1]
        normalized = normalize_timeframe(suffix)
        return normalized if normalized in TIMEFRAME_ORDER else None

    def _symbol_from_asset_key(self, asset_key: str) -> str:
        return asset_key.replace("_", "").replace("/", "").upper()

    def _symbol_from_file(self, csv_path: Path, fallback: str | None = None) -> str:
        if fallback:
            return self._symbol_from_asset_key(fallback)
        return self._symbol_from_asset_key(csv_path.parent.name or csv_path.stem)


def validate_timezone(value: str) -> None:
    try:
        ZoneInfo(value or "UTC")
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"Unknown timestamp timezone: {value}") from exc


def parse_source_timestamp(value: str | None, timestamp_timezone: str) -> datetime | None:
    if not value:
        return None
    parsed = datetime.strptime(value, SOURCE_TIMESTAMP_FORMAT)
    try:
        source_timezone = ZoneInfo(timestamp_timezone or "UTC")
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"Unknown timestamp timezone: {timestamp_timezone}") from exc
    return parsed.replace(tzinfo=source_timezone).astimezone(timezone.utc)


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
