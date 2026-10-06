from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.migrations import run_migrations
from app.models import (
    AppStorageItem,
    BacktestSession,
    BetaUser,
    BrokerAccount,
    BrokerConnection,
    BrokerFill,
    CanonicalExecution,
    CanonicalTrade,
    JournalAccount,
    JournalImportRow,
    Trade,
)
from app.schemas import (
    CanonicalTradeCreate,
    CanonicalTradeReviewUpdate,
    JournalAccountCreate,
    JournalDailyNoteUpsert,
    JournalImportCreate,
    JournalImportGrouping,
    JournalTagCreate,
)
from app.services import journal


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    with session_factory() as session:
        yield session


def seed_user(db, email: str) -> BetaUser:
    user = BetaUser(
        email=email,
        name=email.split("@", 1)[0],
        provider="google",
        status="APPROVED",
    )
    db.add(user)
    db.commit()
    return user


def create_account(db, user: BetaUser, name: str = "Primary"):
    return journal.create_account(
        db,
        user.id,
        JournalAccountCreate(
            name=name,
            provider="Manual",
            currency="usd",
            timezone="America/New_York",
            initial_balance=Decimal("25000"),
        ),
    )


@pytest.mark.parametrize("remaining,status", [(Decimal("0"), "CLOSED"), (Decimal("1"), "OPEN"), (Decimal("0"), "VOIDED")])
@pytest.mark.parametrize("include_unchanged_execution", [False, True])
def test_review_metadata_preserves_authoritative_pnl_and_trade_status(db, remaining, status, include_unchanged_execution):
    owner = seed_user(db, "review-pnl-owner@example.com")
    account = create_account(db, owner)
    trade = journal.create_trade(db, owner.id, CanonicalTradeCreate(
        account_id=account.id, symbol="ES", side="LONG",
        entry_time=datetime(2026, 9, 15, 10, tzinfo=timezone.utc),
        exit_time=datetime(2026, 9, 15, 11, tzinfo=timezone.utc),
        entry_price=Decimal("5800"), exit_price=Decimal("5802"),
        quantity=Decimal("2"), remaining_quantity=remaining,
        gross_pnl=Decimal("200"), net_pnl=Decimal("190"),
        commission=Decimal("7"), fees=Decimal("3"),
    ))
    row = db.get(CanonicalTrade, trade.id)
    row.status = status
    db.commit()
    payload = {"reviewed": True, "rating": 4, "setup_grade": "A+", "note": "Metadata review"}
    if include_unchanged_execution:
        payload.update(entry_price=trade.entry_price, exit_price=trade.exit_price, entry_time=trade.entry_time, exit_time=trade.exit_time)
    saved = journal.update_trade_review(db, owner.id, trade.id, CanonicalTradeReviewUpdate(**payload))
    assert (saved.gross_pnl, saved.net_pnl, saved.status, saved.remaining_quantity) == (Decimal("200"), Decimal("190"), status, remaining)
    assert saved.reviewed and saved.rating == 4 and saved.setup_grade == "A+"
    assert saved.notes[-1].body == "Metadata review"
    assert saved.executions == trade.executions


def test_explicit_review_price_change_recalculates_pnl_but_time_only_preserves_it(db):
    owner = seed_user(db, "price-review-owner@example.com")
    account = create_account(db, owner)
    trade = journal.create_trade(db, owner.id, CanonicalTradeCreate(
        account_id=account.id, symbol="NQ", side="LONG",
        entry_time=datetime(2026, 9, 15, 10, tzinfo=timezone.utc),
        exit_time=datetime(2026, 9, 15, 11, tzinfo=timezone.utc),
        entry_price=Decimal("100"), exit_price=Decimal("104"), quantity=Decimal("2"),
        gross_pnl=Decimal("800"), net_pnl=Decimal("797"), commission=Decimal("2"), fees=Decimal("1"),
    ))
    time_only = journal.update_trade_review(db, owner.id, trade.id, CanonicalTradeReviewUpdate(exit_time=datetime(2026, 9, 15, 12, tzinfo=timezone.utc)))
    assert (time_only.gross_pnl, time_only.net_pnl) == (Decimal("800"), Decimal("797"))
    corrected = journal.update_trade_review(db, owner.id, trade.id, CanonicalTradeReviewUpdate(exit_price=Decimal("106")))
    assert (corrected.gross_pnl, corrected.net_pnl, corrected.status) == (Decimal("12"), Decimal("9"), "CLOSED")


