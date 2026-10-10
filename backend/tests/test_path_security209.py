from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.api import routes
from app.db import Base
from app.models import AppStorageItem, BetaUser
from app.schemas import AppDataBundle
from app.services.backtester import BacktestService
from app.services.market_data import MarketDataService


def csv(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("Timestamp,Open,High,Low,Close,Volume\n2026-01-01,1,2,1,2,3\n")
    return path


def test_configured_reader_confines_paths_and_keeps_legacy_exception(tmp_path, monkeypatch):
    root = tmp_path / "datasets"
    local = csv(root / "EURUSD" / "M1.csv")
    legacy = csv(tmp_path / "legacy.csv")
    outside = csv(tmp_path / "private.csv")
    service = BacktestService(MarketDataService(legacy), SimpleNamespace(default_root=root))
    monkeypatch.chdir(tmp_path)
    assert service.market_data_for_path("datasets/EURUSD/M1.csv").get_metadata().rows == 1
    assert service.market_data_for_path(str(legacy)).get_metadata().rows == 1
    for path in (outside, root / ".." / "private.csv"):
        with pytest.raises(ValueError, match="configured dataset directory"):
            service.market_data_for_path(str(path))
    legacy_only = BacktestService(MarketDataService(legacy))
    with pytest.raises(ValueError, match="configured dataset directory"):
        legacy_only.market_data_for_path(str(local))


def test_reader_rechecks_symlinks_before_reusing_cached_service(tmp_path):
    root = tmp_path / "datasets"
    local = csv(root / "local.csv")
    outside = csv(tmp_path / "private.csv")
    link = root / "linked.csv"
    link.symlink_to(local)
    service = BacktestService(dataset_catalog=SimpleNamespace(default_root=root))
    original = service.market_data_for_path(str(link))
    assert original.get_metadata().rows == 1
    link.unlink()
    link.symlink_to(outside)
    with pytest.raises(ValueError, match="configured dataset directory"):
        service.market_data_for_path(str(link))
    assert original.csv_path == local.resolve()


@pytest.mark.parametrize("table", ["backtest_sessions", "dataset_timeframes"])
@pytest.mark.parametrize("escape", ["absolute", "traversal", "symlink"])
def test_import_rejects_file_escapes_before_replacing_saved_data(tmp_path, monkeypatch, table, escape):
    root = tmp_path / "datasets"
    root.mkdir()
    outside = csv(tmp_path / "private.csv")
    link = root / "linked.csv"
    link.symlink_to(outside)
    path = {"absolute": outside, "traversal": root / ".." / "private.csv", "symlink": link}[escape]
    monkeypatch.setattr(routes, "backtester", BacktestService(dataset_catalog=SimpleNamespace(default_root=root)))
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        user = BetaUser(email="path-audit@example.test", name="Audit", provider="google", status="APPROVED")
        db.add(user)
        db.flush()
        db.add(AppStorageItem(user_id=user.id, namespace="audit", key="saved", value={"preserved": True}))
        db.commit()
        row = {"id": 999, "csv_path": str(path)}
        tables = {table: [row]}
        if table == "dataset_timeframes":
            tables["dataset_assets"] = [{"id": 998, "asset_key": "TEST", "name": "Test", "symbol": "TEST", "folder_path": str(root)}]
            row.update(asset_id=998, timeframe="M1")
        with pytest.raises(HTTPException) as error:
            routes.import_app_data(AppDataBundle(app="edgelab", version=1, tables=tables), db, SimpleNamespace(id=user.id))
        assert error.value.status_code == 400
        assert "configured dataset directory" in error.value.detail
        assert db.scalar(select(AppStorageItem).where(AppStorageItem.user_id == user.id)).value == {"preserved": True}
    engine.dispose()
