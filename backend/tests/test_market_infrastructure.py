from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.migrations import run_migrations
from app.models import (
    BetaUser,
    MarketAlertEvent,
    MarketBackfillRun,
    MarketDataDiagnostic,
    MarketProviderState,
    MarketTradeTick,
    PersistedFootprint,
)
from app.schemas import (
    ContinuousContractRuleCreate,
    ExchangeCalendarCreate,
    ExchangeSessionTemplate,
    MarketAlertRuleCreate,
    MarketBackfillCreate,
    MarketContractCreate,
    MarketIdentifierCreate,
    MarketInstrumentCreate,
    MarketSubscriptionCreate,
    OrderBookLevelInput,
)
from app.services import market_infrastructure as market


UTC = timezone.utc


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    with factory() as session:
        yield session


def seed_user(db, email: str) -> BetaUser:
    row = BetaUser(email=email, name=email.split("@", 1)[0], provider="google", status="APPROVED")
    db.add(row)
    db.commit()
    return row


def create_instrument(
    db,
    user_id: int,
    *,
    symbol: str,
    asset_class: str = "CRYPTO",
    tick_size: str = "0.01",
    continuous: bool = False,
    calendar_id: int | None = None,
):
    return market.create_instrument(
        db,
        user_id,
        MarketInstrumentCreate(
            canonical_symbol=symbol,
            display_name=symbol,
            asset_class=asset_class,
            instrument_type="CONTINUOUS" if continuous else "SPOT",
            exchange="CME" if asset_class == "FUTURE" else "FIXTURE",
            currency="USD",
            timezone="America/New_York" if calendar_id else "UTC",
            calendar_id=calendar_id,
            tick_size=Decimal(tick_size),
            tick_value=Decimal("12.50") if asset_class == "FUTURE" else Decimal(tick_size),
            contract_multiplier=Decimal("50") if asset_class == "FUTURE" else Decimal("1"),
            continuous=continuous,
            identifiers=[
                MarketIdentifierCreate(provider="offline-fixture", provider_symbol=symbol)
            ],
        ),
    )


def test_canonical_instruments_calendars_contract_roll_entitlements_and_isolation(db):
    owner = seed_user(db, "market-owner@example.com")
    other = seed_user(db, "market-other@example.com")
    calendar = market.create_exchange_calendar(
        db,
        owner.id,
        ExchangeCalendarCreate(
            code="CME-US",
            exchange="CME",
            timezone="America/New_York",
            holidays=[date(2024, 7, 4)],
            session_templates=[
                ExchangeSessionTemplate(
                    name="RTH", weekdays=[0, 1, 2, 3, 4], opens_at="09:30", closes_at="16:00"
                )
            ],
        ),
    )
    assert market.market_session_at(
        db, owner.id, calendar.id, datetime(2024, 6, 3, 14, 0, tzinfo=UTC)
    )["is_open"] is True
    assert market.market_session_at(
        db, owner.id, calendar.id, datetime(2024, 7, 4, 14, 0, tzinfo=UTC)
    )["is_open"] is False

    future = create_instrument(
        db,
        owner.id,
        symbol="ES.CONT",
        asset_class="FUTURE",
        tick_size="0.25",
        continuous=True,
        calendar_id=calendar.id,
    )
    june = market.create_contract(
        db,
        owner.id,
        future.id,
        MarketContractCreate(
            contract_symbol="ESM24",
            provider="offline-fixture",
            provider_symbol="ESM24",
            expires_on=date(2024, 6, 21),
            roll_on=date(2024, 6, 14),
        ),
    )
    september = market.create_contract(
        db,
        owner.id,
        future.id,
        MarketContractCreate(
            contract_symbol="ESU24",
            provider="offline-fixture",
            provider_symbol="ESU24",
            expires_on=date(2024, 9, 20),
            roll_on=date(2024, 9, 13),
        ),
    )
    market.set_continuous_contract_rule(
        db,
        owner.id,
        future.id,
        ContinuousContractRuleCreate(method="CALENDAR", days_before_expiry=5, adjustment="DIFFERENCE"),
    )
    assert market.resolve_continuous_contract(
        db, owner.id, future.id, as_of=date(2024, 6, 10)
    )["active_contract"].id == june.id
    assert market.resolve_continuous_contract(
        db, owner.id, future.id, as_of=date(2024, 6, 15)
    )["active_contract"].id == september.id

    crypto = create_instrument(db, owner.id, symbol="BTC-USD")
    assert market.effective_entitlement(
        db, owner.id, asset_class="CRYPTO", capability="FOOTPRINT"
    ).tier == "FREE"
    denied = market.effective_entitlement(
        db, owner.id, asset_class="FUTURE", capability="DEPTH"
    )
    assert denied.allowed is False
    assert "licensed-data entitlement" in denied.reason
    market.grant_entitlement(
        db,
        owner.id,
        asset_class="FUTURE",
        capability="DEPTH",
        source="test-billing-fixture",
    )
    db.commit()
    assert market.effective_entitlement(
        db, owner.id, asset_class="FUTURE", capability="DEPTH"
    ).tier == "PAID"

    assert [item.canonical_symbol for item in market.list_instruments(db, owner.id)] == [
        "BTC-USD",
        "ES.CONT",
    ]
    assert market.list_instruments(db, other.id) == []
    with pytest.raises(market.MarketNotFoundError):
        market.list_contracts(db, other.id, future.id)
    with pytest.raises(market.MarketNotFoundError):
        market.get_order_book(db, other.id, crypto.id)