def test_manual_canonical_trade_review_queue_tags_daily_notes_and_isolation(db):
    owner = seed_user(db, "journal-owner@example.com")
    intruder = seed_user(db, "journal-intruder@example.com")
    account = create_account(db, owner)
    setup = journal.create_tag(
        db,
        owner.id,
        JournalTagCreate(category="SETUP", name="Opening range"),
    )
    process = journal.create_tag(
        db,
        owner.id,
        JournalTagCreate(category="POSITIVE", name="Waited for confirmation"),
    )
    mistake = journal.create_tag(
        db,
        owner.id,
        JournalTagCreate(category="MISTAKE", name="Moved stop"),
    )

    created = journal.create_trade(
        db,
        owner.id,
        CanonicalTradeCreate(
            account_id=account.id,
            symbol="es / dec-24",
            side="LONG",
            entry_time=datetime(2024, 11, 1, 9, 30),
            exit_time=datetime(2024, 11, 1, 10, 0),
            entry_price=Decimal("5800.25"),
            exit_price=Decimal("5802.75"),
            quantity=Decimal("2"),
            commission=Decimal("1.20"),
            fees=Decimal("0.80"),
            stop_loss=Decimal("5798"),
            take_profit=Decimal("5804"),
            tag_ids=[setup.id, process.id],
            note="Initial review note",
            screenshot_urls=["https://example.test/chart-before.png"],
        ),
    )
    assert created.symbol == "ESDEC-24"
    assert created.currency == "USD"
    assert created.source_timezone == "America/New_York"
    assert created.entry_time == datetime(2024, 11, 1, 13, 30)
    assert created.gross_pnl == Decimal("5.0000000000")
    assert created.net_pnl == Decimal("3.0000000000")
    assert len(created.executions) == 2
    assert {tag.category for tag in created.tags} == {"SETUP", "POSITIVE"}
    assert journal.list_trades(db, owner.id, reviewed=False, tag_ids=[setup.id, process.id])[0].id == created.id
    assert journal.list_trades(db, owner.id, tag_ids=[mistake.id]) == []

    raw_execution = db.get(CanonicalExecution, created.executions[0].id)
    assert raw_execution is not None
    raw_execution.price = Decimal("1")
    with pytest.raises(ValueError, match="immutable"):
        db.commit()
    db.rollback()

    reviewed = journal.update_trade_review(
        db,
        owner.id,
        created.id,
        CanonicalTradeReviewUpdate(
            reviewed=True,
            rating=5,
            setup_grade="A+",
            tag_ids=[setup.id, mistake.id],
            entry_price=Decimal("5800.50"),
            exit_price=Decimal("5803.00"),
            stop_loss=Decimal("5798.25"),
            take_profit=Decimal("5804.50"),
            note="Completed review",
            screenshot_urls=["https://example.test/chart-after.png"],
        ),
    )
    assert reviewed.reviewed is True
    assert reviewed.reviewed_at is not None
    assert reviewed.rating == 5
    assert reviewed.setup_grade == "A+"
    assert {tag.category for tag in reviewed.tags} == {"SETUP", "MISTAKE"}
    assert [note.body for note in reviewed.notes] == ["Initial review note", "Completed review"]
    assert [shot.url for shot in reviewed.screenshots] == ["https://example.test/chart-after.png"]
    assert journal.list_trades(db, owner.id, reviewed=False) == []
    assert journal.list_trades(db, owner.id, reviewed=True, tag_ids=[setup.id, mistake.id])[0].id == created.id

    global_note = journal.upsert_daily_note(
        db,
        owner.id,
        date(2024, 11, 1),
        JournalDailyNoteUpsert(body="No-trade-day plan"),
    )
    scoped_note = journal.upsert_daily_note(
        db,
        owner.id,
        date(2024, 11, 1),
        JournalDailyNoteUpsert(account_id=account.id, body="Account-specific recap"),
    )
    updated_global = journal.upsert_daily_note(
        db,
        owner.id,
        date(2024, 11, 1),
        JournalDailyNoteUpsert(body="Updated plan"),
    )
    assert updated_global.id == global_note.id
    assert scoped_note.id != global_note.id
    assert [item.id for item in journal.list_daily_notes(db, owner.id)] == [scoped_note.id, global_note.id]

    assert journal.list_accounts(db, intruder.id) == []
    assert journal.list_tags(db, intruder.id) == []
    assert journal.list_trades(db, intruder.id) == []
    assert journal.list_daily_notes(db, intruder.id) == []
    with pytest.raises(journal.JournalNotFoundError):
        journal.update_trade_review(
            db,
            intruder.id,
            created.id,
            CanonicalTradeReviewUpdate(reviewed=True),
        )
    with pytest.raises(journal.JournalNotFoundError):
        journal.upsert_daily_note(
            db,
            intruder.id,
            date(2024, 11, 1),
            JournalDailyNoteUpsert(account_id=account.id, body="not allowed"),
        )


