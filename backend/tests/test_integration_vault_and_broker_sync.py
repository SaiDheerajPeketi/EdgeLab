from __future__ import annotations

from base64 import urlsafe_b64encode
from datetime import datetime, timezone
from decimal import Decimal
import json

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, inspect, select, update
from sqlalchemy.orm import sessionmaker

from app import main
from app.api import routes
from app.db import Base
from app.migrations import run_migrations
from app.models import (
    BetaUser,
    BrokerAuditLog,
    BrokerConnection,
    BrokerFill,
    BrokerOrder,
    BrokerSyncCursor,
    IntegrationSecret,
)
from app.schemas import (
    BrokerConnectionCreate,
    IntegrationSecretCreate,
    IntegrationSecretReplace,
)
from app.services import broker_sync, integration_secrets


KEY_V1 = bytes(range(32))
KEY_V2 = bytes(reversed(range(32)))
WRONG_KEY = b"x" * 32


def encoded_key(value: bytes) -> str:
    return urlsafe_b64encode(value).decode("ascii")


def configure_vault(monkeypatch, keys: dict[str, bytes], active: str) -> None:
    monkeypatch.setenv(
        integration_secrets.KEYS_ENV,
        json.dumps({key_id: encoded_key(key) for key_id, key in keys.items()}),
    )
    monkeypatch.setenv(integration_secrets.ACTIVE_KEY_ENV, active)
    integration_secrets.get_keyring.cache_clear()


@pytest.fixture(autouse=True)
def vault_environment(monkeypatch):
    configure_vault(monkeypatch, {"v1": KEY_V1}, "v1")
    yield
    integration_secrets.get_keyring.cache_clear()


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


def secret_request(
    marker: str,
    *,
    provider: str = "offline-fixture",
    purpose: str = "broker-sync",
) -> IntegrationSecretCreate:
    return IntegrationSecretCreate(
        provider=provider,
        purpose=purpose,
        credentials={"fixture_token": marker, "private_key": f"private-{marker}"},
    )


def create_secret(db, user: BetaUser, marker: str = "vault-marker"):
    return integration_secrets.create_integration_secret(
        db,
        user.id,
        secret_request(marker),
    )


def test_vault_encrypts_with_unique_nonces_and_never_returns_or_logs_plaintext(
    db,
    caplog,
):
    user = seed_user(db, "vault@example.com")
    marker = "LEAK-CHECK-credential-42"
    payload = secret_request(marker)

    created = integration_secrets.create_integration_secret(db, user.id, payload)
    second = integration_secrets.create_integration_secret(
        db,
        user.id,
        secret_request(marker, purpose="market-data"),
    )
    stored = db.get(IntegrationSecret, created.id)
    stored_second = db.get(IntegrationSecret, second.id)
    assert stored is not None and stored_second is not None
    assert stored.nonce != stored_second.nonce
    assert len(stored.nonce) == 12
    assert marker.encode() not in stored.ciphertext
    assert f"private-{marker}".encode() not in stored.ciphertext
    assert "credentials" not in created.model_dump()
    assert "ciphertext" not in created.model_dump()
    assert "nonce" not in created.model_dump()
    assert marker not in repr(payload)

    captured: dict[str, str] = {}
    connected = integration_secrets.connect_integration_secret(
        db,
        user.id,
        created.id,
        connector=lambda _provider, _purpose, credentials: captured.update(credentials),
    )
    assert captured == {
        "fixture_token": marker,
        "private_key": f"private-{marker}",
    }
    assert marker not in connected.model_dump_json()
    assert connected.connection_status == "credentials-ready"
    assert marker not in caplog.text
    assert "credentials" not in {
        column["name"] for column in inspect(db.bind).get_columns("integration_secrets")
    }


