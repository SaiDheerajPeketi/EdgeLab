import json
import re
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from hmac import compare_digest
from secrets import token_urlsafe
from threading import Lock, RLock

from app.models import BetaUser, WorkspaceShareSnapshot, utcnow
from app.schemas import (
    WorkspaceShareCreate,
    WorkspaceShareCreatedRead,
    WorkspaceShareOwnerRead,
    WorkspaceSharePayload,
    WorkspaceSharePublicRead,
)
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

PUBLIC_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{40,128}$")
MAX_SHARE_LIFETIME = timedelta(days=365)
MAX_ACTIVE_SHARES_PER_USER = 100
MAX_SHARE_STORAGE_BYTES_PER_USER = 25 * 1024 * 1024
MAX_CREATE_ATTEMPTS = 4
PUBLIC_SHARE_UNAVAILABLE = "This shared workspace is no longer available"
_create_locks: dict[tuple[int, int], RLock] = {}
_create_locks_guard = Lock()


def create_workspace_share(
    db: Session,
    user_id: int,
    payload: WorkspaceShareCreate,
) -> WorkspaceShareCreatedRead:
    now = utcnow()
    expires_at = _normalized_datetime(payload.expires_at)
    if expires_at is not None:
        if expires_at <= _normalized_datetime(now):
            raise HTTPException(
                status_code=400, detail="Share expiry must be in the future"
            )
        if expires_at - _normalized_datetime(now) > MAX_SHARE_LIFETIME:
            raise HTTPException(
                status_code=400, detail="Share expiry cannot exceed one year"
            )

    stored_payload = deepcopy(
        payload.payload.model_dump(mode="json", by_alias=True, exclude_none=True)
    )
    payload_size = _payload_size_bytes(stored_payload)

    with _create_lock(db, user_id):
        for attempt in range(MAX_CREATE_ATTEMPTS):
            try:
                _lock_owner_row(db, user_id)
                _enforce_share_quotas(db, user_id, payload_size, now=now)
                latest_version = db.scalar(
                    select(func.max(WorkspaceShareSnapshot.snapshot_version)).where(
                        WorkspaceShareSnapshot.user_id == user_id,
                        WorkspaceShareSnapshot.workspace_key == payload.workspace_key,
                    )
                )
                recipient_user_id, recipient_email = _resolve_recipient(db, payload)
                public_token = _unique_public_token(db)
                snapshot = WorkspaceShareSnapshot(
                    user_id=user_id,
                    workspace_key=payload.workspace_key,
                    snapshot_version=int(latest_version or 0) + 1,
                    schema_version=payload.payload.schema_version,
                    scope=payload.scope,
                    title=payload.title,
                    recipient_user_id=recipient_user_id,
                    recipient_email=recipient_email,
                    token_digest=_token_digest(public_token),
                    payload=deepcopy(stored_payload),
                    expires_at=expires_at,
                    created_at=now,
                )
                db.add(snapshot)
                db.commit()
                db.refresh(snapshot)
                return WorkspaceShareCreatedRead(
                    **_owner_fields(snapshot),
                    public_token=public_token,
                )
            except IntegrityError:
                db.rollback()
                if attempt + 1 == MAX_CREATE_ATTEMPTS:
                    break

    raise HTTPException(
        status_code=409,
        detail="Workspace share changed concurrently; retry the request",
    )