def test_csv_import_grouping_duplicates_history_and_safe_rollback(db):
    owner = seed_user(db, "import-owner@example.com")
    intruder = seed_user(db, "import-intruder@example.com")
    account = create_account(db, owner, "Imported Futures")
    csv_text = """Trade ID,Entry Time,Exit Time,Side,Entry Price,Exit Price,Quantity,Symbol,Commission,Fees,Tags,Notes
T-100,2024-06-01 09:30:00,2024-06-01 10:00:00,Long,100,110,1,es / jun24,1,.5,Early entry,First scale
T-100,2024-06-01 09:31:00,2024-06-01 10:01:00,Long,102,112,1,es / jun24,1,.5,No checklist,Second scale
"""
    request = JournalImportCreate(
        csv_text=csv_text,
        destination_account_id=account.id,
        source_name="Broker orders export",
        source_timezone="America/Chicago",
        currency="usd",
        column_mapping={
            "commission_amount": "Commission",
            "fee_amount": "Fees",
        },
        grouping=JournalImportGrouping(mode="COLUMN", column="Trade ID"),
    )
    first = journal.import_journal_csv(db, owner.id, request)
    assert first.run.status == "COMPLETED"
    assert first.run.total_rows == 2
    assert first.run.imported_rows == 2
    assert first.run.duplicate_rows == 0
    assert first.run.error_rows == 0
    assert len(first.trades) == 1
    trade = first.trades[0]
    assert trade.symbol == "ESJUN24"
    assert trade.quantity == Decimal("2.0000000000")
    assert trade.entry_price == Decimal("101.0000000000")
    assert trade.exit_price == Decimal("111.0000000000")
    assert trade.gross_pnl == Decimal("20.0000000000")
    assert trade.net_pnl == Decimal("17.0000000000")
    assert len(trade.executions) == 4
    assert {tag.name for tag in trade.tags} == {"Early entry", "No checklist"}

    duplicate = journal.import_journal_csv(db, owner.id, request)
    assert duplicate.run.imported_rows == 0
    assert duplicate.run.duplicate_rows == 2
    assert duplicate.trades == []
    assert {row.status for row in duplicate.run.rows} == {"DUPLICATE"}
    assert all(row.trade_id == trade.id for row in duplicate.run.rows)
    assert [run.id for run in journal.list_import_runs(db, owner.id)] == [duplicate.run.id, first.run.id]

    with pytest.raises(journal.JournalNotFoundError):
        journal.rollback_import(db, intruder.id, first.run.id)
    rolled_back = journal.rollback_import(db, owner.id, first.run.id)
    repeated = journal.rollback_import(db, owner.id, first.run.id)
    assert rolled_back.status == repeated.status == "ROLLED_BACK"
    assert {row.status for row in rolled_back.rows} == {"ROLLED_BACK"}
    assert db.get(CanonicalTrade, trade.id) is None
    assert db.scalars(select(CanonicalExecution).where(CanonicalExecution.trade_id == trade.id)).all() == []
    duplicate_rows = db.scalars(
        select(JournalImportRow).where(JournalImportRow.run_id == duplicate.run.id)
    ).all()
    assert all(row.trade_id is None for row in duplicate_rows)

    after_rollback = journal.import_journal_csv(db, owner.id, request)
    assert after_rollback.run.imported_rows == 2
    assert len(after_rollback.trades) == 1
    assert after_rollback.trades[0].import_run_id == after_rollback.run.id
    assert after_rollback.trades[0].source_ref != trade.source_ref