def test_vault_rejects_ciphertext_tampering_wrong_keys_and_aad_changes(db, monkeypatch):
    user = seed_user(db, "integrity@example.com")

    tampered = create_secret(db, user, "tamper-marker")
    row = db.get(IntegrationSecret, tampered.id)
    assert row is not None
    row.ciphertext = bytes([row.ciphertext[0] ^ 1]) + row.ciphertext[1:]
    db.commit()
    with pytest.raises(integration_secrets.VaultIntegrityError):
        integration_secrets.connect_integration_secret(db, user.id, tampered.id)

    wrong_key = integration_secrets.create_integration_secret(
        db,
        user.id,
        secret_request("wrong-key-marker", purpose="execution"),
    )
    configure_vault(monkeypatch, {"v1": WRONG_KEY}, "v1")
    with pytest.raises(integration_secrets.VaultIntegrityError):
        integration_secrets.connect_integration_secret(db, user.id, wrong_key.id)

    configure_vault(monkeypatch, {"v1": KEY_V1}, "v1")
    aad_bound = integration_secrets.create_integration_secret(
        db,
        user.id,
        secret_request("aad-marker", purpose="analytics"),
    )
    db.execute(
        update(IntegrationSecret)
        .where(IntegrationSecret.id == aad_bound.id)
        .values(provider="altered-provider")
    )
    db.commit()
    db.expire_all()
    with pytest.raises(integration_secrets.VaultIntegrityError):
        integration_secrets.connect_integration_secret(db, user.id, aad_bound.id)


def test_vault_rotation_replace_revoke_and_production_fail_closed(db, monkeypatch):
    user = seed_user(db, "rotation@example.com")
    created = create_secret(db, user, "old-secret")
    before = db.get(IntegrationSecret, created.id)
    assert before is not None
    old_nonce = before.nonce
    old_ciphertext = before.ciphertext

    configure_vault(monkeypatch, {"v1": KEY_V1, "v2": KEY_V2}, "v2")
    rotated = integration_secrets.rotate_integration_secret(db, user.id, created.id)
    db.expire_all()
    after = db.get(IntegrationSecret, created.id)
    assert after is not None
    assert rotated.key_id == "v2"
    assert rotated.version == 2
    assert after.nonce != old_nonce
    assert after.ciphertext != old_ciphertext

    configure_vault(monkeypatch, {"v2": KEY_V2}, "v2")
    captured: dict[str, str] = {}
    integration_secrets.connect_integration_secret(
        db,
        user.id,
        created.id,
        connector=lambda _provider, _purpose, credentials: captured.update(credentials),
    )
    assert captured["fixture_token"] == "old-secret"

    nonce_before_replace = after.nonce
    replaced = integration_secrets.replace_integration_secret(
        db,
        user.id,
        created.id,
        IntegrationSecretReplace(credentials={"fixture_token": "new-secret"}),
    )
    assert replaced.version == 3
    db.expire_all()
    assert db.get(IntegrationSecret, created.id).nonce != nonce_before_replace

    revoked = integration_secrets.revoke_integration_secret(db, user.id, created.id)
    repeated = integration_secrets.revoke_integration_secret(db, user.id, created.id)
    assert revoked.state == "revoked"
    assert repeated.version == revoked.version == 4
    retained = db.get(IntegrationSecret, created.id)
    assert retained is not None
    assert retained.nonce == b""
    assert retained.ciphertext == b""
    with pytest.raises(integration_secrets.VaultRevokedError):
        integration_secrets.connect_integration_secret(db, user.id, created.id)

    monkeypatch.delenv(integration_secrets.KEYS_ENV)
    monkeypatch.delenv(integration_secrets.ACTIVE_KEY_ENV)
    integration_secrets.get_keyring.cache_clear()
    integration_secrets.validate_vault_startup("development")
    with pytest.raises(RuntimeError, match="Production requires"):
        integration_secrets.validate_vault_startup("production")


