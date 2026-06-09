from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api import routes


class MissingMarketData:
    def validate_source(self) -> None:
        raise FileNotFoundError("CSV file not found: /missing/EURUSD_M1.csv")


def make_session():
    engine = create_engine("sqlite:///:memory:")
    session_factory = sessionmaker(bind=engine)
    return session_factory()


def test_health_does_not_require_market_data(monkeypatch):
    monkeypatch.setattr(routes, "market_data", MissingMarketData())
    db = make_session()
    try:
        assert routes.health(db) == {"status": "ok", "database": "ok"}
    finally:
        db.close()


def test_ready_reports_missing_market_data(monkeypatch):
    monkeypatch.setattr(routes, "market_data", MissingMarketData())
    db = make_session()
    try:
        try:
            routes.ready(db)
        except HTTPException as exc:
            assert exc.status_code == 503
            assert "Market data CSV is unavailable" in str(exc.detail)
        else:
            raise AssertionError("ready should fail when market data is missing")
    finally:
        db.close()
