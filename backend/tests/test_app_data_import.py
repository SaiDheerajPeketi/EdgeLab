from copy import deepcopy
from dataclasses import replace
from datetime import date, datetime, timezone

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.orm import sessionmaker

from app.api import routes
from app.auth import AuthenticatedUser
from app.db import Base
from app import models
from app.schemas import AppDataBundle
from app.services.database_market_data import DatabaseMarketDataService
from app.services.dashboard_summaries import load_user_dashboard_summary
from app.services.session_summaries import load_session_summary_aggregates


NOW = datetime(2026, 9, 15, 10, tzinfo=timezone.utc)


def authenticated(user):
    return AuthenticatedUser(
        id=user.id,
        email=user.email,
        name=user.name,
        provider="google",
        approved=True,
        beta_position=1,
        session_id=f"import-test-{user.id}",
        session_created_at=NOW,
        session_expires_at=NOW,
    )


def seed_graph(db, user_id, row_id):
    rows = [
        (models.IntegrationSecret, dict(provider="fixture", purpose="broker-sync", key_id="fixture", nonce=b"0" * 12, ciphertext=b"fixture")),
        (models.BrokerConnection, dict(provider="fixture", display_name="Fixture broker", secret_id=row_id)),
        (models.BrokerAccount, dict(connection_id=row_id, external_account_id="fixture", display_name="Fixture account")),
        (models.DatasetSettings, dict(root_path="/datasets")),
        (models.DatasetAsset, dict(asset_key="NQ", name="Nasdaq", symbol="NQ", folder_path="/datasets/NQ")),
        (models.DatasetTimeframe, dict(asset_id=row_id, timeframe="M1", csv_path="/datasets/NQ/NQ_M1.csv", rows=1, database_imported=True, database_imported_at=NOW)),
        (models.MarketCandle, dict(asset_id=row_id, timeframe="M1", offset=0, timestamp=NOW, open=100, high=101, low=99, close=100, volume=10)),
        (models.AppStorageItem, dict(namespace="preferences", key="workspace", value={"nested": [True, None, {"label": "saved"}]})),
        (models.Playbook, dict(name="Breakout", rules="Wait for confirmation")),
        (models.BacktestSession, dict(name="Saved replay", dataset_asset_id=row_id, playbook_id=row_id)),
        (models.Position, dict(session_id=row_id, playbook_id=row_id)),
        (models.Order, dict(session_id=row_id, playbook_id=row_id, side="BUY")),
        (models.Trade, dict(session_id=row_id, playbook_id=row_id, side="LONG", entry_time=NOW, entry_price=100, quantity=1, remaining_quantity=1)),
        (models.Execution, dict(session_id=row_id, order_id=row_id, side="BUY", timestamp=NOW, offset=0, price=100, quantity=1)),
        (models.TradeNote, dict(trade_id=row_id, notes="Replay review")),
        (models.JournalAccount, dict(broker_account_id=row_id, source_key="fixture", name="Journal account")),
        (models.JournalImportRun, dict(account_id=row_id, source_name="fixture.csv", source_digest="a" * 64)),
        (models.CanonicalTrade, dict(account_id=row_id, import_run_id=row_id, source_type="CSV", source_ref="fixture:1", duplicate_key="b" * 64, symbol="NQ", side="LONG", entry_time=NOW, entry_price="100.1234567890", quantity="1.0000000000", rating=4)),
        (models.CanonicalExecution, dict(trade_id=row_id, source_type="CSV", source_ref="fixture:fill:1", side="BUY", occurred_at=NOW, price="100.1234567890", quantity="1.0000000000", fingerprint="c" * 64)),
        (models.JournalTag, dict(category="SETUP", name="Breakout", normalized_name="breakout")),
        (models.CanonicalTradeTag, dict(trade_id=row_id, tag_id=row_id)),
        (models.CanonicalTradeNote, dict(trade_id=row_id, body="Canonical review")),
        (models.CanonicalTradeScreenshot, dict(trade_id=row_id, url="https://example.test/fixture.png")),
        (models.JournalDailyNote, dict(account_id=row_id, account_scope_key=str(row_id), note_date=date(2026, 9, 15), body="Daily review")),
        (models.JournalImportRow, dict(run_id=row_id, trade_id=row_id, row_number=1, group_key="fixture", status="IMPORTED", source_fingerprint="d" * 64)),
        (models.JournalImportDiagnostic, dict(run_id=row_id, code="FIXTURE", message="Fixture diagnostic")),
        (models.JournalBackfillCheckpoint, dict(source_key="fixture", source_digest="e" * 64)),
        (models.BacktestSessionSummary, dict(session_id=row_id, net_pnl=123, closed_trades=1)),
        (models.UserDashboardSummary, dict(net_pnl=456, total_trades=2)),
    ]
    for model, values in rows:
        db.add(model(id=row_id, user_id=user_id, **values))
        db.flush()
    db.commit()