def test_vault_and_validation_errors_are_owner_scoped_and_redacted(db):
    owner = seed_user(db, "owner-vault@example.com")
    intruder = seed_user(db, "intruder-vault@example.com")
    created = create_secret(db, owner, "private-owner-value")

    assert integration_secrets.list_integration_secrets(db, intruder.id) == []
    for action in (
        lambda: integration_secrets.get_integration_secret(db, intruder.id, created.id),
        lambda: integration_secrets.connect_integration_secret(db, intruder.id, created.id),
        lambda: integration_secrets.rotate_integration_secret(db, intruder.id, created.id),
        lambda: integration_secrets.replace_integration_secret(
            db,
            intruder.id,
            created.id,
            IntegrationSecretReplace(credentials={"token": "intruder"}),
        ),
        lambda: integration_secrets.revoke_integration_secret(db, intruder.id, created.id),
    ):
        with pytest.raises(integration_secrets.VaultNotFoundError):
            action()

    marker = "SHOULD-NOT-ECHO"
    errors = main.sanitize_secret_validation_errors(
        [{"type": "extra_forbidden", "loc": ("body", "credentials"), "input": marker, "ctx": {"value": marker}}]
    )
    assert marker not in json.dumps(errors)


def order_record(
    order_id: str,
    *,
    status: str = "FILLED",
    revision: int = 1,
    cancelled_at: datetime | None = None,
) -> broker_sync.OrderRecord:
    occurred_at = datetime(2024, 1, 2, 14, 30, tzinfo=timezone.utc)
    return broker_sync.OrderRecord(
        external_order_id=order_id,
        external_account_id="SIM-001",
        symbol="ES",
        side="BUY",
        order_type="MARKET",
        status=status,
        quantity=Decimal("3") if order_id == "ORDER-001" else Decimal("1"),
        filled_quantity=Decimal("3") if order_id == "ORDER-001" else Decimal("0"),
        average_fill_price=Decimal("104") if order_id == "ORDER-001" else None,
        commission_total=Decimal("3"),
        fees_total=Decimal("0"),
        placed_at=occurred_at,
        provider_updated_at=occurred_at,
        source_revision=revision,
        cancelled_at=cancelled_at,
    )


def fill_record(
    fill_id: str,
    side: str,
    quantity: str,
    price: str,
    commission: str,
    fees: str,
    *,
    revision: int = 1,
    cancelled: bool = False,
    minute: int = 30,
) -> broker_sync.FillRecord:
    occurred_at = datetime(2024, 1, 2, 14, minute, tzinfo=timezone.utc)
    return broker_sync.FillRecord(
        external_fill_id=fill_id,
        external_order_id="ORDER-001",
        external_account_id="SIM-001",
        symbol="ES",
        side=side,
        quantity=Decimal(quantity),
        price=Decimal(price),
        commission=Decimal(commission),
        fees=Decimal(fees),
        executed_at=occurred_at,
        provider_updated_at=occurred_at,
        source_revision=revision,
        cancelled=cancelled,
    )


def create_connection(db, user: BetaUser, marker: str = "fixture-access"):
    secret = create_secret(db, user, marker)
    return broker_sync.create_connection(
        db,
        user.id,
        BrokerConnectionCreate(
            provider="offline-fixture",
            display_name="Paper import",
            secret_id=secret.id,
        ),
    )


def test_catalog_is_truthful_and_shipped_brokers_can_create_vault_backed_connections(db):
    catalog = {provider.provider_id: provider for provider in broker_sync.list_provider_catalog()}
    assert catalog["offline-fixture"].availability == "offline-fixture"
    assert catalog["offline-fixture"].capabilities.incremental_sync is True
    assert catalog["offline-fixture"].capabilities.live_connectivity is False
    assert catalog["tradovate"].availability == "available"
    assert catalog["tradovate"].capabilities.live_connectivity is True
    assert catalog["ninjatrader"].availability in {"available", "unconfigured"}

    user = seed_user(db, "planned@example.com")
    secret = integration_secrets.create_integration_secret(
        db,
        user.id,
        secret_request("planned-token", provider="tradovate"),
    )
    connection = broker_sync.create_connection(
        db,
        user.id,
        BrokerConnectionCreate(
            provider="tradovate",
            display_name="Tradovate direct",
            secret_id=secret.id,
        ),
    )
    assert connection.status == "READY"


