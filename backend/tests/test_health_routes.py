from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api import routes


class FakeDatasetCatalog:
    def list_catalog(self, db):
        return SimpleNamespace(
            root="/datasets",
            instruments=[
                SimpleNamespace(timeframes=[SimpleNamespace(timeframe="M1")]),
                SimpleNamespace(timeframes=[SimpleNamespace(timeframe="H1")]),
            ],
        )


def make_session():
    engine = create_engine("sqlite:///:memory:")
    session_factory = sessionmaker(bind=engine)
    return session_factory()


def test_health_does_not_require_dataset_catalog(monkeypatch):
    monkeypatch.setattr(routes, "dataset_catalog", object())
    db = make_session()
    try:
        assert routes.health(db) == {"status": "ok", "database": "ok"}
    finally:
        db.close()


def test_ready_reports_dataset_catalog_counts(monkeypatch):
    monkeypatch.setattr(routes, "dataset_catalog", FakeDatasetCatalog())
    db = make_session()
    try:
        assert routes.ready(db) == {
            "status": "ok",
            "database": "ok",
            "datasets_root": "/datasets",
            "dataset_assets": "2",
            "dataset_timeframes": "2",
        }
    finally:
        db.close()