def list_workspace_shares(
    db: Session,
    user_id: int,
    *,
    workspace_key: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> list[WorkspaceShareOwnerRead]:
    query = select(WorkspaceShareSnapshot).where(
        WorkspaceShareSnapshot.user_id == user_id
    )
    if workspace_key is not None:
        query = query.where(WorkspaceShareSnapshot.workspace_key == workspace_key)
    snapshots = db.scalars(
        query.order_by(
            WorkspaceShareSnapshot.created_at.desc(),
            WorkspaceShareSnapshot.id.desc(),
        )
        .offset(offset)
        .limit(limit)
    ).all()
    return [
        WorkspaceShareOwnerRead(**_owner_fields(snapshot)) for snapshot in snapshots
    ]


def revoke_workspace_share(
    db: Session,
    user_id: int,
    snapshot_id: int,
) -> WorkspaceShareOwnerRead:
    snapshot = db.scalar(
        select(WorkspaceShareSnapshot).where(
            WorkspaceShareSnapshot.id == snapshot_id,
            WorkspaceShareSnapshot.user_id == user_id,
        )
    )
    if snapshot is None:
        raise HTTPException(status_code=404, detail="Workspace share not found")
    if snapshot.revoked_at is None:
        snapshot.revoked_at = utcnow()
        db.commit()
        db.refresh(snapshot)
    return WorkspaceShareOwnerRead(**_owner_fields(snapshot))


def purge_workspace_share_payload(
    db: Session,
    user_id: int,
    snapshot_id: int,
) -> WorkspaceShareOwnerRead:
    snapshot = db.scalar(
        select(WorkspaceShareSnapshot).where(
            WorkspaceShareSnapshot.id == snapshot_id,
            WorkspaceShareSnapshot.user_id == user_id,
        )
    )
    if snapshot is None:
        raise HTTPException(status_code=404, detail="Workspace share not found")
    expired = snapshot.expires_at is not None and _normalized_datetime(
        snapshot.expires_at
    ) <= _normalized_datetime(utcnow())
    if snapshot.revoked_at is None and not expired:
        raise HTTPException(
            status_code=409,
            detail="Revoke the workspace share or wait for expiry before purging payload",
        )
    if snapshot.payload != {}:
        snapshot.payload = {}
        db.commit()
        db.refresh(snapshot)
    return WorkspaceShareOwnerRead(**_owner_fields(snapshot))


def get_public_workspace_share(
    db: Session,
    user_id: int,
    user_email: str,
    public_token: str | None,
) -> WorkspaceSharePublicRead:
    token = (public_token or "").strip()
    if not PUBLIC_TOKEN_PATTERN.fullmatch(token):
        raise HTTPException(status_code=404, detail="Shared workspace not found")
    token_digest = _token_digest(token)

    snapshot = db.scalar(
        select(WorkspaceShareSnapshot).where(
            WorkspaceShareSnapshot.token_digest == token_digest
        )
    )
    if snapshot is None:
        raise HTTPException(status_code=404, detail="Shared workspace not found")
    if not compare_digest(snapshot.token_digest, token_digest):
        raise HTTPException(status_code=404, detail="Shared workspace not found")
    normalized_email = user_email.strip().lower()
    can_open = snapshot.user_id == user_id or (
        snapshot.recipient_user_id == user_id
        or (
            snapshot.recipient_user_id is None
            and snapshot.recipient_email is not None
            and compare_digest(snapshot.recipient_email, normalized_email)
        )
    )
    if not can_open:
        raise HTTPException(status_code=404, detail="Shared workspace not found")
    if snapshot.revoked_at is not None:
        raise HTTPException(status_code=410, detail=PUBLIC_SHARE_UNAVAILABLE)
    if snapshot.expires_at is not None and _normalized_datetime(
        snapshot.expires_at
    ) <= _normalized_datetime(utcnow()):
        raise HTTPException(status_code=410, detail=PUBLIC_SHARE_UNAVAILABLE)

    try:
        safe_payload = WorkspaceSharePayload.model_validate(deepcopy(snapshot.payload))
    except ValidationError as exc:
        raise HTTPException(status_code=410, detail=PUBLIC_SHARE_UNAVAILABLE) from exc

    return WorkspaceSharePublicRead(
        snapshot_version=snapshot.snapshot_version,
        schema_version=snapshot.schema_version,
        scope=snapshot.scope,
        title=snapshot.title,
        created_at=snapshot.created_at,
        expires_at=snapshot.expires_at,
        payload=safe_payload,
    )


def _owner_fields(snapshot: WorkspaceShareSnapshot) -> dict[str, object]:
    return {
        "id": snapshot.id,
        "workspace_key": snapshot.workspace_key,
        "snapshot_version": snapshot.snapshot_version,
        "schema_version": snapshot.schema_version,
        "scope": snapshot.scope,
        "title": snapshot.title,
        "payload_available": snapshot.payload != {},
        "recipient_email": snapshot.recipient_email,
        "created_at": snapshot.created_at,
        "expires_at": snapshot.expires_at,
        "revoked_at": snapshot.revoked_at,
    }


def _create_lock(db: Session, user_id: int) -> RLock:
    key = (id(db.get_bind()), user_id)
    with _create_locks_guard:
        lock = _create_locks.get(key)
        if lock is None:
            lock = RLock()
            _create_locks[key] = lock
        return lock


def _lock_owner_row(db: Session, user_id: int) -> None:
    owner_id = db.scalar(
        select(BetaUser.id).where(BetaUser.id == user_id).with_for_update()
    )
    if owner_id is None:
        raise HTTPException(status_code=404, detail="Share owner not found")


def _enforce_share_quotas(
    db: Session,
    user_id: int,
    proposed_payload_bytes: int,
    *,
    now: datetime,
) -> None:
    active_filter = (
        WorkspaceShareSnapshot.user_id == user_id,
        WorkspaceShareSnapshot.revoked_at.is_(None),
        or_(
            WorkspaceShareSnapshot.expires_at.is_(None),
            WorkspaceShareSnapshot.expires_at > now,
        ),
    )
    active_count = int(
        db.scalar(select(func.count(WorkspaceShareSnapshot.id)).where(*active_filter))
        or 0
    )
    if active_count >= MAX_ACTIVE_SHARES_PER_USER:
        raise HTTPException(
            status_code=429,
            detail=(
                "Active workspace share quota exceeded; revoke or let an existing "
                "share expire before creating another"
            ),
        )

    stored_payloads = db.scalars(
        select(WorkspaceShareSnapshot.payload).where(
            WorkspaceShareSnapshot.user_id == user_id
        )
    ).all()
    stored_bytes = sum(
        _payload_size_bytes(value) for value in stored_payloads if value != {}
    )
    if stored_bytes + proposed_payload_bytes > MAX_SHARE_STORAGE_BYTES_PER_USER:
        raise HTTPException(
            status_code=413,
            detail=(
                "Workspace share storage quota exceeded; revoke or let an existing "
                "share expire before creating another"
            ),
        )


def _payload_size_bytes(value: object) -> int:
    return len(
        json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    )


def _unique_public_token(db: Session) -> str:
    for _attempt in range(4):
        token = token_urlsafe(32)
        exists = db.scalar(
            select(WorkspaceShareSnapshot.id).where(
                WorkspaceShareSnapshot.token_digest == _token_digest(token)
            )
        )
        if exists is None:
            return token
    raise HTTPException(status_code=503, detail="Could not create a workspace share")


def _resolve_recipient(
    db: Session,
    payload: WorkspaceShareCreate,
) -> tuple[int | None, str | None]:
    if payload.recipient_email is None:
        return None, None

    normalized_email = payload.recipient_email.strip().lower()
    recipient = db.scalar(
        select(BetaUser).where(func.lower(BetaUser.email) == normalized_email)
    )
    return (recipient.id if recipient is not None else None), normalized_email


def _token_digest(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()


def _normalized_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)
