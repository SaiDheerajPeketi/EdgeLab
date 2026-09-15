from __future__ import annotations

from base64 import urlsafe_b64decode
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from functools import lru_cache
import json
import os
import re
from secrets import token_bytes
from types import MappingProxyType
from typing import TypeVar

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import IntegrationSecret, utcnow
from app.schemas import (
    IntegrationSecretConnectionRead,
    IntegrationSecretCreate,
    IntegrationSecretRead,
    IntegrationSecretReplace,
)


KEYS_ENV = "EDGELAB_SECRET_VAULT_KEYS"
ACTIVE_KEY_ENV = "EDGELAB_SECRET_VAULT_ACTIVE_KEY_ID"
CIPHER_VERSION = 1
NONCE_BYTES = 12
MAX_PLAINTEXT_BYTES = 64 * 1024
MAX_CREDENTIAL_VALUE_CHARS = 8 * 1024
KEY_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
CREDENTIAL_NAME_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9._-]{0,63}$")
T = TypeVar("T")


class IntegrationSecretError(Exception):
    status_code = 500
    public_message = "Integration credential operation failed"

    def __init__(self, public_message: str | None = None) -> None:
        super().__init__(public_message or self.public_message)
        self.public_message = public_message or self.public_message


class VaultConfigurationError(IntegrationSecretError):
    status_code = 503
    public_message = "Integration credential vault is not configured"


class VaultInputError(IntegrationSecretError):
    status_code = 400
    public_message = "Integration credential payload is invalid"


class VaultConflictError(IntegrationSecretError):
    status_code = 409
    public_message = "An integration credential already exists for this provider and purpose"


class VaultNotFoundError(IntegrationSecretError):
    status_code = 404
    public_message = "Integration credential not found"


class VaultRevokedError(IntegrationSecretError):
    status_code = 410
    public_message = "Integration credential has been revoked"


class VaultIntegrityError(IntegrationSecretError):
    status_code = 500
    public_message = "Stored integration credential failed integrity verification"


class VaultConnectionError(IntegrationSecretError):
    status_code = 502
    public_message = "Integration provider connection failed"


@dataclass(frozen=True)
class VaultKeyring:
    active_key_id: str
    keys: Mapping[str, bytes]

    @classmethod
    def from_environment(cls, *, required: bool = False) -> "VaultKeyring":
        raw_keys = os.getenv(KEYS_ENV, "").strip()
        active_key_id = os.getenv(ACTIVE_KEY_ENV, "").strip()
        if not raw_keys or not active_key_id:
            if required:
                raise RuntimeError(
                    f"Production requires {KEYS_ENV} and {ACTIVE_KEY_ENV}"
                )
            raise VaultConfigurationError()

        try:
            encoded_keys = json.loads(raw_keys)
        except json.JSONDecodeError as exc:
            raise VaultConfigurationError(
                f"{KEYS_ENV} must be a JSON object of key IDs to base64 keys"
            ) from exc
        if not isinstance(encoded_keys, dict) or not encoded_keys:
            raise VaultConfigurationError(
                f"{KEYS_ENV} must contain at least one key"
            )

        keys: dict[str, bytes] = {}
        for key_id, encoded_key in encoded_keys.items():
            if not isinstance(key_id, str) or not KEY_ID_PATTERN.fullmatch(key_id):
                raise VaultConfigurationError("Vault key IDs must use safe identifier characters")
            if not isinstance(encoded_key, str):
                raise VaultConfigurationError("Vault keys must be base64 strings")
            try:
                padding = "=" * (-len(encoded_key) % 4)
                decoded_key = urlsafe_b64decode(encoded_key + padding)
            except Exception as exc:
                raise VaultConfigurationError("Vault keys must be valid base64") from exc
            if len(decoded_key) != 32:
                raise VaultConfigurationError("Vault keys must decode to 32 bytes")
            keys[key_id] = decoded_key

        if active_key_id not in keys:
            raise VaultConfigurationError(
                f"{ACTIVE_KEY_ENV} must name a configured key ID"
            )
        return cls(active_key_id=active_key_id, keys=MappingProxyType(keys))

    def active_key(self) -> bytes:
        return self.keys[self.active_key_id]

    def key(self, key_id: str) -> bytes:
        try:
            return self.keys[key_id]
        except KeyError as exc:
            raise VaultConfigurationError(
                "The key required by this integration credential is not configured"
            ) from exc


