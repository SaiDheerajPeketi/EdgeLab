from __future__ import annotations

from base64 import urlsafe_b64encode
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json

import pytest
from sqlalchemy import create_engine, inspect, select, update
from sqlalchemy.orm import sessionmaker

from app import main
from app.db import Base
from app.migrations import run_migrations
from app.models import (
    AIAuditLog,
    AIConversation,
    AIGeneratedArtifact,
    AIGenerationJob,
    AIJobEvent,
    AIMessage,
    AIUsageLedger,
    BetaUser,
    IntegrationSecret,
    QuantScript,
    QuantScriptVersion,
)
from app.schemas import (
    AIBacktestRequest,
    AIAutoBacktestConfig,
    AIChartContext,
    AIChartImageMetadata,
    AIConversationCreate,
    AIGenerationRequest,
    IntegrationSecretCreate,
    MarketIdentifierCreate,
    MarketInstrumentCreate,
    QuantScriptCreate,
    QuantScriptPermissionCreate,
    QuantScriptVersionCreate,
)
from app.services import integration_secrets
from app.services import market_infrastructure as market
from app.services import quant_ai as quant


UTC = timezone.utc
KEY = bytes(range(32))


def configure_vault(monkeypatch) -> None:
    monkeypatch.setenv(
        integration_secrets.KEYS_ENV,
        json.dumps({"ai-key": urlsafe_b64encode(KEY).decode("ascii")}),
    )
    monkeypatch.setenv(integration_secrets.ACTIVE_KEY_ENV, "ai-key")
    integration_secrets.get_keyring.cache_clear()


@pytest.fixture(autouse=True)
def vault_environment(monkeypatch):
    configure_vault(monkeypatch)
    yield
    integration_secrets.get_keyring.cache_clear()


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


def threshold_source(name: str = "Threshold study") -> str:
    return json.dumps(
        {
            "dsl_version": 1,
            "name": name,
            "description": "Restricted deterministic test study",
            "inputs": {},
            "series": [],
            "plots": [{"series": "close", "color": "#22d3ee"}],
            "signals": [
                {"name": "enter", "op": "cross_above", "left": "close", "right": 2},
                {"name": "exit", "op": "cross_below", "left": "close", "right": 2},
            ],
        },
        separators=(",", ":"),
        sort_keys=True,
    )


def test_restricted_dsl_versions_activation_permissions_and_tamper_detection(db):
    owner = seed_user(db, "script-owner@example.com")
    collaborator = seed_user(db, "script-collaborator@example.com")
    intruder = seed_user(db, "script-intruder@example.com")
    created = quant.create_script(
        db,
        owner.id,
        QuantScriptCreate(name="Threshold", description="v1", source=threshold_source()),
    )
    assert created.versions[0].validation_report["valid"] is True
    assert created.versions[0].validation_report["limits"]["max_bars"] == quant.MAX_BARS
    second = quant.create_script_version(
        db,
        owner.id,
        created.id,
        QuantScriptVersionCreate(
            source=threshold_source("Threshold v2"),
            parent_version_id=created.versions[0].id,
        ),
    )
    active = quant.activate_script_version(db, owner.id, created.id, second.id)
    assert active.active_version_number == 2
    assert active.status == "ACTIVE"
    assert [item.version for item in active.versions] == [1, 2]

    permission = quant.grant_script_permission(
        db,
        owner.id,
        created.id,
        QuantScriptPermissionCreate(grantee_user_id=collaborator.id, permission="RUN"),
    )
    assert permission.permission == "RUN"
    assert quant.revoke_script_permission(db, owner.id, created.id, permission.id).revoked_at is not None
    with pytest.raises(quant.AINotFoundError):
        quant.get_script(db, intruder.id, created.id)
    with pytest.raises(quant.AINotFoundError):
        quant.list_script_permissions(db, intruder.id, created.id)

    before_count = len(db.scalars(select(QuantScript).where(QuantScript.user_id == owner.id)).all())
    unsafe = json.dumps(
        {"dsl_version": 1, "name": "Unsafe", "inputs": {}, "series": [{"name": "x", "op": "python", "source": "close"}]}
    )
    with pytest.raises(quant.AIDSLValidationError, match="unsupported op"):
        quant.create_script(db, owner.id, QuantScriptCreate(name="Unsafe", source=unsafe))
    assert len(db.scalars(select(QuantScript).where(QuantScript.user_id == owner.id)).all()) == before_count
    with pytest.raises(quant.AIDSLValidationError, match="valid JSON"):
        quant.validate_dsl("__import__('os').system('echo no')")
    with pytest.raises(quant.AIExecutionLimitError, match="more than"):
        quant.validate_dsl(threshold_source(), bars=quant.MAX_BARS + 1)

    db.execute(
        update(QuantScriptVersion)
        .where(QuantScriptVersion.id == second.id)
        .values(source=threshold_source("Tampered"))
    )
    db.commit()
    db.expire_all()
    with pytest.raises(quant.AISecurityError, match="integrity"):
        quant.activate_script_version(db, owner.id, created.id, second.id)