def test_idempotent_backfill_gap_recovery_footprints_depth_and_alerts(db):
    owner = seed_user(db, "flow-owner@example.com")
    instrument = create_instrument(db, owner.id, symbol="BTCUSD")
    start = datetime(2024, 1, 1, tzinfo=UTC)
    adapter = market.OfflineFixtureAdapter(
        trades={
            "BTCUSD": (
                market.TradeTickRecord("t1", 1, start + timedelta(seconds=1), Decimal("100.01"), Decimal("1"), "ASK"),
                market.TradeTickRecord("t3", 3, start + timedelta(seconds=3), Decimal("100.02"), Decimal("2"), "BID"),
            )
        },
        depth={
            "BTCUSD": (
                market.DepthSnapshotRecord(
                    sequence=1,
                    captured_at=start + timedelta(seconds=4),
                    levels=(
                        OrderBookLevelInput(side="BID", price=Decimal("100.01"), size=Decimal("2"), order_count=1),
                        OrderBookLevelInput(side="BID", price=Decimal("100.00"), size=Decimal("3"), order_count=2),
                        OrderBookLevelInput(side="ASK", price=Decimal("100.01"), size=Decimal("4"), order_count=1),
                        OrderBookLevelInput(side="ASK", price=Decimal("100.02"), size=Decimal("5"), order_count=2),
                    ),
                ),
            )
        },
    )
    registry = market.MarketProviderRegistry([adapter])
    request = MarketBackfillCreate(
        provider="offline-fixture",
        instrument_id=instrument.id,
        data_type="TRADES",
        from_at=start,
        to_at=start + timedelta(minutes=1),
        idempotency_key="btc-gap-backfill",
    )
    first = market.run_historical_backfill(db, owner.id, request, registry=registry)
    second = market.run_historical_backfill(db, owner.id, request, registry=registry)
    assert first.id == second.id
    assert (first.status, first.received_count, first.inserted_count, first.gap_count) == (
        "COMPLETED_WITH_GAPS",
        2,
        2,
        1,
    )
    assert len(db.scalars(select(MarketTradeTick).where(MarketTradeTick.user_id == owner.id)).all()) == 2
    gap = db.scalar(
        select(MarketDataDiagnostic).where(
            MarketDataDiagnostic.user_id == owner.id,
            MarketDataDiagnostic.code == "SEQUENCE_GAP",
            MarketDataDiagnostic.state == "OPEN",
        )
    )
    assert gap is not None

    incomplete = market.build_footprints(
        db,
        owner.id,
        instrument.id,
        provider="offline-fixture",
        from_at=start,
        to_at=start + timedelta(minutes=1),
        interval_seconds=60,
    )
    assert len(incomplete) == 1
    assert incomplete[0].complete is False
    assert incomplete[0].total_volume == Decimal("3.000000000000")
    assert incomplete[0].delta == Decimal("-1.000000000000")

    inserted, duplicates, gaps = market.ingest_trade_ticks(
        db,
        owner.id,
        instrument.id,
        "offline-fixture",
        [
            market.TradeTickRecord(
                "t2", 2, start + timedelta(seconds=2), Decimal("100.015"), Decimal("3"), "UNKNOWN"
            )
        ],
    )
    db.commit()
    assert (inserted, duplicates, gaps) == (1, 0, 0)
    assert gap.state == "RESOLVED"
    state = db.scalar(
        select(MarketProviderState).where(
            MarketProviderState.user_id == owner.id,
            MarketProviderState.instrument_scope == f"{instrument.id}:TRADES",
        )
    )
    assert state.incomplete is False
    rebuilt = market.build_footprints(
        db,
        owner.id,
        instrument.id,
        provider="offline-fixture",
        from_at=start,
        to_at=start + timedelta(minutes=1),
        interval_seconds=60,
    )
    assert rebuilt[0].id == incomplete[0].id
    assert rebuilt[0].complete is True
    assert rebuilt[0].total_volume == Decimal("6.000000000000")
    assert db.scalar(select(PersistedFootprint.id)) == rebuilt[0].id

    depth_request = MarketBackfillCreate(
        provider="offline-fixture",
        instrument_id=instrument.id,
        data_type="DEPTH",
        from_at=start,
        to_at=start + timedelta(minutes=1),
        idempotency_key="btc-depth-backfill",
    )
    assert market.run_historical_backfill(db, owner.id, depth_request, registry=registry).status == "COMPLETED"
    book = market.get_order_book(
        db,
        owner.id,
        instrument.id,
        provider="offline-fixture",
        aggregation_ticks=2,
        now=start + timedelta(seconds=10),
    )
    assert book.status == "AVAILABLE"
    assert book.aggregation_tick_size == Decimal("0.020000000000")
    assert [(level.side, level.price, level.size) for level in book.levels] == [
        ("BID", Decimal("100.000000000000"), Decimal("5.000000000000")),
        ("ASK", Decimal("100.020000000000"), Decimal("9.000000000000")),
    ]

    price_rule = market.create_alert_rule(
        db,
        owner.id,
        MarketAlertRuleCreate(
            instrument_id=instrument.id,
            name="Cross 101",
            alert_type="PRICE_CROSSES_ABOVE",
            threshold=Decimal("101"),
            cooldown_seconds=0,
        ),
    )
    gap_rule = market.create_alert_rule(
        db,
        owner.id,
        MarketAlertRuleCreate(
            instrument_id=instrument.id,
            name="Missing ticks",
            alert_type="SEQUENCE_GAP",
            provider="offline-fixture",
            cooldown_seconds=0,
        ),
    )
    market.ingest_trade_ticks(
        db,
        owner.id,
        instrument.id,
        "offline-fixture",
        [
            market.TradeTickRecord("t4", 4, start + timedelta(seconds=4), Decimal("100"), Decimal("1"), "ASK"),
            market.TradeTickRecord("t5", 5, start + timedelta(seconds=5), Decimal("102"), Decimal("1"), "ASK"),
            market.TradeTickRecord("t8", 8, start + timedelta(seconds=8), Decimal("103"), Decimal("1"), "ASK"),
        ],
    )
    db.commit()
    events = market.list_alert_events(db, owner.id)
    assert {event.rule_id for event in events} == {price_rule.id, gap_rule.id}
    acknowledged = market.acknowledge_alert_event(db, owner.id, events[0].id)
    assert acknowledged.acknowledged_at is not None
    assert db.scalar(select(MarketAlertEvent).where(MarketAlertEvent.id == events[0].id)) is not None