@pytest.fixture(params=[False, True], ids=["sqlite-fks-off", "sqlite-fks-on"])
def import_context(request):
    engine = create_engine("sqlite:///:memory:")
    if request.param:
        @event.listens_for(engine, "connect")
        def enable_foreign_keys(connection, _record):
            connection.execute("PRAGMA foreign_keys=ON")
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as db:
        users = [
            models.BetaUser(email=f"import-{name}@example.test", name=name, provider="google", status="APPROVED")
            for name in ["owner", "other"]
        ]
        db.add_all(users)
        db.commit()
        owner, other = [authenticated(user) for user in users]
        seed_graph(db, owner.id, 100)
        seed_graph(db, other.id, 200)
        assert bool(db.scalar(text("PRAGMA foreign_keys"))) is request.param
        yield db, owner, other
    engine.dispose()


def exported_tables(db, user):
    return routes.export_app_data(db, user).model_dump(mode="json")["tables"]


def restored_tables(tables):
    expected = deepcopy(tables)
    for row in expected.get("dataset_timeframes", []):
        row.update(database_imported=False, database_imported_at=None)
    return expected


def stored_summaries(db):
    return {
        model.__tablename__: [routes.serialize_bundle_row(row) for row in db.scalars(select(model).order_by(model.id))]
        for model in [models.BacktestSessionSummary, models.UserDashboardSummary]
    }


def assert_rejected_without_changes(context, tables, status_code=400):
    db, owner, other = context
    before = [exported_tables(db, user) for user in [owner, other]]
    summaries = stored_summaries(db)
    with pytest.raises(HTTPException) as error:
        routes.import_app_data(AppDataBundle(app="edgelab", version=1, tables=tables), db, owner)
    assert error.value.status_code == status_code
    db.expire_all()
    assert [exported_tables(db, user) for user in [owner, other]] == before
    assert stored_summaries(db) == summaries


@pytest.mark.parametrize("version", [True, False, -1, 0, 2, "1", 1.0, None])
def test_bundle_requires_exact_supported_integer_version(version):
    with pytest.raises(ValidationError):
        AppDataBundle.model_validate({"app": "edgelab", "version": version, "tables": {}})


def test_bundle_rejects_unknown_top_level_fields():
    with pytest.raises(ValidationError):
        AppDataBundle.model_validate({"app": "edgelab", "version": 1, "tables": {}, "future_option": True})


@pytest.mark.parametrize("missing", ["app", "version", "tables", "all"])
def test_bundle_requires_complete_explicit_envelope(missing):
    envelope = {"app": "edgelab", "version": 1, "tables": {}}
    omitted = {"app", "version", "tables"} if missing == "all" else {missing}
    for field in omitted:
        del envelope[field]
    with pytest.raises(ValidationError) as error:
        AppDataBundle.model_validate(envelope)
    assert {item["loc"][0] for item in error.value.errors()} == omitted
    assert all(item["type"] == "missing" for item in error.value.errors())


