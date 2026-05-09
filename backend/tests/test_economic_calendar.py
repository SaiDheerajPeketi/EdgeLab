from datetime import datetime

from app.api.routes import normalize_forex_factory_event


def test_normalize_forex_factory_event_maps_export_payload():
    event = normalize_forex_factory_event(
        {
            "title": "Non-Farm Employment Change",
            "country": "usd",
            "date": "2026-05-08T08:30:00-04:00",
            "impact": "High",
            "forecast": "120K",
            "previous": "85K",
            "actual": "175K",
        }
    )

    assert event is not None
    assert event.title == "Non-Farm Employment Change"
    assert event.currency == "USD"
    assert event.impact == "High"
    assert event.forecast == "120K"
    assert event.previous == "85K"
    assert event.actual == "175K"
    assert event.starts_at == datetime.fromisoformat("2026-05-08T08:30:00-04:00")


def test_normalize_forex_factory_event_rejects_invalid_rows():
    assert normalize_forex_factory_event({}) is None
    assert normalize_forex_factory_event({"title": "CPI", "country": "USD"}) is None