def test_offline_generation_conversations_events_usage_cancel_and_isolation(db, caplog):
    owner = seed_user(db, "ai-owner@example.com")
    intruder = seed_user(db, "ai-intruder@example.com")
    conversation = quant.create_conversation(
        db,
        owner.id,
        AIConversationCreate(kind="INDICATOR_BUILD", title="Build momentum", retention_days=30),
    )
    prompt = "PRIVATE-PROMPT build a cautious moving average"
    image_ref = "image-object-abc123"
    request = AIGenerationRequest(
        conversation_id=conversation.id,
        operation="GENERATE_INDICATOR",
        model_id="offline-deterministic",
        prompt=prompt,
        chart_context=AIChartContext(
            symbol="BTCUSD",
            provider="offline-fixture",
            timeframe="1m",
            timezone="UTC",
            history_bars=500,
            session_mode="ALL",
            active_indicators=[{"id": "volume"}],
            selected_objects=["drawing-1"],
        ),
        image=AIChartImageMetadata(
            storage_ref=image_ref,
            sha256="a" * 64,
            mime_type="image/png",
            width=1200,
            height=800,
            byte_size=12345,
        ),
        idempotency_key="offline-generate-1",
    )
    queued = quant.create_generation_job(db, owner.id, request)
    duplicate = quant.create_generation_job(db, owner.id, request)
    assert queued.id == duplicate.id
    assert queued.status == "QUEUED"
    assert len(quant.get_conversation(db, owner.id, conversation.id).messages) == 1
    completed = quant.run_generation_job(db, owner.id, queued.id)
    assert completed.status == "COMPLETED"
    assert completed.actual_cost_micros == 0
    events = quant.list_job_events(db, owner.id, queued.id)
    assert [event.sequence for event in events] == list(range(1, len(events) + 1))
    assert {event.payload.get("status") for event in events if "status" in event.payload} >= {
        "QUEUED",
        "RUNNING",
        "COMPLETED",
    }
    assert any(event.event_type == "PROGRESS" for event in events)
    assert any(event.event_type == "DELTA" for event in events)
    artifacts = quant.list_artifacts(db, owner.id, conversation_id=conversation.id)
    assert len(artifacts) == 1
    assert artifacts[0].artifact_type == "INDICATOR_SOURCE"
    assert artifacts[0].script_version_id is not None
    assert artifacts[0].provenance["request_message_digest"]
    activated = quant.activate_artifact(db, owner.id, artifacts[0].id)
    assert activated.activated_at is not None
    assert quant.get_script(db, owner.id, artifacts[0].script_id).status == "ACTIVE"
    usage = quant.usage_summary(db, owner.id)
    assert (usage.jobs, usage.cost_micros) == (1, 0)
    assert db.scalar(select(AIUsageLedger).where(AIUsageLedger.job_id == queued.id)) is not None

    cancel_conversation = quant.create_conversation(
        db,
        owner.id,
        AIConversationCreate(kind="CHART_ANALYSIS", title="Cancel me"),
    )
    cancellable = quant.create_generation_job(
        db,
        owner.id,
        AIGenerationRequest(
            conversation_id=cancel_conversation.id,
            operation="CHAT",
            model_id="offline-deterministic",
            prompt="cancel before running",
            idempotency_key="cancel-1",
        ),
    )
    assert quant.cancel_generation_job(db, owner.id, cancellable.id).status == "CANCELLED"
    assert quant.run_generation_job(db, owner.id, cancellable.id).status == "CANCELLED"

    assert quant.list_generation_jobs(db, intruder.id) == []
    assert quant.list_conversations(db, intruder.id) == []
    assert quant.list_artifacts(db, intruder.id) == []
    with pytest.raises(quant.AINotFoundError):
        quant.get_generation_job(db, intruder.id, queued.id)
    assert prompt not in caplog.text
    assert image_ref not in caplog.text
    audit_json = json.dumps(
        [row.details for row in db.scalars(select(AIAuditLog).where(AIAuditLog.user_id == owner.id)).all()]
    )
    assert prompt not in audit_json
    assert image_ref not in audit_json


