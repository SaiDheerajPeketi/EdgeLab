from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api import routes
from app.schemas import BinanceInstrumentsResponse


def symbol_filters():
    return [
        {"filterType": "PRICE_FILTER", "tickSize": "0.03000000"},
        {"filterType": "LOT_SIZE", "minQty": "0.05000000", "stepSize": "0.02500000"},
        {"filterType": "MARKET_LOT_SIZE", "minQty": "0.10000000", "stepSize": "0.01000000"},
    ]


def catalog_row(symbol="BTCUSDT", **changes):
    return {
        "symbol": symbol,
        "baseAsset": "BTC",
        "quoteAsset": "USDT",
        "status": "TRADING",
        "isSpotTradingAllowed": True,
        "filters": symbol_filters(),
        **changes,
    }


def test_binance_filters_preserve_distinct_price_tick_minimum_and_increment():
    assert routes.binance_symbol_filter_metadata(symbol_filters()) == {
        "tick_size": 0.03,
        "min_quantity": 0.05,
        "quantity_step": 0.025,
    }


@pytest.mark.parametrize("invalid", [None, True, False, "", "bad", "nan", "inf", "-inf", float("nan"), float("inf"), 0, -0.01, "1e-11", "1e10", [], {}])
@pytest.mark.parametrize("filter_index, source_field, output_field", [
    (0, "tickSize", "tick_size"),
    (1, "minQty", "min_quantity"),
    (1, "stepSize", "quantity_step"),
])
def test_invalid_filter_values_remain_unavailable(invalid, filter_index, source_field, output_field):
    filters = symbol_filters()
    filters[filter_index][source_field] = invalid
    expected = {"tick_size": 0.03, "min_quantity": 0.05, "quantity_step": 0.025}
    expected[output_field] = None
    assert routes.binance_symbol_filter_metadata(filters) == expected


@pytest.mark.parametrize("invalid_filters", [None, {}, "filters", [], [None, "bad", {}, 1]])
def test_missing_or_malformed_filters_do_not_invent_instrument_metadata(invalid_filters):
    assert routes.binance_symbol_filter_metadata(invalid_filters) == {
        "tick_size": None,
        "min_quantity": None,
        "quantity_step": None,
    }


@pytest.mark.parametrize("duplicate_index, expected", [
    (0, {"tick_size": None, "min_quantity": 0.05, "quantity_step": 0.025}),
    (1, {"tick_size": 0.03, "min_quantity": None, "quantity_step": None}),
])
def test_duplicate_filters_are_ambiguous_even_when_values_agree(duplicate_index, expected):
    filters = symbol_filters()
    filters.append(dict(filters[duplicate_index]))
    assert routes.binance_symbol_filter_metadata(filters) == expected


def test_catalog_route_serializes_filters_and_keeps_existing_spot_selection(monkeypatch):
    calls = []
    monkeypatch.setattr(routes, "enforce_rate_limit", lambda *args: calls.append(args))
    monkeypatch.setattr(routes, "fetch_binance_exchange_info", lambda: {"symbols": [
        catalog_row(),
        catalog_row("UNKNOWNUSDT", filters=None),
        catalog_row("HALTEDUSDT", status="HALT"),
        catalog_row("NO_SPOTUSDT", isSpotTradingAllowed=False),
        catalog_row("", baseAsset=""),
        None,
    ]})
    response = routes.binance_instruments(search=None, limit=5000, current_user=SimpleNamespace(id=69))
    assert isinstance(response, BinanceInstrumentsResponse)
    payload = BinanceInstrumentsResponse.model_validate_json(response.model_dump_json()).model_dump()
    assert [item["symbol"] for item in payload["instruments"]] == ["BTCUSDT", "UNKNOWNUSDT"]
    assert {field: payload["instruments"][0][field] for field in ("tick_size", "min_quantity", "quantity_step")} == {
        "tick_size": 0.03, "min_quantity": 0.05, "quantity_step": 0.025,
    }
    assert all(payload["instruments"][1][field] is None for field in ("tick_size", "min_quantity", "quantity_step"))
    assert len(calls) == 1
    assert calls[0][:2] == ("live-instruments", 69)


def test_catalog_route_search_and_limit_keep_selected_metadata(monkeypatch):
    monkeypatch.setattr(routes, "enforce_rate_limit", lambda *_args: None)
    monkeypatch.setattr(routes, "fetch_binance_exchange_info", lambda: {"symbols": [
        catalog_row(), catalog_row("ETHUSDT", baseAsset="ETH"),
    ]})
    response = routes.binance_instruments(search=" ethusdt ", limit=1, current_user=SimpleNamespace(id=69))
    assert len(response.instruments) == 1
    instrument = response.instruments[0]
    assert instrument.symbol == "ETHUSDT"
    assert instrument.min_quantity == 0.05
    assert instrument.quantity_step == 0.025


def test_catalog_route_reports_unavailable_catalog(monkeypatch):
    monkeypatch.setattr(routes, "enforce_rate_limit", lambda *_args: None)
    monkeypatch.setattr(routes, "fetch_binance_exchange_info", lambda: {"symbols": None})
    with pytest.raises(HTTPException) as failure:
        routes.binance_instruments(search=None, limit=5000, current_user=SimpleNamespace(id=69))
    assert failure.value.status_code == 502
