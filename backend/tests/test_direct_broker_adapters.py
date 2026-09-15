from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import pytest

from app.services import broker_sync


class MockTransport:
    def __init__(self, responses: Mapping[str, Any]) -> None:
        self.responses = responses
        self.calls: list[tuple[str, dict[str, str], dict[str, str] | None]] = []

    def get_json(
        self, url: str, *, headers: Mapping[str, str], query: Mapping[str, str] | None = None
    ) -> Any:
        self.calls.append((url, dict(headers), dict(query) if query else None))
        return next(response for suffix, response in self.responses.items() if url.endswith(suffix))


@pytest.mark.parametrize(
    ("adapter_type", "base_url", "credentials", "paths", "auth_header"),
    [
        (
            broker_sync.TradovateBrokerAdapter,
            "https://mock.tradovate.test/v1",
            {"access_token": "secret-tradovate-token"},
            ("/account/list", "/order/list", "/fill/list"),
            "Authorization",
        ),
        (
            broker_sync.NinjaTraderBrokerAdapter,
            "https://mock.ninjatrader.test/api/v1",
            {"api_key": "secret-ninja-key"},
            ("/accounts", "/orders", "/fills"),
            "X-API-Key",
        ),
    ],
)
def test_direct_adapter_normalizes_accounts_orders_fills_and_cursor(
    adapter_type, base_url, credentials, paths, auth_header
):
    responses = {
        paths[0]: [{"id": "A-1", "name": "Futures account", "currency": "usd"}],
        paths[1]: {
            "items": [{
                "id": "O-1", "accountId": "A-1", "symbol": "MESZ6", "side": "Buy",
                "orderType": "Market", "status": "Filled", "quantity": "2",
                "filledQuantity": "2", "averageFillPrice": "6000.25", "commission": "1.2",
                "fees": "0.3", "createdAt": "2026-09-15T10:00:00Z",
                "updatedAt": "2026-09-15T10:00:02Z", "revision": 4,
            }],
            "nextCursor": "order-4",
        },
        paths[2]: {
            "items": [{
                "id": "F-1", "orderId": "O-1", "accountId": "A-1", "symbol": "MESZ6",
                "side": "Buy", "quantity": "2", "price": "6000.25", "commission": "1.2",
                "fees": "0.3", "executedAt": "2026-09-15T10:00:02Z", "revision": 4,
            }],
            "nextCursor": "fill-4",
        },
    }
    transport = MockTransport(responses)
    adapter = adapter_type(transport=transport, base_url=base_url)

    batch = adapter.fetch_incremental(credentials, "previous-cursor")

    assert batch.next_cursor == "fill-4"
    assert batch.accounts[0].external_account_id == "A-1"
    assert batch.orders[0].average_fill_price == broker_sync.Decimal("6000.25")
    assert batch.fills[0].external_order_id == "O-1"
    assert transport.calls[1][2] == {"cursor": "previous-cursor"}
    assert transport.calls[2][2] == {"cursor": "previous-cursor"}
    assert all(auth_header in headers for _, headers, _ in transport.calls)
    assert "secret" not in repr(batch)


def test_ninjatrader_adapter_reports_server_configuration_and_missing_credentials():
    adapter = broker_sync.NinjaTraderBrokerAdapter(transport=MockTransport({}), base_url="")
    with pytest.raises(broker_sync.BrokerAuthenticationError):
        adapter.fetch_incremental({}, None)
    with pytest.raises(broker_sync.BrokerProviderUnavailableError, match="HTTPS"):
        adapter.fetch_incremental({"api_key": "write-only"}, None)


def test_provider_catalog_is_honest_about_ninjatrader_configuration(monkeypatch):
    monkeypatch.delenv("EDGELAB_NINJATRADER_API_BASE_URL", raising=False)
    catalog = {item.provider_id: item for item in broker_sync.list_provider_catalog()}
    assert catalog["tradovate"].availability == "available"
    assert catalog["ninjatrader"].availability in {"available", "unconfigured"}
    assert catalog["tradovate"].capabilities.incremental_sync is True
    assert catalog["ninjatrader"].capabilities.accounts is True