def test_app_storage_and_backtest_backfill_is_additive_idempotent_and_user_scoped(db):
    owner = seed_user(db, "backfill-owner@example.com")
    other = seed_user(db, "backfill-other@example.com")
    legacy_document = {
        "accounts": [
            {
                "id": 7,
                "name": "Legacy Main",
                "broker": "Manual",
                "currency": "USD",
                "initial_balance": 10000,
                "status": "ACTIVE",
                "notes": "keep this account",
            }
        ],
        "sessions": [
            {
                "id": 3,
                "name": "Legacy Session",
                "instrument": "NQ",
                "currency": "USD",
                "strategy_name": "Breakout",
            }
        ],
        "trades": [
            {
                "id": 9,
                "session_id": 3,
                "account_ids": [7],
                "journal_entry_type": "TAKEN",
                "status": "CLOSED",
                "side": "SHORT",
                "entry_time": "2024-01-02T14:30:00Z",
                "exit_time": "2024-01-02T15:00:00Z",
                "entry_price": 17000,
                "exit_price": 16990,
                "quantity": 1,
                "remaining_quantity": 0,
                "gross_pnl": 10,
                "realized_pnl": 8,
                "commission_amount": 1,
                "fee_amount": 1,
                "mistake_tags": ["Late entry"],
                "notes": "legacy note",
                "screenshot_url": "https://example.test/legacy.png",
            }
        ],
        "settings": {"default_currency": "USD"},
    }
    original_document = deepcopy(legacy_document)
    storage = AppStorageItem(
        user_id=owner.id,
        namespace="edgelab",
        key="live-journal.v1",
        value=legacy_document,
    )
    session = BacktestSession(
        user_id=owner.id,
        name="Imported backtest",
        symbol="MES",
        currency="USD",
        timezone="UTC",
        initial_balance=50000,
        status="COMPLETE",
    )
    db.add_all([storage, session])
    db.flush()
    backtest_trade = Trade(
        user_id=owner.id,
        session_id=session.id,
        status="CLOSED",
        side="LONG",
        entry_time=datetime(2024, 2, 1, 14, 30),
        entry_price=4800,
        entry_offset=1,
        quantity=2,
        remaining_quantity=0,
        exit_time=datetime(2024, 2, 1, 15, 0),
        exit_price=4802,
        exit_offset=2,
        gross_pnl=4,
        realized_pnl=3,
        commission_amount=0.5,
        fee_amount=0.5,
        strategy_name="Backtest setup",
        notes="backtest note",
        mistake_tags='["Overtraded"]',
    )
    db.add(backtest_trade)
    db.commit()

    first = journal.backfill_legacy_journal(db, owner.id)
    assert first.accounts_created == 2
    assert first.trades_created == 2
    assert first.executions_created == 4
    assert first.notes_created == 2
    assert first.screenshots_created == 1
    assert first.tags_created == 2
    assert {trade.source_type for trade in journal.list_trades(db, owner.id)} == {"APP_STORAGE", "BACKTEST"}

    second = journal.backfill_legacy_journal(db, owner.id)
    assert second.accounts_created == 0
    assert second.trades_created == 0
    assert second.executions_created == 0
    assert second.sources_unchanged == 2
    assert len(journal.list_accounts(db, owner.id, include_archived=True)) == 2
    assert len(journal.list_trades(db, owner.id)) == 2
    assert db.get(AppStorageItem, storage.id).value == original_document
    assert db.get(Trade, backtest_trade.id) is not None

    other_result = journal.backfill_legacy_journal(db, other.id)
    assert other_result.trades_created == 0
    assert journal.list_accounts(db, other.id, include_archived=True) == []
    assert journal.list_trades(db, other.id) == []