def test_truthful_unavailable_provider_stale_health_and_bounded_fanout(db):
    owner = seed_user(db, "provider-owner@example.com")
    instrument = create_instrument(db, owner.id, symbol="ETHUSD")
    catalog = market.provider_registry.catalog()
    licensed = next(item for item in catalog if item.provider_id == "licensed-futures")
    assert licensed.live is False
    assert licensed.licensed is False
    assert licensed.availability == "CONFIGURATION_REQUIRED"
    assert "No licensed futures adapter" in licensed.message

    request = MarketBackfillCreate(
        provider="licensed-futures",
        instrument_id=instrument.id,
        data_type="CANDLES",
        from_at=datetime(2024, 1, 1, tzinfo=UTC),
        to_at=datetime(2024, 1, 2, tzinfo=UTC),
        idempotency_key="unavailable-provider",
    )
    with pytest.raises(market.MarketProviderUnavailableError, match="No licensed futures adapter"):
        market.run_historical_backfill(db, owner.id, request)
    failed = db.scalar(
        select(MarketBackfillRun).where(MarketBackfillRun.idempotency_key == "unavailable-provider")
    )
    assert failed.status == "FAILED"
    assert failed.error_message and "No licensed futures adapter" in failed.error_message

    market.reconnect_provider(
        db, owner.id, provider="offline-fixture", instrument_id=instrument.id
    )
    state = db.scalar(
        select(MarketProviderState).where(
            MarketProviderState.user_id == owner.id,
            MarketProviderState.provider == "offline-fixture",
            MarketProviderState.instrument_scope == f"{instrument.id}:*",
        )
    )
    state.last_heartbeat_at = datetime(2024, 1, 1)
    state.stale_after_seconds = 5
    db.commit()
    market.create_alert_rule(
        db,
        owner.id,
        MarketAlertRuleCreate(
            instrument_id=instrument.id,
            name="Feed stale",
            alert_type="PROVIDER_STALE",
            provider="offline-fixture",
            cooldown_seconds=0,
        ),
    )
    checked = market.check_provider_health(db, owner.id, now=datetime(2024, 1, 1, 0, 0, 6))
    assert next(item for item in checked if item.provider == "offline-fixture").health == "STALE"
    assert any(item.code == "STALE_FEED" for item in market.list_diagnostics(db, owner.id))
    assert any("provider" in event.payload for event in market.list_alert_events(db, owner.id))

    hub = market.MarketFanoutHub(max_panes_per_user=2, max_queue_depth=2)
    one = hub.subscribe(
        owner.id,
        MarketSubscriptionCreate(pane_id="pane-1", instrument_id=instrument.id, channels=["TRADES"]),
    )
    hub.subscribe(
        owner.id,
        MarketSubscriptionCreate(pane_id="pane-2", instrument_id=instrument.id, channels=["TRADES"]),
    )
    with pytest.raises(market.MarketConflictError, match="At most 2"):
        hub.subscribe(
            owner.id,
            MarketSubscriptionCreate(pane_id="pane-3", instrument_id=instrument.id, channels=["TRADES"]),
        )
    for index in range(3):
        hub.publish(owner.id, "TRADES", instrument.id, {"index": index})
    assert hub.list(owner.id)[0].dropped_events == 1
    assert [event.payload["index"] for event in hub.poll(owner.id, one.subscription_id)] == [1, 2]
    with pytest.raises(market.MarketNotFoundError):
        hub.poll(owner.id + 1, one.subscription_id)


def test_sqlite_compat_migration_creates_market_tables(tmp_path):
    database = tmp_path / "market-migration.sqlite3"
    url = f"sqlite:///{database}"
    engine = create_engine(url)
    Base.metadata.tables["beta_users"].create(engine)
    run_migrations(engine, url)
    run_migrations(engine, url)
    tables = set(inspect(engine).get_table_names())
    assert {
        "exchange_calendars",
        "market_instruments",
        "market_trade_ticks",
        "normalized_candles",
        "order_book_snapshots",
        "persisted_footprints",
        "market_backfill_runs",
        "market_alert_rules",
        "market_alert_events",
    } <= tables