def test_all_supported_collections_roundtrip_with_ids_and_owned_external_links(import_context, monkeypatch):
    db, owner, other = import_context
    original = exported_tables(db, owner)
    other_before = exported_tables(db, other)
    other_summaries = {name: [row for row in rows if row["user_id"] == other.id] for name, rows in stored_summaries(db).items()}
    assert len(original) == 23
    assert all(len(rows) == 1 for rows in original.values())
    incoming = deepcopy(original)
    for rows in incoming.values():
        rows[0]["user_id"] = other.id
    invalidations = []
    monkeypatch.setattr(routes.read_model_cache, "invalidate_user", lambda *scopes: invalidations.append(scopes))

    result = routes.import_app_data(AppDataBundle(app="edgelab", version=1, tables=incoming), db, owner)

    db.expire_all()
    assert result.ok
    assert result.summary == {name: 1 for name in original}
    assert exported_tables(db, owner) == restored_tables(original)
    assert exported_tables(db, other) == other_before
    assert stored_summaries(db) == other_summaries
    assert db.get(models.BrokerAccount, 100).user_id == owner.id
    assert db.get(models.BrokerAccount, 200).user_id == other.id
    assert invalidations == [(routes.bootstrap_shell_cache_scope(owner.id), routes.dataset_catalog_cache_scope(owner.id))]


def test_metric_readers_use_restored_trades_instead_of_old_summary_snapshots(import_context):
    db, owner, other = import_context
    db.get(models.BacktestSessionSummary, 100).net_pnl = 999
    db.get(models.BacktestSessionSummary, 100).closed_trades = 99
    db.get(models.UserDashboardSummary, 100).net_pnl = 999
    db.get(models.UserDashboardSummary, 100).total_trades = 99
    db.commit()
    assert load_user_dashboard_summary(db, owner.id).net_pnl == 999
    assert load_session_summary_aggregates(db, owner.id, [100])[100].net_pnl == 999
    tables = exported_tables(db, owner)
    tables["trades"][0].update(
        status="CLOSED", remaining_quantity=0, realized_pnl=250, gross_pnl=250,
        r_multiple=2.5, exit_time="2026-09-15T10:05:00", exit_offset=5, exit_price=350,
    )

    routes.import_app_data(AppDataBundle(app="edgelab", version=1, tables=tables), db, owner)
    db.expire_all()

    dashboard = load_user_dashboard_summary(db, owner.id)
    session = load_session_summary_aggregates(db, owner.id, [100])[100]
    assert dashboard.net_pnl == session.net_pnl == 250
    assert dashboard.total_trades == session.closed_trades == 1
    assert dashboard.winning_trades == session.winning_trades == 1
    assert dashboard.average_r == session.average_r == 2.5
    assert dashboard.open_trades == 0
    assert load_user_dashboard_summary(db, other.id).net_pnl == 456
    assert load_session_summary_aggregates(db, other.id, [200])[200].net_pnl == 123


def test_nullable_relationships_allow_null_targets(import_context):
    db, owner, _other = import_context
    tables = exported_tables(db, owner)
    for table, columns in [
        ("backtest_sessions", ["dataset_asset_id", "playbook_id"]),
        ("executions", ["order_id"]),
        ("journal_accounts", ["broker_account_id"]),
        ("canonical_trades", ["import_run_id"]),
    ]:
        for column in columns:
            tables[table][0][column] = None
    routes.import_app_data(AppDataBundle(app="edgelab", version=1, tables=tables), db, owner)
    db.expire_all()
    assert exported_tables(db, owner) == restored_tables(tables)