def test_incremental_sync_reconciles_scale_corrections_cancellations_and_costs(db):
    user = seed_user(db, "sync@example.com")
    connection = create_connection(db, user, "SYNC-SECRET-NEVER-LOG")
    occurred_at = datetime(2024, 1, 2, 14, 30, tzinfo=timezone.utc)
    cancellation_at = datetime(2024, 1, 2, 15, 0, tzinfo=timezone.utc)
    adapter = broker_sync.FixtureBrokerAdapter(
        (
            broker_sync.SyncBatch(
                accounts=(broker_sync.AccountRecord("SIM-001", "Simulation", "USD"),),
                orders=(
                    order_record("ORDER-001"),
                    order_record("ORDER-CANCEL", status="OPEN"),
                ),
                fills=(
                    fill_record("FILL-001", "BUY", "2", "100", "1.5", "0.5", minute=30),
                    fill_record("FILL-002", "BUY", "1", "110", "0.75", "0.25", minute=31),
                    fill_record("FILL-003", "SELL", "1.5", "120", "1.5", "0.3", minute=32),
                ),
                next_cursor="1",
                high_watermark=occurred_at,
            ),
            broker_sync.SyncBatch(
                orders=(
                    order_record(
                        "ORDER-CANCEL",
                        status="CANCELLED",
                        revision=2,
                        cancelled_at=cancellation_at,
                    ),
                ),
                fills=(
                    fill_record("FILL-002", "BUY", "1", "112", "0.75", "0.25", revision=2, minute=31),
                    fill_record("FILL-003", "SELL", "1.5", "120", "1.5", "0.3", revision=2, cancelled=True, minute=32),
                    fill_record("FILL-004", "SELL", "3", "120", "3", "0.6", minute=33),
                ),
                next_cursor="2",
                high_watermark=cancellation_at,
            ),
        )
    )

    first_job = broker_sync.refresh_connection(
        db,
        user.id,
        connection.id,
        adapter=adapter,
    )
    assert first_job.status == "SUCCEEDED"
    first_position = broker_sync.list_positions(db, user.id, connection.id)[0]
    assert first_position.signed_quantity == Decimal("1.5000000000")
    assert first_position.average_entry_price == Decimal("103.3333333333")
    assert first_position.open_costs == Decimal("1.5000000000")
    assert first_position.realized_gross_pnl == Decimal("25.0000000000")
    assert first_position.realized_costs == Decimal("3.3000000000")
    assert first_position.realized_net_pnl == Decimal("21.7000000000")

    second_job = broker_sync.refresh_connection(
        db,
        user.id,
        connection.id,
        adapter=adapter,
    )
    assert second_job.status == "SUCCEEDED"
    corrected = broker_sync.list_positions(db, user.id, connection.id)[0]
    assert corrected.signed_quantity == Decimal("0E-10")
    assert corrected.average_entry_price is None
    assert corrected.open_costs == Decimal("0E-10")
    assert corrected.realized_gross_pnl == Decimal("48.0000000000")
    assert corrected.realized_costs == Decimal("6.6000000000")
    assert corrected.realized_net_pnl == Decimal("41.4000000000")
    corrected_hash = corrected.reconciliation_hash

    third_job = broker_sync.refresh_connection(
        db,
        user.id,
        connection.id,
        adapter=adapter,
    )
    assert third_job.status == "SUCCEEDED"
    assert third_job.stats["fills_received"] == 0
    assert broker_sync.list_positions(db, user.id, connection.id)[0].reconciliation_hash == corrected_hash
    assert db.scalar(select(BrokerSyncCursor).where(BrokerSyncCursor.connection_id == connection.id)).cursor == "2"
    assert db.query(BrokerOrder).filter_by(connection_id=connection.id).count() == 2
    assert db.query(BrokerFill).filter_by(connection_id=connection.id).count() == 4
    assert db.scalar(
        select(BrokerOrder.status).where(BrokerOrder.external_order_id == "ORDER-CANCEL")
    ) == "CANCELLED"
    assert db.scalar(
        select(BrokerFill.cancelled).where(BrokerFill.external_fill_id == "FILL-003")
    ) is True
    assert broker_sync.get_connection(db, user.id, connection.id).health == "HEALTHY"
    audit_payload = json.dumps(
        [entry.model_dump(mode="json") for entry in broker_sync.list_audit_logs(db, user.id, connection.id)]
    )
    assert "SYNC-SECRET-NEVER-LOG" not in audit_payload