def test_broker_fills_reconcile_to_canonical_trade_with_immutable_revisions(db):
    owner = seed_user(db, "broker-journal@example.com")
    connection = BrokerConnection(
        user_id=owner.id,
        provider="offline-fixture",
        display_name="Fixture",
        secret_id=999,
        status="READY",
        health="HEALTHY",
    )
    db.add(connection)
    db.flush()
    broker_account = BrokerAccount(
        user_id=owner.id,
        connection_id=connection.id,
        external_account_id="SIM-001",
        display_name="Simulation",
        currency="USD",
    )
    db.add(broker_account)
    db.flush()

    def fill(fill_id: str, side: str, quantity: str, price: str, minute: int) -> BrokerFill:
        occurred_at = datetime(2024, 3, 1, 14, minute, tzinfo=timezone.utc)
        return BrokerFill(
            user_id=owner.id,
            connection_id=connection.id,
            account_id=broker_account.id,
            external_fill_id=fill_id,
            external_order_id=f"order-{fill_id}",
            symbol="ES",
            side=side,
            quantity=Decimal(quantity),
            price=Decimal(price),
            commission=Decimal("0.50"),
            fees=Decimal("0"),
            source_revision=1,
            fingerprint=f"fingerprint-{fill_id}-1",
            cancelled=False,
            executed_at=occurred_at,
            provider_updated_at=occurred_at,
        )

    rows = [
        fill("f1", "BUY", "2", "100", 30),
        fill("f2", "SELL", "1", "110", 31),
        fill("f3", "SELL", "1", "120", 32),
    ]
    db.add_all(rows)
    db.commit()

    created, executions = journal.sync_broker_connection(db, owner.id, connection.id)
    assert (created, executions) == (1, 3)
    canonical = journal.list_trades(db, owner.id)[0]
    assert canonical.source_type == "BROKER"
    assert canonical.status == "CLOSED"
    assert canonical.quantity == Decimal("2.0000000000")
    assert canonical.gross_pnl == Decimal("30.0000000000")
    assert canonical.net_pnl == Decimal("28.5000000000")

    assert journal.sync_broker_connection(db, owner.id, connection.id) == (0, 0)
    corrected = db.scalar(select(BrokerFill).where(BrokerFill.external_fill_id == "f3"))
    assert corrected is not None
    corrected.price = Decimal("125")
    corrected.source_revision = 2
    corrected.fingerprint = "fingerprint-f3-2"
    db.commit()
    assert journal.sync_broker_connection(db, owner.id, connection.id) == (0, 1)
    revised = journal.list_trades(db, owner.id)[0]
    assert revised.gross_pnl == Decimal("35.0000000000")
    assert len(revised.executions) == 4

    corrected.cancelled = True
    corrected.fingerprint = "fingerprint-f3-cancelled"
    db.commit()
    journal.sync_broker_connection(db, owner.id, connection.id)
    open_trade = journal.list_trades(db, owner.id)[0]
    assert open_trade.status == "OPEN"
    assert open_trade.remaining_quantity == Decimal("1.0000000000")
    assert len(open_trade.executions) == 4


def test_sqlite_migration_creates_journal_tables_idempotently(tmp_path):
    database_path = tmp_path / "journal-migration.sqlite3"
    database_url = f"sqlite:///{database_path}"
    engine = create_engine(database_url)

    run_migrations(engine, database_url)
    run_migrations(engine, database_url)

    table_names = set(inspect(engine).get_table_names())
    assert {
        "journal_accounts",
        "canonical_trades",
        "canonical_executions",
        "journal_tags",
        "canonical_trade_tags",
        "canonical_trade_notes",
        "canonical_trade_screenshots",
        "journal_daily_notes",
        "journal_import_runs",
        "journal_import_rows",
        "journal_import_diagnostics",
        "journal_backfill_checkpoints",
    }.issubset(table_names)
    with engine.connect() as connection:
        versions = connection.exec_driver_sql(
            "SELECT version FROM schema_migrations ORDER BY version"
        ).scalars().all()
    assert versions == [1, 2, 3, 4, 5, 6, 7]