class CredentialAdapter:
    provider_id = "external-ai"

    def __init__(self, *, echo_secret: bool = False) -> None:
        self.echo_secret = echo_secret
        self.seen: dict[str, str] = {}

    def generate(self, credentials, request, emit, cancelled):
        self.seen.update(credentials)
        emit("DELTA", {"delta": "safe provider output"})
        content = {"text": credentials["api_key"] if self.echo_secret else "credential-backed response"}
        return quant.AIProviderResult(content=content, input_tokens=12, output_tokens=4, provider_request_id="req-private")


class CancellingAdapter:
    provider_id = "offline-ai-fixture"

    def __init__(self, session_factory, job_id: int) -> None:
        self.session_factory = session_factory
        self.job_id = job_id
        self.observed_cancel = False

    def generate(self, credentials, request, emit, cancelled):
        with self.session_factory() as cancelling_db:
            cancelling_db.execute(
                update(AIGenerationJob)
                .where(AIGenerationJob.id == self.job_id)
                .values(cancel_requested_at=quant.utcnow())
            )
            cancelling_db.commit()
        self.observed_cancel = cancelled()
        return quant.AIProviderResult(content={"text": "stale result"}, input_tokens=1, output_tokens=1)


def test_running_generation_observes_external_cancellation(db):
    owner = seed_user(db, "cancel-running-ai@example.com")
    conversation = quant.create_conversation(
        db, owner.id, AIConversationCreate(kind="CHART_ANALYSIS", title="Cancel running")
    )
    queued = quant.create_generation_job(
        db,
        owner.id,
        AIGenerationRequest(
            conversation_id=conversation.id,
            operation="CHAT",
            model_id="offline-deterministic",
            prompt="cancel while provider is running",
            idempotency_key="cancel-running",
        ),
    )
    adapter = CancellingAdapter(sessionmaker(bind=db.get_bind()), queued.id)
    router = quant.AIProviderRouter(
        [quant.DEFAULT_MODEL_POLICIES[0]],
        [adapter],
    )

    with pytest.raises(quant.AIConflictError, match="cancelled"):
        quant.run_generation_job(db, owner.id, queued.id, router=router)

    assert adapter.observed_cancel is True
    assert quant.get_generation_job(db, owner.id, queued.id).status == "CANCELLED"
    assert not db.scalars(
        select(AIGeneratedArtifact).where(AIGeneratedArtifact.job_id == queued.id)
    ).all()


def external_router(adapter: CredentialAdapter) -> quant.AIProviderRouter:
    return quant.AIProviderRouter(
        policies=[
            quant.AIModelPolicy(
                model_id="external-standard",
                display_name="Test external",
                provider="external-ai",
                operations=("CHAT",),
                input_token_cost_micros=2,
                output_token_cost_micros=8,
                max_output_tokens=100,
                credential_required=True,
            )
        ],
        adapters=[adapter],
    )