def test_restored_dataset_requires_candle_reimport_before_database_reader_can_serve_bars(import_context):
    db, owner, _other = import_context
    factory = sessionmaker(bind=db.get_bind())
    reader = DatabaseMarketDataService(
        factory, factory, user_id=owner.id, asset_id=100, timeframe="M1",
        csv_path="/datasets/NQ/NQ_M1.csv",
    )
    assert len(reader.get_bars(offset=0, limit=1, warmup=0).bars) == 1
    tables = exported_tables(db, owner)
    assert tables["dataset_timeframes"][0]["database_imported"] is True
    assert tables["dataset_timeframes"][0]["database_imported_at"] is not None
    foreign_keys_enabled = bool(db.scalar(text("PRAGMA foreign_keys")))

    routes.import_app_data(AppDataBundle(app="edgelab", version=1, tables=tables), db, owner)
    db.expire_all()

    if not foreign_keys_enabled:
        assert db.get(models.MarketCandle, 100) is not None
    assert db.get(models.MarketCandle, 200) is not None
    with pytest.raises(FileNotFoundError, match="unavailable"):
        reader.get_bars(offset=0, limit=1, warmup=0)


@pytest.mark.parametrize("row_id", [True, False, 0, -1, "100", 100.0, None, 2**63])
def test_invalid_row_ids_are_rejected_without_deleting_saved_data(import_context, row_id):
    db, owner, _other = import_context
    tables = exported_tables(db, owner)
    tables["app_storage"][0]["id"] = row_id
    assert_rejected_without_changes(import_context, tables)


def test_missing_row_id_is_rejected_without_changes(import_context):
    db, owner, _other = import_context
    tables = exported_tables(db, owner)
    del tables["app_storage"][0]["id"]
    assert_rejected_without_changes(import_context, tables)


def test_duplicate_row_id_is_rejected_without_changes(import_context):
    db, owner, _other = import_context
    tables = exported_tables(db, owner)
    duplicate = deepcopy(tables["app_storage"][0])
    duplicate["key"] = "another"
    tables["app_storage"].append(duplicate)
    assert_rejected_without_changes(import_context, tables)


@pytest.mark.parametrize("missing", [False, True], ids=["null", "absent"])
def test_required_row_fields_are_rejected_without_changes(import_context, missing):
    db, owner, _other = import_context
    tables = exported_tables(db, owner)
    if missing:
        del tables["app_storage"][0]["namespace"]
    else:
        tables["app_storage"][0]["namespace"] = None
    assert_rejected_without_changes(import_context, tables)


def test_unknown_collection_is_rejected_without_changes(import_context):
    db, owner, _other = import_context
    tables = exported_tables(db, owner)
    tables["integration_secrets"] = []
    assert_rejected_without_changes(import_context, tables)


def test_unknown_row_column_is_rejected_without_changes(import_context):
    db, owner, _other = import_context
    tables = exported_tables(db, owner)
    tables["app_storage"][0]["future_field"] = "must not silently disappear"
    assert_rejected_without_changes(import_context, tables)


def test_other_owner_primary_key_collision_is_rejected_without_changes(import_context):
    db, owner, _other = import_context
    tables = exported_tables(db, owner)
    tables["app_storage"][0]["id"] = 200
    assert_rejected_without_changes(import_context, tables)


@pytest.mark.parametrize("source,column", [
    ("dataset_timeframes", "asset_id"),
    ("backtest_sessions", "dataset_asset_id"),
    ("backtest_sessions", "playbook_id"),
    ("positions", "session_id"),
    ("orders", "playbook_id"),
    ("executions", "order_id"),
    ("trade_notes", "trade_id"),
    ("journal_accounts", "broker_account_id"),
    ("journal_import_runs", "account_id"),
    ("canonical_trades", "import_run_id"),
    ("canonical_executions", "trade_id"),
    ("canonical_trade_tags", "tag_id"),
    ("canonical_trade_notes", "trade_id"),
    ("canonical_trade_screenshots", "trade_id"),
    ("journal_daily_notes", "account_id"),
    ("journal_import_rows", "trade_id"),
    ("journal_import_diagnostics", "run_id"),
])
def test_foreign_owner_relationships_are_rejected_even_without_database_fk_enforcement(import_context, source, column):
    db, owner, _other = import_context
    tables = exported_tables(db, owner)
    tables[source][0][column] = 200
    assert_rejected_without_changes(import_context, tables)


