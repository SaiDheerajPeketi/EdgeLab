"""Atomic owner-scoped drawing and Fibonacci preset operations."""

from copy import deepcopy
import re

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.orm import Session

from ..schemas import DrawingPresetWrite, FibPresetWrite
from . import settings


PRESET_KEYS = {"drawing": "drawing-presets.v1", "fib": "fib-presets.v1"}
PRESET_LIMITS = {"drawing": 36, "fib": 24}
# Match JavaScript trim()/\s, including BOM, without adding Python-only whitespace.
_NAME_WHITESPACE = re.compile(r"[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+")


def _identity(kind: str, preset: dict):
    name = _NAME_WHITESPACE.sub(" ", preset["name"]).strip(" ").lower()
    return (preset["tool"], name) if kind == "drawing" else name


def _validate_stored(kind: str, value):
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > PRESET_LIMITS[kind]:
        raise HTTPException(status_code=409, detail="Chart presets need recovery before changing them.")
    model = DrawingPresetWrite if kind == "drawing" else FibPresetWrite
    try:
        for preset in value:
            model.model_validate(preset)
        if len({preset["id"] for preset in value}) != len(value) or len({_identity(kind, preset) for preset in value}) != len(value):
            raise ValueError("Duplicate preset identifiers or names.")
    except (ValidationError, ValueError):
        raise HTTPException(status_code=409, detail="Chart presets need recovery before changing them.") from None
    return deepcopy(value)


def operate_chart_preset(db: Session, owner: int, kind: str, action: str, preset: dict | None, preset_id: str | None):
    key = PRESET_KEYS[kind]
    for _ in range(3):
        rows = settings._rows(db, owner, [key])
        original = _validate_stored(kind, rows[key].value if key in rows else None)
        if action == "save":
            # Retain the exact validated payload, including its timestamp spelling.
            target = deepcopy(preset)
            remaining = [item for item in original if item["id"] != target["id"] and _identity(kind, item) != _identity(kind, target)]
            if len(remaining) >= PRESET_LIMITS[kind]:
                raise HTTPException(status_code=409, detail="The chart preset limit is reached. Delete a preset before saving another.")
            value = [target, *remaining]
        else:
            value = [item for item in original if item["id"] != preset_id]
            if len(value) == len(original) and key in rows and rows[key].value is not None:
                return settings._read(key, rows.get(key))
        saved = settings._commit_values(db, owner, rows, {key: value})
        if saved is not None:
            return saved[key]
    raise HTTPException(status_code=409, detail="Chart presets changed while saving. Retry your draft.")