def test_vault_routing_unavailable_tamper_secret_echo_and_cost_limits(db, caplog, monkeypatch):
    owner = seed_user(db, "vault-ai-owner@example.com")
    intruder = seed_user(db, "vault-ai-intruder@example.com")
    conversation = quant.create_conversation(
        db, owner.id, AIConversationCreate(kind="CHART_ANALYSIS", title="Secure provider")
    )
    adapter = CredentialAdapter()
    router = external_router(adapter)
    catalog_before = router.catalog(db, owner.id)[0]
    assert catalog_before.available is False
    assert "encrypted AI-provider credential" in catalog_before.availability_reason
    request = AIGenerationRequest(
        conversation_id=conversation.id,
        operation="CHAT",
        model_id="external-standard",
        prompt="CONFIDENTIAL-PROMPT",
        max_output_tokens=20,
        hard_cost_ceiling_micros=1000,
        idempotency_key="secure-job",
    )
    with pytest.raises(quant.AIProviderUnavailableError, match="encrypted provider credential"):
        quant.create_generation_job(db, owner.id, request, router=router)

    secret_value = "TOP-SECRET-AI-KEY-9981"
    secret = integration_secrets.create_integration_secret(
        db,
        owner.id,
        IntegrationSecretCreate(
            provider="external-ai",
            purpose="ai-provider",
            credentials={"api_key": secret_value},
        ),
    )
    assert router.catalog(db, owner.id)[0].available is True
    assert router.catalog(db, intruder.id)[0].available is False
    queued = quant.create_generation_job(db, owner.id, request, router=router)
    completed = quant.run_generation_job(db, owner.id, queued.id, router=router)
    assert completed.status == "COMPLETED"
    assert completed.actual_cost_micros == 56
    assert adapter.seen == {"api_key": secret_value}
    stored = db.get(IntegrationSecret, secret.id)
    assert secret_value.encode() not in stored.ciphertext
    assert secret_value not in caplog.text
    assert "CONFIDENTIAL-PROMPT" not in caplog.text
    assert secret_value not in json.dumps([row.payload for row in db.scalars(select(AIJobEvent)).all()])

    echo_conversation = quant.create_conversation(
        db, owner.id, AIConversationCreate(kind="CHART_ANALYSIS", title="Echo protection")
    )
    echo_router = external_router(CredentialAdapter(echo_secret=True))
    echo_job = quant.create_generation_job(
        db,
        owner.id,
        AIGenerationRequest(
            conversation_id=echo_conversation.id,
            operation="CHAT",
            model_id="external-standard",
            prompt="do not echo credentials",
            max_output_tokens=20,
            hard_cost_ceiling_micros=1000,
            idempotency_key="echo-job",
        ),
        router=echo_router,
    )
    with pytest.raises(quant.AISecurityError):
        quant.run_generation_job(db, owner.id, echo_job.id, router=echo_router)
    assert quant.get_generation_job(db, owner.id, echo_job.id).status == "FAILED"
    assert not db.scalars(
        select(AIGeneratedArtifact).where(AIGeneratedArtifact.job_id == echo_job.id)
    ).all()

    tamper_conversation = quant.create_conversation(
        db, owner.id, AIConversationCreate(kind="CHART_ANALYSIS", title="Tamper protection")
    )
    tamper_job = quant.create_generation_job(
        db,
        owner.id,
        AIGenerationRequest(
            conversation_id=tamper_conversation.id,
            operation="CHAT",
            model_id="external-standard",
            prompt="safe failure",
            max_output_tokens=20,
            hard_cost_ceiling_micros=1000,
            idempotency_key="tamper-job",
        ),
        router=router,
    )
    stored.ciphertext = bytes([stored.ciphertext[0] ^ 1]) + stored.ciphertext[1:]
    db.commit()
    with pytest.raises(quant.AIProviderUnavailableError, match="failed safely"):
        quant.run_generation_job(db, owner.id, tamper_job.id, router=router)
    assert quant.get_generation_job(db, owner.id, tamper_job.id).error_code == "PROVIDER_EXECUTION_FAILED"

    costly_policy = quant.AIModelPolicy(
        model_id="costly",
        display_name="Costly fixture",
        provider="offline-ai-fixture",
        operations=("CHAT",),
        input_token_cost_micros=100,
        output_token_cost_micros=100,
        max_output_tokens=100,
        credential_required=False,
    )
    costly_router = quant.AIProviderRouter(
        [costly_policy], [quant.DeterministicFixtureAIAdapter()]
    )
    with pytest.raises(quant.AICostLimitError, match="hard cost ceiling"):
        quant.create_generation_job(
            db,
            owner.id,
            AIGenerationRequest(
                conversation_id=conversation.id,
                operation="CHAT",
                model_id="costly",
                prompt="too expensive",
                max_output_tokens=10,
                hard_cost_ceiling_micros=1,
                idempotency_key="cost-limit",
            ),
            router=costly_router,
        )

    monkeypatch.setattr(quant, "PER_MINUTE_JOB_LIMIT", 1)
    fresh_user = seed_user(db, "rate-ai@example.com")
    fresh_conversation = quant.create_conversation(
        db, fresh_user.id, AIConversationCreate(kind="CHART_ANALYSIS", title="Rate")
    )
    quant.create_generation_job(
        db,
        fresh_user.id,
        AIGenerationRequest(
            conversation_id=fresh_conversation.id,
            operation="CHAT",
            model_id="offline-deterministic",
            prompt="first",
            idempotency_key="rate-first",
        ),
    )
    with pytest.raises(quant.AIQuotaError, match="per minute"):
        quant.create_generation_job(
            db,
            fresh_user.id,
            AIGenerationRequest(
                conversation_id=fresh_conversation.id,
                operation="CHAT",
                model_id="offline-deterministic",
                prompt="second",
                idempotency_key="rate-second",
            ),
        )

    monkeypatch.setattr(quant, "PER_MINUTE_JOB_LIMIT", 10)
    concurrent_user = seed_user(db, "concurrency-ai@example.com")
    concurrent_conversation = quant.create_conversation(
        db, concurrent_user.id, AIConversationCreate(kind="CHART_ANALYSIS", title="Concurrency")
    )
    concurrent_jobs = [
        quant.create_generation_job(
            db,
            concurrent_user.id,
            AIGenerationRequest(
                conversation_id=concurrent_conversation.id,
                operation="CHAT",
                model_id="offline-deterministic",
                prompt=f"job {index}",
                idempotency_key=f"concurrent-{index}",
            ),
        )
        for index in range(3)
    ]
    for queued_job in concurrent_jobs[:2]:
        db.get(AIGenerationJob, queued_job.id).status = "RUNNING"
    db.commit()
    with pytest.raises(quant.AIQuotaError, match="concurrently"):
        quant.run_generation_job(db, concurrent_user.id, concurrent_jobs[2].id)