@pytest.mark.parametrize("source,column,target", [
    ("dataset_timeframes", "asset_id", "dataset_assets"),
    ("positions", "session_id", "backtest_sessions"),
    ("canonical_trades", "account_id", "journal_accounts"),
    ("canonical_trade_tags", "tag_id", "journal_tags"),
    ("journal_import_rows", "run_id", "journal_import_runs"),
])
def test_owned_relationship_targets_must_be_in_replacement_bundle(import_context, source, column, target):
    db, owner, _other = import_context
    tables = exported_tables(db, owner)
    assert tables[source][0][column] == 100
    del tables[target]
    assert_rejected_without_changes(import_context, tables)


def test_missing_retained_external_relationship_is_rejected(import_context):
    db, owner, _other = import_context
    tables = exported_tables(db, owner)
    tables["journal_accounts"][0]["broker_account_id"] = 9999
    assert_rejected_without_changes(import_context, tables)


@pytest.mark.parametrize("reference", [None, True, "100", 100.0, 9999])
def test_invalid_required_relationships_are_rejected(import_context, reference):
    db, owner, _other = import_context
    tables = exported_tables(db, owner)
    tables["positions"][0]["session_id"] = reference
    assert_rejected_without_changes(import_context, tables)


def test_empty_replacement_clears_only_owner_import_data_and_summaries(import_context):
    db, owner, other = import_context
    other_before = exported_tables(db, other)
    result = routes.import_app_data(AppDataBundle(app="edgelab", version=1, tables={}), db, owner)
    db.expire_all()
    assert result.summary == {name: 0 for name in other_before}
    assert all(rows == [] for rows in exported_tables(db, owner).values())
    assert exported_tables(db, other) == other_before
    assert all(all(row["user_id"] == other.id for row in rows) for rows in stored_summaries(db).values())
    assert db.get(models.BrokerAccount, 100).user_id == owner.id


def test_optional_defaulted_fields_and_owner_can_be_omitted(import_context):
    db, owner, _other = import_context
    result = routes.import_app_data(
        AppDataBundle(app="edgelab", version=1, tables={"app_storage": [{"id": 101, "namespace": "prefs", "key": "theme"}]}),
        db,
        owner,
    )
    db.expire_all()
    stored = db.get(models.AppStorageItem, 101)
    assert result.summary["app_storage"] == 1
    assert stored.user_id == owner.id
    assert stored.value is None
    assert stored.created_at is not None
    assert stored.updated_at is not None


def test_late_database_constraint_failure_rolls_back_rows_and_derived_summaries(import_context, monkeypatch, caplog):
    db, owner, _other = import_context
    tables = exported_tables(db, owner)
    tables["app_storage"][0]["value"] = {"replacement": True}
    tables["journal_tags"][0]["category"] = "INVALID"
    tables["journal_tags"][0]["name"] = "private-import-canary"
    invalidations = []
    monkeypatch.setattr(routes.read_model_cache, "invalidate_user", lambda *args: invalidations.append(args))
    assert_rejected_without_changes(import_context, tables)
    assert invalidations == []
    assert "private-import-canary" not in caplog.text


def test_oversized_import_is_rejected_without_changes(import_context, monkeypatch):
    db, owner, _other = import_context
    tables = exported_tables(db, owner)
    monkeypatch.setattr(routes, "settings", replace(routes.settings, max_app_data_rows=23))
    duplicate = deepcopy(tables["app_storage"][0])
    duplicate.update(id=101, key="another")
    tables["app_storage"].append(duplicate)
    assert_rejected_without_changes(import_context, tables, status_code=413)
