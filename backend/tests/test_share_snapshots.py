from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier

import pytest
from app.db import Base
from app.models import BetaUser, WorkspaceShareSnapshot
from app.schemas import WorkspaceShareCreate
from app.services import share_snapshots
from app.services.share_snapshots import (
    create_workspace_share,
    get_public_workspace_share,
    list_workspace_shares,
    purge_workspace_share_payload,
    revoke_workspace_share,
)
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker


def make_session_factory():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def seed_user(db, email: str) -> BetaUser:
    user = BetaUser(
        email=email,
        name=email.split("@", 1)[0].title(),
        provider="google",
        status="APPROVED",
    )
    db.add(user)
    db.commit()
    return user


def share_request(
    scope: str = "chart-plus-panels",
    *,
    recipient_email: str | None = None,
    workspace_key: str = "replay:eurusd",
) -> WorkspaceShareCreate:
    chart = {
        "symbol": "EURUSD",
        "timeframe": "1m",
        "paneLayout": "single",
        "panes": [{"id": "chart-pane-1", "timeframe": "1m"}],
        "candles": [
            {
                "time": 1_704_103_200,
                "timestamp": "2024-01-01T09:20:00Z",
                "open": 1.1,
                "high": 1.2,
                "low": 1.0,
                "close": 1.15,
                "volume": 10,
            }
        ],
    }
    panels = {
        "activePanel": "results",
        "metrics": {"netPnl": 125.5, "winRate": 60, "totalTrades": 5},
    }
    payload: dict[str, object] = {"schemaVersion": 1, "panels": panels}
    if scope != "panels-only":
        payload["chart"] = chart
    if scope == "complete-workspace":
        payload["workspace"] = {
            "layoutName": "London replay",
            "paneLayout": "single",
            "timezone": "Europe/London",
        }
    return WorkspaceShareCreate(
        workspace_key=workspace_key,
        title="EURUSD review",
        scope=scope,
        recipient_email=recipient_email,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        payload=payload,
    )


def test_snapshots_are_versioned_hashed_and_immutable():
    session_factory = make_session_factory()
    with session_factory() as db:
        owner = seed_user(db, "owner@example.com")
        request = share_request()
        first = create_workspace_share(db, owner.id, request)
        second = create_workspace_share(db, owner.id, request)

        assert first.snapshot_version == 1
        assert second.snapshot_version == 2
        assert first.payload_available is True
        assert first.public_token != second.public_token

        stored = db.scalar(
            select(WorkspaceShareSnapshot).where(WorkspaceShareSnapshot.id == first.id)
        )
        assert stored is not None
        assert stored.token_digest != first.public_token
        assert len(stored.token_digest) == 64
        assert stored.payload["panels"]["metrics"]["netPnl"] == 125.5

        request.payload.panels.metrics.net_pnl = 999
        db.expire_all()
        stored = db.get(WorkspaceShareSnapshot, first.id)
        assert stored is not None
        assert stored.payload["panels"]["metrics"]["netPnl"] == 125.5

        stored.payload = {"schemaVersion": 1}
        with pytest.raises(ValueError, match="immutable"):
            db.commit()
        db.rollback()


@pytest.mark.parametrize(
    ("scope", "has_chart", "has_workspace"),
    [
        ("chart-plus-panels", True, False),
        ("panels-only", False, False),
        ("complete-workspace", True, True),
    ],
)
def test_all_share_scopes_round_trip(scope, has_chart, has_workspace):
    session_factory = make_session_factory()
    with session_factory() as db:
        owner = seed_user(db, f"{scope}@example.com")
        created = create_workspace_share(db, owner.id, share_request(scope))
        opened = get_public_workspace_share(
            db,
            owner.id,
            owner.email,
            created.public_token,
        )

        assert opened.scope == scope
        assert (opened.payload.chart is not None) is has_chart
        assert opened.payload.panels is not None
        assert (opened.payload.workspace is not None) is has_workspace