@lru_cache(maxsize=1)
def get_keyring() -> VaultKeyring:
    return VaultKeyring.from_environment()


def validate_vault_startup(environment: str) -> None:
    if environment.strip().lower() in {"prod", "production"}:
        try:
            VaultKeyring.from_environment(required=True)
        except VaultConfigurationError as exc:
            raise RuntimeError(exc.public_message) from exc


def create_integration_secret(
    db: Session,
    user_id: int,
    payload: IntegrationSecretCreate,
) -> IntegrationSecretRead:
    existing = db.scalar(
        select(IntegrationSecret.id).where(
            IntegrationSecret.user_id == user_id,
            IntegrationSecret.provider == payload.provider,
            IntegrationSecret.purpose == payload.purpose,
        )
    )
    if existing is not None:
        raise VaultConflictError()

    plaintext = serialize_credentials(payload.credentials)
    keyring = get_keyring()
    nonce, ciphertext = encrypt_payload(
        key=keyring.active_key(),
        plaintext=plaintext,
        aad=build_aad(user_id, payload.provider, payload.purpose),
    )
    row = IntegrationSecret(
        user_id=user_id,
        provider=payload.provider,
        purpose=payload.purpose,
        key_id=keyring.active_key_id,
        cipher_version=CIPHER_VERSION,
        version=1,
        nonce=nonce,
        ciphertext=ciphertext,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise VaultConflictError() from exc
    db.refresh(row)
    return metadata_for(row)


def list_integration_secrets(db: Session, user_id: int) -> list[IntegrationSecretRead]:
    rows = db.scalars(
        select(IntegrationSecret)
        .where(IntegrationSecret.user_id == user_id)
        .order_by(IntegrationSecret.updated_at.desc(), IntegrationSecret.id.desc())
    ).all()
    return [metadata_for(row) for row in rows]


def get_integration_secret(
    db: Session,
    user_id: int,
    secret_id: int,
) -> IntegrationSecretRead:
    return metadata_for(owned_secret(db, user_id, secret_id))


def replace_integration_secret(
    db: Session,
    user_id: int,
    secret_id: int,
    payload: IntegrationSecretReplace,
) -> IntegrationSecretRead:
    row = owned_secret(db, user_id, secret_id, for_update=True)
    ensure_active(row)
    plaintext = serialize_credentials(payload.credentials)
    keyring = get_keyring()
    nonce, ciphertext = encrypt_payload(
        key=keyring.active_key(),
        plaintext=plaintext,
        aad=build_aad(row.user_id, row.provider, row.purpose),
    )
    row.key_id = keyring.active_key_id
    row.cipher_version = CIPHER_VERSION
    row.nonce = nonce
    row.ciphertext = ciphertext
    row.version += 1
    row.updated_at = utcnow()
    db.commit()
    db.refresh(row)
    return metadata_for(row)


def connect_integration_secret(
    db: Session,
    user_id: int,
    secret_id: int,
    connector: Callable[[str, str, Mapping[str, str]], object] | None = None,
) -> IntegrationSecretConnectionRead:
    try:
        use_integration_credentials(
            db,
            user_id,
            secret_id,
            connector or (lambda _provider, _purpose, _credentials: None),
        )
        row = owned_secret(db, user_id, secret_id, for_update=True)
    except Exception as exc:
        if isinstance(exc, IntegrationSecretError):
            raise
        raise VaultConnectionError() from exc

    row.last_connected_at = utcnow()
    row.updated_at = utcnow()
    db.commit()
    db.refresh(row)
    return IntegrationSecretConnectionRead(
        **metadata_for(row).model_dump(),
        connection_status="credentials-ready",
    )


def use_integration_credentials(
    db: Session,
    user_id: int,
    secret_id: int,
    consumer: Callable[[str, str, Mapping[str, str]], T],
) -> T:
    """Decrypt for one owner-scoped callback without returning credentials."""
    row = owned_secret(db, user_id, secret_id)
    ensure_active(row)
    credentials = decrypt_credentials(row)
    try:
        return consumer(
            row.provider,
            row.purpose,
            MappingProxyType(credentials),
        )
    finally:
        credentials.clear()


def rotate_integration_secret(
    db: Session,
    user_id: int,
    secret_id: int,
) -> IntegrationSecretRead:
    row = owned_secret(db, user_id, secret_id, for_update=True)
    ensure_active(row)
    credentials = decrypt_credentials(row)
    try:
        plaintext = serialize_credentials(credentials)
        keyring = get_keyring()
        nonce, ciphertext = encrypt_payload(
            key=keyring.active_key(),
            plaintext=plaintext,
            aad=build_aad(row.user_id, row.provider, row.purpose),
        )
    finally:
        credentials.clear()

    now = utcnow()
    row.key_id = keyring.active_key_id
    row.cipher_version = CIPHER_VERSION
    row.nonce = nonce
    row.ciphertext = ciphertext
    row.version += 1
    row.rotated_at = now
    row.updated_at = now
    db.commit()
    db.refresh(row)
    return metadata_for(row)


def revoke_integration_secret(
    db: Session,
    user_id: int,
    secret_id: int,
) -> IntegrationSecretRead:
    row = owned_secret(db, user_id, secret_id, for_update=True)
    if row.revoked_at is None:
        now = utcnow()
        row.revoked_at = now
        row.updated_at = now
        row.version += 1
        # Revocation is intentionally irreversible: remove the encrypted payload
        # while retaining owner-scoped lifecycle metadata for audit purposes.
        row.nonce = b""
        row.ciphertext = b""
        db.commit()
        db.refresh(row)
    return metadata_for(row)


def owned_secret(
    db: Session,
    user_id: int,
    secret_id: int,
    *,
    for_update: bool = False,
) -> IntegrationSecret:
    statement = select(IntegrationSecret).where(
        IntegrationSecret.id == secret_id,
        IntegrationSecret.user_id == user_id,
    )
    if for_update:
        statement = statement.with_for_update()
    row = db.scalar(statement)
    if row is None:
        raise VaultNotFoundError()
    return row


def ensure_active(row: IntegrationSecret) -> None:
    if row.revoked_at is not None:
        raise VaultRevokedError()


def serialize_credentials(credentials: Mapping[str, SecretStr | str]) -> bytes:
    serialized: dict[str, str] = {}
    for name, protected_value in credentials.items():
        if not CREDENTIAL_NAME_PATTERN.fullmatch(name):
            raise VaultInputError("Credential field names must use safe identifier characters")
        value = (
            protected_value.get_secret_value()
            if isinstance(protected_value, SecretStr)
            else protected_value
        )
        if not isinstance(value, str) or not value:
            raise VaultInputError("Credential values must be non-empty strings")
        if len(value) > MAX_CREDENTIAL_VALUE_CHARS:
            raise VaultInputError("A credential value exceeds the 8192 character limit")
        serialized[name] = value

    plaintext = json.dumps(
        serialized,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    if len(plaintext) > MAX_PLAINTEXT_BYTES:
        raise VaultInputError("Credential payload exceeds the 64 KiB limit")
    return plaintext


def encrypt_payload(*, key: bytes, plaintext: bytes, aad: bytes) -> tuple[bytes, bytes]:
    nonce = token_bytes(NONCE_BYTES)
    return nonce, AESGCM(key).encrypt(nonce, plaintext, aad)


def decrypt_credentials(row: IntegrationSecret) -> dict[str, str]:
    if row.cipher_version != CIPHER_VERSION:
        raise VaultConfigurationError("Stored integration credential uses an unsupported cipher version")
    key = get_keyring().key(row.key_id)
    try:
        plaintext = AESGCM(key).decrypt(
            row.nonce,
            row.ciphertext,
            build_aad(row.user_id, row.provider, row.purpose),
        )
        decoded = json.loads(plaintext)
    except (InvalidTag, ValueError, TypeError, json.JSONDecodeError) as exc:
        raise VaultIntegrityError() from exc
    if not isinstance(decoded, dict) or any(
        not isinstance(name, str) or not isinstance(value, str)
        for name, value in decoded.items()
    ):
        raise VaultIntegrityError()
    return decoded


def build_aad(user_id: int, provider: str, purpose: str) -> bytes:
    return json.dumps(
        {
            "cipher_version": CIPHER_VERSION,
            "provider": provider,
            "purpose": purpose,
            "user_id": user_id,
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def metadata_for(row: IntegrationSecret) -> IntegrationSecretRead:
    return IntegrationSecretRead(
        id=row.id,
        provider=row.provider,
        purpose=row.purpose,
        key_id=row.key_id,
        cipher_version=row.cipher_version,
        version=row.version,
        state="revoked" if row.revoked_at is not None else "active",
        created_at=row.created_at,
        updated_at=row.updated_at,
        rotated_at=row.rotated_at,
        last_connected_at=row.last_connected_at,
        revoked_at=row.revoked_at,
    )
