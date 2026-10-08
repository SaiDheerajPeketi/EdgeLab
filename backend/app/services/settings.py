from copy import deepcopy

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import AppStorageItem, utcnow
from ..schemas import AppStorageRead, ChartSettingsRead


PRESETS_KEY = "chart-settings-presets.v1"
ACTIVE_KEY = "active-chart-settings-preset.v1"
PREFERENCES_KEY = "settings-center.v1"
PRESET_NAME = "Settings default"


def _rows(db: Session, owner: int, keys: list[str]):
    return {row.key: row for row in db.scalars(select(AppStorageItem).where(
        AppStorageItem.user_id == owner, AppStorageItem.namespace == "edgelab", AppStorageItem.key.in_(keys)
    ).execution_options(populate_existing=True))}


def _read(key: str, row: AppStorageItem | None):
    return AppStorageRead(namespace="edgelab", key=key, value=row.value if row else None, updated_at=row.updated_at if row else None)


def read_chart_settings(db: Session, owner: int):
    rows = _rows(db, owner, [PRESETS_KEY, ACTIVE_KEY])
    return ChartSettingsRead(presets=_read(PRESETS_KEY, rows.get(PRESETS_KEY)), active=_read(ACTIVE_KEY, rows.get(ACTIVE_KEY)))


def _commit_values(db: Session, owner: int, rows: dict, values: dict):
    timestamp = utcnow()
    try:
        with db.no_autoflush:
            for key, value in values.items():
                row = rows.get(key)
                if row is None:
                    db.add(AppStorageItem(user_id=owner, namespace="edgelab", key=key, value=value, updated_at=timestamp))
                else:
                    result = db.execute(update(AppStorageItem).where(
                        AppStorageItem.id == row.id, AppStorageItem.user_id == owner, AppStorageItem.updated_at == row.updated_at,
                    ).values(value=value, updated_at=timestamp).execution_options(synchronize_session=False))
                    if result.rowcount != 1:
                        db.rollback()
                        return None
        db.commit()
    except IntegrityError:
        db.rollback()
        return None
    return {key: AppStorageRead(namespace="edgelab", key=key, value=value, updated_at=timestamp) for key, value in values.items()}


def _name(value: str):
    return " ".join(value.split())


def patch_chart_settings(db: Session, owner: int, changes: dict):
    for _ in range(3):
        rows = _rows(db, owner, [PRESETS_KEY, ACTIVE_KEY])
        original = rows[PRESETS_KEY].value if PRESETS_KEY in rows else None
        active = rows[ACTIVE_KEY].value if ACTIVE_KEY in rows else None
        if original is not None and (not isinstance(original, list) or any(
            not isinstance(entry, dict) or not isinstance(entry.get("name"), str) or not _name(entry["name"])
            or not isinstance(entry.get("settings"), dict) for entry in original
        )):
            raise HTTPException(status_code=409, detail="Chart presets need recovery before changing defaults.")
        if active is not None and not isinstance(active, str):
            raise HTTPException(status_code=409, detail="The active chart preset needs recovery before changing defaults.")
        presets = deepcopy(original) if original is not None else []
        if len({_name(entry["name"]) for entry in presets}) != len(presets):
            raise HTTPException(status_code=409, detail="Duplicate chart preset names need recovery before changing defaults.")
        target = next((entry for entry in presets if _name(entry["name"]) == PRESET_NAME), None)
        if target is None:
            source = next((entry for entry in presets if _name(entry["name"]) == _name(active or "")), presets[0] if presets else None)
            target = {"name": PRESET_NAME, "settings": deepcopy(source["settings"]) if source else {}}
            presets.insert(0, target)
        target["settings"].update(changes)
        for candle, body in [("candleUpColor", "bodyUpColor"), ("candleDownColor", "bodyDownColor")]:
            if candle in changes:
                target["settings"][body] = changes[candle]
        target["updatedAt"] = utcnow().isoformat()
        saved = _commit_values(db, owner, rows, {PRESETS_KEY: presets, ACTIVE_KEY: PRESET_NAME})
        if saved is not None:
            return ChartSettingsRead(presets=saved[PRESETS_KEY], active=saved[ACTIVE_KEY])
    raise HTTPException(status_code=409, detail="Chart settings changed while saving. Retry your draft.")


def operate_chart_template(db: Session, owner: int, action: str, name: str, settings: dict | None = None):
    for _ in range(3):
        rows = _rows(db, owner, [PRESETS_KEY, ACTIVE_KEY])
        original = rows[PRESETS_KEY].value if PRESETS_KEY in rows else None
        active = rows[ACTIVE_KEY].value if ACTIVE_KEY in rows else None
        if original is not None and (not isinstance(original, list) or any(
            not isinstance(entry, dict) or not isinstance(entry.get("name"), str) or not _name(entry["name"])
            or not isinstance(entry.get("settings"), dict) for entry in original
        )):
            raise HTTPException(status_code=409, detail="Chart templates need recovery before changing them.")
        if active is not None and not isinstance(active, str):
            raise HTTPException(status_code=409, detail="The active chart template needs recovery before changing it.")
        presets = deepcopy(original) if original is not None else []
        if len({_name(entry["name"]) for entry in presets}) != len(presets):
            raise HTTPException(status_code=409, detail="Duplicate chart template names need recovery before changing them.")
        target = next((entry for entry in presets if _name(entry["name"]) == name), None)
        if action == "save":
            saved_template = deepcopy(target) if target is not None else {"settings": {}}
            saved_template.update(name=name, updatedAt=utcnow().isoformat())
            saved_template["settings"].update(deepcopy(settings))
            presets = [saved_template, *(entry for entry in presets if entry is not target)]
            active = name
        elif action == "activate":
            if target is None:
                raise HTTPException(status_code=404, detail="The chart template no longer exists.")
            active = name
        else:
            if target is None:
                return ChartSettingsRead(presets=_read(PRESETS_KEY, rows.get(PRESETS_KEY)), active=_read(ACTIVE_KEY, rows.get(ACTIVE_KEY)))
            presets = [entry for entry in presets if entry is not target]
            if _name(active or "") == name:
                active = _name(presets[0]["name"]) if presets else None
        saved = _commit_values(db, owner, rows, {PRESETS_KEY: presets, ACTIVE_KEY: active})
        if saved is not None:
            return ChartSettingsRead(presets=saved[PRESETS_KEY], active=saved[ACTIVE_KEY])
    raise HTTPException(status_code=409, detail="Chart templates changed while saving. Retry your draft.")


def patch_settings_preferences(db: Session, owner: int, changes: dict):
    for _ in range(3):
        rows = _rows(db, owner, [PREFERENCES_KEY])
        original = rows[PREFERENCES_KEY].value if PREFERENCES_KEY in rows else None
        if original is not None and not isinstance(original, dict):
            raise HTTPException(status_code=409, detail="Settings preferences need recovery before changing them.")
        value = {**(original if original is not None else {"density": "comfortable", "includeDiagnosticsByDefault": True}), **changes}
        saved = _commit_values(db, owner, rows, {PREFERENCES_KEY: value})
        if saved is not None:
            return saved[PREFERENCES_KEY]
    raise HTTPException(status_code=409, detail="Preferences changed while saving. Retry your draft.")