def test_open_requires_owner_or_exact_recipient_account():
    session_factory = make_session_factory()
    with session_factory() as db:
        owner = seed_user(db, "owner@example.com")
        recipient = seed_user(db, "recipient@example.com")
        intruder = seed_user(db, "intruder@example.com")
        created = create_workspace_share(
            db,
            owner.id,
            share_request(recipient_email=" Recipient@Example.com "),
        )
        assert created.recipient_email == "recipient@example.com"
        assert "recipient_user_id" not in created.model_dump()

        stored = db.get(WorkspaceShareSnapshot, created.id)
        assert stored is not None
        assert stored.recipient_user_id == recipient.id

        recipient_copy = get_public_workspace_share(
            db,
            recipient.id,
            recipient.email,
            created.public_token,
        )
        owner_copy = get_public_workspace_share(
            db,
            owner.id,
            owner.email,
            created.public_token,
        )
        assert recipient_copy.payload.chart.symbol == "EURUSD"
        assert owner_copy.snapshot_version == created.snapshot_version

        with pytest.raises(HTTPException) as exc_info:
            get_public_workspace_share(
                db,
                intruder.id,
                intruder.email,
                created.public_token,
            )
        assert exc_info.value.status_code == 404

        owner_rows = list_workspace_shares(db, owner.id)
        assert [row.id for row in owner_rows] == [created.id]
        assert "public_token" not in owner_rows[0].model_dump()
        assert "recipient_user_id" not in owner_rows[0].model_dump()


def test_owner_only_snapshot_cannot_be_opened_by_another_user():
    session_factory = make_session_factory()
    with session_factory() as db:
        owner = seed_user(db, "owner@example.com")
        intruder = seed_user(db, "intruder@example.com")
        created = create_workspace_share(db, owner.id, share_request())

        assert (
            get_public_workspace_share(
                db,
                owner.id,
                owner.email,
                created.public_token,
            ).title
            == "EURUSD review"
        )
        with pytest.raises(HTTPException) as exc_info:
            get_public_workspace_share(
                db,
                intruder.id,
                intruder.email,
                created.public_token,
            )
        assert exc_info.value.status_code == 404


def test_malformed_expired_and_revoked_tokens_are_rejected():
    session_factory = make_session_factory()
    with session_factory() as db:
        owner = seed_user(db, "owner@example.com")
        with pytest.raises(HTTPException) as malformed:
            get_public_workspace_share(db, owner.id, owner.email, "not-a-token")
        assert malformed.value.status_code == 404

        revoked = create_workspace_share(db, owner.id, share_request())
        revoke_workspace_share(db, owner.id, revoked.id)
        with pytest.raises(HTTPException) as revoked_error:
            get_public_workspace_share(db, owner.id, owner.email, revoked.public_token)
        assert revoked_error.value.status_code == 410

        expiring = create_workspace_share(db, owner.id, share_request())
        db.execute(
            update(WorkspaceShareSnapshot)
            .where(WorkspaceShareSnapshot.id == expiring.id)
            .values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1))
        )
        db.commit()
        with pytest.raises(HTTPException) as expired_error:
            get_public_workspace_share(db, owner.id, owner.email, expiring.public_token)
        assert expired_error.value.status_code == 410


def test_active_payload_purge_is_rejected_without_mutation():
    session_factory = make_session_factory()
    with session_factory() as db:
        owner = seed_user(db, "active-purge-owner@example.com")
        created = create_workspace_share(db, owner.id, share_request())
        original_payload = db.get(WorkspaceShareSnapshot, created.id).payload

        with pytest.raises(HTTPException) as exc_info:
            purge_workspace_share_payload(db, owner.id, created.id)

        assert exc_info.value.status_code == 409
        db.expire_all()
        stored = db.get(WorkspaceShareSnapshot, created.id)
        assert stored.payload == original_payload
        assert list_workspace_shares(db, owner.id)[0].payload_available is True


