"""Durable receipts: cancellation must prevent a delayed request from starting."""

import json
import re
from uuid import UUID

from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool
from starlette.responses import StreamingResponse

from app.auth import authenticate_token, bearer_token
from app.db import SessionLocal
from app.models import AppDataOperation, utcnow
from app.schemas import AppDataImportResult, AppDataOperationRead


OPERATION_HEADER = "X-EdgeLab-Operation-Id"
WRITING_ROOTS = re.compile(r"^/(?:app-storage|settings|datasets|journal|backtests|playbooks|trades|broker-connections|broker-sync-jobs|quant/backtests)(?:/|$)")
WRITING_READS = re.compile(r"^/(?:datasets(?:/settings)?|bootstrap(?:-shell)?|backtests(?:/.*)?|market-data/(?:meta|bars))$")


def operation_id(value: str) -> str:
    try:
        parsed = UUID(value)
        if parsed.version != 4 or str(parsed) != value.lower():
            raise ValueError
        return str(parsed)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=400, detail="A canonical version 4 operation ID is required") from None


def canonical_path(path: str) -> str:
    # ASGI scope paths are already decoded. Do not decode percent escapes again.
    if not isinstance(path, str) or not path.startswith("/") or len(path) > 512 or re.search(r"[\x00-\x20\x7f\\?#]", path):
        raise HTTPException(status_code=400, detail="Invalid operation path")
    if any(part in {".", ".."} for part in path.split("/")):
        raise HTTPException(status_code=400, detail="Invalid operation path")
    return re.sub(r"/+", "/", path).rstrip("/")


def writing_request(method: str, path: str) -> bool:
    if path == "/app-data/import":
        return method == "POST"
    if method == "GET":
        return bool(WRITING_READS.fullmatch(path))
    return method in {"POST", "PUT", "PATCH", "DELETE"} and bool(WRITING_ROOTS.match(path))


def _read(db, user_id: int, key: str) -> AppDataOperationRead | None:
    row = db.scalar(select(AppDataOperation).where(AppDataOperation.user_id == user_id, AppDataOperation.operation_id == key).execution_options(populate_existing=True))
    return AppDataOperationRead.model_validate(row) if row else None


def reserve(user_id: int, key: str, method: str, path: str) -> AppDataOperationRead:
    key = operation_id(key)
    path = canonical_path(path)
    if not writing_request(method, path):
        raise HTTPException(status_code=400, detail="This request does not support account operation receipts")
    with SessionLocal() as db:
        try:
            db.add(AppDataOperation(user_id=user_id, operation_id=key, method=method, path=path, status="reserved"))
            db.commit()
        except IntegrityError:
            db.rollback()
        row = _read(db, user_id, key)
        if row is None:
            raise HTTPException(status_code=409, detail="Could not reserve this account operation")
        # Missing-ID recovery creates a permanent tombstone with no metadata.
        if row.method is not None and (row.method != method or row.path != path):
            raise HTTPException(status_code=409, detail="Operation ID is already bound to another request")
        return row


def recover(user_id: int, key: str) -> AppDataOperationRead:
    key = operation_id(key)
    with SessionLocal() as db:
        try:
            db.add(AppDataOperation(user_id=user_id, operation_id=key, status="canceled", completed_at=utcnow()))
            db.commit()
        except IntegrityError:
            db.rollback()
            # Claim and cancel compete in the database; exactly one may win.
            db.execute(update(AppDataOperation).where(
                AppDataOperation.user_id == user_id, AppDataOperation.operation_id == key,
                AppDataOperation.status == "reserved",
            ).values(status="canceled", completed_at=utcnow()))
            db.commit()
        row = _read(db, user_id, key)
        if row is None:
            raise HTTPException(status_code=409, detail="Could not verify this account operation")
        return row


def claim(user_id: int, key: str, method: str, path: str) -> None:
    key = operation_id(key)
    path = canonical_path(path)
    if not writing_request(method, path):
        raise HTTPException(status_code=400, detail="This request does not support account operation receipts")
    with SessionLocal() as db:
        claimed = db.execute(update(AppDataOperation).where(
            AppDataOperation.user_id == user_id, AppDataOperation.operation_id == key,
            AppDataOperation.method == method, AppDataOperation.path == path,
            AppDataOperation.status == "reserved",
        ).values(status="running"))
        db.commit()
        if claimed.rowcount != 1:
            raise HTTPException(status_code=409, detail="Operation is unreserved, already started, or canceled. Verify its receipt before continuing.")


def complete(user_id: int, key: str, status: int, result: dict | None = None) -> None:
    with SessionLocal() as db:
        db.execute(update(AppDataOperation).where(
            AppDataOperation.user_id == user_id, AppDataOperation.operation_id == key,
            AppDataOperation.status == "running",
        ).values(status="completed", http_status=status, result=result, completed_at=utcnow()))
        db.commit()


def _authenticate_and_claim(authorization: str | None, key: str, method: str, path: str) -> int:
    token = bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Valid account session required")
    with SessionLocal() as db:
        user = authenticate_token(db, token)
        if not user.approved:
            raise HTTPException(status_code=403, detail="Approved account required")
        user_id = user.id
    claim(user_id, key, method, path)
    return user_id


class AppDataOperationRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request: Request):
            key = request.headers.get(OPERATION_HEADER)
            if key is None:
                return await original(request)
            key = operation_id(key)
            path = canonical_path(request.scope["path"].removeprefix("/api"))
            user_id = await run_in_threadpool(_authenticate_and_claim, request.headers.get("Authorization"), key, request.method, path)
            try:
                response = await original(request)
            except Exception as error:
                # Cancellation/termination is a BaseException: the sync worker
                # may still be writing, so its running receipt must survive.
                status = 422 if isinstance(error, RequestValidationError) else getattr(error, "status_code", 500)
                await run_in_threadpool(complete, user_id, key, status)
                raise

            result = None
            if path == "/app-data/import" and response.status_code == 200 and hasattr(response, "body"):
                try:
                    result = AppDataImportResult.model_validate(json.loads(response.body)).model_dump(mode="json")
                except (ValueError, TypeError):
                    pass  # Completion is known; a valid import acknowledgment is not.

            stream_finished = not isinstance(response, StreamingResponse)
            if not stream_finished:
                iterator = response.body_iterator

                async def tracked_stream():
                    nonlocal stream_finished
                    async for chunk in iterator:
                        yield chunk
                    stream_finished = True

                response.body_iterator = tracked_stream()

            if isinstance(response, StreamingResponse) or response.background is not None:
                background = response.background

                async def finish_response():
                    try:
                        if background is not None:
                            await background()
                    except Exception:
                        if stream_finished:
                            await run_in_threadpool(complete, user_id, key, 500)
                        raise
                    # Older ASGI streaming responses can run background tasks
                    # after disconnect cancels the iterator. Only normal
                    # exhaustion proves that no streaming writer remains.
                    if stream_finished:
                        await run_in_threadpool(complete, user_id, key, response.status_code, result)

                response.background = BackgroundTask(finish_response)
            else:
                await run_in_threadpool(complete, user_id, key, response.status_code, result)
            return response

        return handler