def test_sync_retry_backoff_dead_letter_and_cross_user_visibility(db):
    owner = seed_user(db, "retry-owner@example.com")
    intruder = seed_user(db, "retry-intruder@example.com")
    connection = create_connection(db, owner, "retry-secret")
    adapter = broker_sync.FixtureBrokerAdapter(transient_failures=5)

    first = broker_sync.refresh_connection(
        db,
        owner.id,
        connection.id,
        max_attempts=2,
        adapter=adapter,
    )
    assert first.status == "RETRYING"
    assert first.attempt == 1
    assert first.next_retry_at is not None
    second = broker_sync.retry_sync_job(
        db,
        owner.id,
        first.id,
        adapter=adapter,
        force=True,
    )
    assert second.status == "DEAD_LETTER"
    assert second.attempt == 2
    assert second.next_retry_at is None
    state = broker_sync.get_connection(db, owner.id, connection.id)
    assert state.status == "ERROR"
    assert state.health == "ERROR"
    assert state.last_error_code == "provider_unavailable"
    assert any(
        entry.outcome == "DEAD_LETTER"
        for entry in broker_sync.list_audit_logs(db, owner.id, connection.id)
    )

    assert broker_sync.list_connections(db, intruder.id) == []
    for action in (
        lambda: broker_sync.get_connection(db, intruder.id, connection.id),
        lambda: broker_sync.list_accounts(db, intruder.id, connection.id),
        lambda: broker_sync.list_orders(db, intruder.id, connection.id),
        lambda: broker_sync.list_fills(db, intruder.id, connection.id),
        lambda: broker_sync.list_positions(db, intruder.id, connection.id),
        lambda: broker_sync.list_sync_jobs(db, intruder.id, connection.id),
        lambda: broker_sync.list_audit_logs(db, intruder.id, connection.id),
        lambda: broker_sync.retry_sync_job(db, intruder.id, second.id, adapter=adapter, force=True),
    ):
        with pytest.raises(broker_sync.BrokerNotFoundError):
            action()


def test_routes_and_sqlite_migrations_expose_the_complete_backend_contract(tmp_path):
    route_contract = {
        (route.path, method)
        for route in routes.router.routes
        for method in getattr(route, "methods", None) or set()
    }
    expected = {
        ("/integration-secrets", "POST"),
        ("/integration-secrets", "GET"),
        ("/integration-secrets/{secret_id}", "PUT"),
        ("/integration-secrets/{secret_id}/connect", "POST"),
        ("/integration-secrets/{secret_id}/rotate", "POST"),
        ("/integration-secrets/{secret_id}", "DELETE"),
        ("/broker-providers", "GET"),
        ("/broker-connections", "POST"),
        ("/broker-connections/{connection_id}/refresh", "POST"),
        ("/broker-sync-jobs/{job_id}/retry", "POST"),
        ("/broker-connections/{connection_id}/accounts", "GET"),
        ("/broker-connections/{connection_id}/orders", "GET"),
        ("/broker-connections/{connection_id}/fills", "GET"),
        ("/broker-connections/{connection_id}/positions", "GET"),
        ("/broker-connections/{connection_id}/sync-jobs", "GET"),
        ("/broker-connections/{connection_id}/audit-logs", "GET"),
    }
    assert expected <= route_contract

    database_path = tmp_path / "migration.db"
    engine = create_engine(f"sqlite:///{database_path}")
    run_migrations(engine, f"sqlite:///{database_path}")
    tables = set(inspect(engine).get_table_names())
    assert {
        "integration_secrets",
        "broker_connections",
        "broker_accounts",
        "broker_sync_cursors",
        "broker_orders",
        "broker_fills",
        "broker_position_snapshots",
        "broker_sync_jobs",
        "broker_audit_logs",
    } <= tables