def test_revoked_payload_purge_is_idempotent_and_preserves_version_metadata():
    session_factory = make_session_factory()
    with session_factory() as db:
        owner = seed_user(db, "revoked-purge-owner@example.com")
        intruder = seed_user(db, "purge-intruder@example.com")
        created = create_workspace_share(db, owner.id, share_request())
        revoked = revoke_workspace_share(db, owner.id, created.id)
        assert revoked.payload_available is True

        with pytest.raises(HTTPException) as owner_error:
            purge_workspace_share_payload(db, intruder.id, created.id)
        assert owner_error.value.status_code == 404

        purged = purge_workspace_share_payload(db, owner.id, created.id)
        purged_again = purge_workspace_share_payload(db, owner.id, created.id)

        assert purged.payload_available is False
        assert purged_again == purged
        stored = db.get(WorkspaceShareSnapshot, created.id)
        assert stored.payload == {}
        assert stored.workspace_key == "replay:eurusd"
        assert stored.snapshot_version == 1
        assert stored.title == "EURUSD review"
        with pytest.raises(HTTPException) as open_error:
            get_public_workspace_share(db, owner.id, owner.email, created.public_token)
        assert open_error.value.status_code == 410

        next_snapshot = create_workspace_share(db, owner.id, share_request())
        assert next_snapshot.snapshot_version == 2

        stored.payload = {"schemaVersion": 1}
        with pytest.raises(ValueError, match="immutable"):
            db.commit()
        db.rollback()


def test_expired_payload_can_be_purged_while_metadata_is_retained():
    session_factory = make_session_factory()
    with session_factory() as db:
        owner = seed_user(db, "expired-purge-owner@example.com")
        created = create_workspace_share(db, owner.id, share_request())
        db.execute(
            update(WorkspaceShareSnapshot)
            .where(WorkspaceShareSnapshot.id == created.id)
            .values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1))
        )
        db.commit()

        purged = purge_workspace_share_payload(db, owner.id, created.id)
        purged_again = purge_workspace_share_payload(db, owner.id, created.id)

        assert purged.payload_available is False
        assert purged_again.payload_available is False
        stored = db.get(WorkspaceShareSnapshot, created.id)
        assert stored.payload == {}
        assert (stored.workspace_key, stored.snapshot_version, stored.title) == (
            "replay:eurusd",
            1,
            "EURUSD review",
        )
        with pytest.raises(HTTPException) as open_error:
            get_public_workspace_share(db, owner.id, owner.email, created.public_token)
        assert open_error.value.status_code == 410


def test_scope_validation_rejects_credentials_orders_and_mismatched_shapes():
    with pytest.raises(ValidationError):
        WorkspaceShareCreate.model_validate(
            {
                **share_request("panels-only").model_dump(),
                "payload": {
                    "schemaVersion": 1,
                    "panels": {
                        "metrics": {},
                        "credentials": {"apiKey": "secret"},
                    },
                },
            }
        )

    with pytest.raises(ValidationError):
        WorkspaceShareCreate.model_validate(
            {
                **share_request("chart-plus-panels").model_dump(),
                "payload": {
                    "schemaVersion": 1,
                    "chart": {
                        "symbol": "EURUSD",
                        "timeframe": "1m",
                        "panes": [
                            {
                                "id": "chart-pane-1",
                                "timeframe": "1m",
                                "orders": [{"id": 1}],
                            }
                        ],
                    },
                    "panels": {"metrics": {}},
                },
            }
        )

    with pytest.raises(ValidationError, match="does not match panels-only"):
        WorkspaceShareCreate.model_validate(
            {
                **share_request("panels-only").model_dump(),
                "payload": share_request("chart-plus-panels").payload.model_dump(),
            }
        )

    with pytest.raises(ValidationError, match="recipient_user_id"):
        WorkspaceShareCreate.model_validate(
            {
                **share_request("panels-only").model_dump(),
                "recipient_user_id": 123,
            }
        )