def test_reproducible_backtest_retention_and_routes(db):
    owner = seed_user(db, "backtest-ai@example.com")
    instrument = market.create_instrument(
        db,
        owner.id,
        MarketInstrumentCreate(
            canonical_symbol="BTCUSD",
            display_name="Bitcoin fixture",
            asset_class="CRYPTO",
            instrument_type="SPOT",
            exchange="FIXTURE",
            currency="USD",
            timezone="UTC",
            tick_size=Decimal("0.01"),
            tick_value=Decimal("0.01"),
            identifiers=[MarketIdentifierCreate(provider="offline-fixture", provider_symbol="BTCUSD")],
        ),
    )
    start = datetime(2024, 1, 1, tzinfo=UTC)
    market.ingest_candles(
        db,
        owner.id,
        instrument.id,
        "offline-fixture",
        [
            market.CandleRecord(
                start_at=start + timedelta(minutes=index),
                interval_seconds=60,
                open=value,
                high=value,
                low=value,
                close=value,
                volume=Decimal("10"),
                complete=index != 2,
            )
            for index, value in enumerate(map(Decimal, ["1", "3", "4", "1"]))
        ],
    )
    db.commit()
    script = quant.create_script(
        db, owner.id, QuantScriptCreate(name="Backtest threshold", source=threshold_source())
    )
    request = AIBacktestRequest(
        script_version_id=script.versions[0].id,
        instrument_id=instrument.id,
        interval_seconds=60,
        from_at=start,
        to_at=start + timedelta(minutes=4),
        entry_signal="enter",
        exit_signal="exit",
        position_size=Decimal("1"),
        cost_per_trade=Decimal("0.25"),
    )
    first = quant.run_indicator_backtest(db, owner.id, request)
    second = quant.run_indicator_backtest(db, owner.id, request)
    assert first.id == second.id
    assert first.metrics == {
        "bars": 4,
        "trades": 1,
        "wins": 0,
        "losses": 1,
        "win_rate": "0",
        "net_pnl": "-2.25",
        "max_drawdown": "2.25",
    }
    assert first.warnings == [
        "Input contains incomplete candles; results should not be treated as final."
    ]
    assert first.assumptions["source_hash"] == script.versions[0].source_hash
    assert first.reproducibility_hash

    conversation = quant.create_conversation(
        db,
        owner.id,
        AIConversationCreate(kind="INDICATOR_BUILD", title="Short retention", retention_days=1),
    )
    job = quant.create_generation_job(
        db,
        owner.id,
        AIGenerationRequest(
            conversation_id=conversation.id,
            operation="GENERATE_INDICATOR",
            model_id="offline-deterministic",
            prompt="retention-sensitive prompt",
            chart_context=AIChartContext(
                symbol="BTCUSD", provider="offline-fixture", timeframe="1m", timezone="UTC"
            ),
            auto_backtest=AIAutoBacktestConfig(
                instrument_id=instrument.id,
                interval_seconds=60,
                from_at=start,
                to_at=start + timedelta(minutes=4),
                entry_signal="cross_up",
                exit_signal="cross_down",
                position_size=Decimal("1"),
                cost_per_trade=Decimal("0.25"),
            ),
            idempotency_key="retention-job",
        ),
    )
    quant.run_generation_job(db, owner.id, job.id)
    assert any(event.event_type == "BACKTEST" for event in quant.list_job_events(db, owner.id, job.id))
    assert len(quant.list_backtests(db, owner.id)) == 2
    conversation_row = db.get(AIConversation, conversation.id)
    artifact = db.scalar(
        select(AIGeneratedArtifact).where(AIGeneratedArtifact.job_id == job.id)
    )
    expiration = datetime(2024, 1, 2)
    conversation_row.retention_until = expiration
    artifact.retention_until = expiration
    db.commit()
    result = quant.purge_expired_ai_data(db, owner.id, now=datetime(2024, 1, 3))
    assert result.model_dump() == {
        "conversations_purged": 1,
        "messages_purged": 2,
        "artifacts_purged": 1,
    }
    db.expire_all()
    messages = db.scalars(select(AIMessage).where(AIMessage.conversation_id == conversation.id)).all()
    assert all(message.content == "" and message.chart_context == {} and message.image_metadata == {} for message in messages)
    retained_artifact = db.get(AIGeneratedArtifact, artifact.id)
    assert retained_artifact.content == {}
    assert retained_artifact.provenance
    assert db.get(AIGenerationJob, job.id).status == "COMPLETED"
    assert db.scalar(select(AIUsageLedger).where(AIUsageLedger.job_id == job.id)) is not None
    assert db.get(QuantScriptVersion, script.versions[0].id).source == threshold_source()

    quant_paths = {route.path for route in main.app.routes if route.path.startswith("/api/quant")}
    assert {
        "/api/quant/models",
        "/api/quant/scripts",
        "/api/quant/conversations",
        "/api/quant/jobs",
        "/api/quant/jobs/{job_id}/events/stream",
        "/api/quant/artifacts",
        "/api/quant/backtests",
        "/api/quant/usage",
        "/api/quant/retention/purge",
    } <= quant_paths


def test_sqlite_migration_creates_quant_ai_tables(tmp_path):
    database = tmp_path / "quant-ai.sqlite3"
    url = f"sqlite:///{database}"
    engine = create_engine(url)
    Base.metadata.tables["beta_users"].create(engine)
    run_migrations(engine, url)
    run_migrations(engine, url)
    assert {
        "quant_scripts",
        "quant_script_versions",
        "quant_script_permissions",
        "ai_conversations",
        "ai_messages",
        "ai_generation_jobs",
        "ai_job_events",
        "ai_generated_artifacts",
        "ai_backtest_runs",
        "ai_usage_ledger",
        "ai_audit_logs",
    } <= set(inspect(engine).get_table_names())