def test_concurrent_creates_allocate_unique_monotonic_versions(tmp_path):
    database_path = tmp_path / "concurrent-shares.sqlite"
    engine = create_engine(
        f"sqlite:///{database_path}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    with session_factory() as db:
        owner_id = seed_user(db, "concurrent-owner@example.com").id

    workers = 8
    barrier = Barrier(workers)

    def create_one(_index: int) -> int:
        barrier.wait()
        with session_factory() as db:
            return create_workspace_share(
                db,
                owner_id,
                share_request(),
            ).snapshot_version

    with ThreadPoolExecutor(max_workers=workers) as executor:
        versions = list(executor.map(create_one, range(workers)))

    assert sorted(versions) == list(range(1, workers + 1))
    with session_factory() as db:
        stored_versions = db.scalars(
            select(WorkspaceShareSnapshot.snapshot_version).order_by(
                WorkspaceShareSnapshot.snapshot_version
            )
        ).all()
        assert stored_versions == list(range(1, workers + 1))


def test_persistent_version_collision_returns_clean_api_error(monkeypatch):
    session_factory = make_session_factory()
    with session_factory() as db:
        owner = seed_user(db, "collision-owner@example.com")

        def reject_commit():
            raise IntegrityError("INSERT", {}, Exception("unique collision"))

        monkeypatch.setattr(db, "commit", reject_commit)
        with pytest.raises(HTTPException) as exc_info:
            create_workspace_share(db, owner.id, share_request())

    assert exc_info.value.status_code == 409
    assert (
        exc_info.value.detail
        == "Workspace share changed concurrently; retry the request"
    )


def test_active_share_and_storage_quotas_are_per_user(monkeypatch):
    monkeypatch.setattr(share_snapshots, "MAX_ACTIVE_SHARES_PER_USER", 2)
    session_factory = make_session_factory()
    with session_factory() as db:
        owner = seed_user(db, "quota-owner@example.com")
        other = seed_user(db, "quota-other@example.com")
        create_workspace_share(db, owner.id, share_request())
        create_workspace_share(db, owner.id, share_request())

        with pytest.raises(HTTPException) as active_error:
            create_workspace_share(db, owner.id, share_request())
        assert active_error.value.status_code == 429
        assert "Active workspace share quota" in active_error.value.detail

        assert (
            create_workspace_share(
                db,
                other.id,
                share_request(),
            ).snapshot_version
            == 1
        )

    monkeypatch.setattr(share_snapshots, "MAX_ACTIVE_SHARES_PER_USER", 100)
    monkeypatch.setattr(share_snapshots, "MAX_SHARE_STORAGE_BYTES_PER_USER", 1)
    with session_factory() as db:
        storage_owner = seed_user(db, "storage-owner@example.com")
        with pytest.raises(HTTPException) as storage_error:
            create_workspace_share(db, storage_owner.id, share_request())
        assert storage_error.value.status_code == 413
        assert "storage quota" in storage_error.value.detail


def test_workspace_filter_is_applied_before_stable_pagination():
    session_factory = make_session_factory()
    with session_factory() as db:
        owner = seed_user(db, "pagination-owner@example.com")
        target = create_workspace_share(
            db,
            owner.id,
            share_request(workspace_key="replay:target"),
        )
        for index in range(55):
            create_workspace_share(
                db,
                owner.id,
                share_request(workspace_key=f"replay:unrelated-{index}"),
            )

        newest_page = list_workspace_shares(db, owner.id, limit=50)
        assert target.id not in {row.id for row in newest_page}

        target_rows = list_workspace_shares(
            db,
            owner.id,
            workspace_key="replay:target",
            limit=50,
        )
        assert [row.id for row in target_rows] == [target.id]

        final_page = list_workspace_shares(db, owner.id, offset=50, limit=10)
        assert len(final_page) == 6
        assert final_page[-1].id == target.id
