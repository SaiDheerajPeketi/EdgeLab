import csv
import io
import json
import math
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import BacktestSession, Position, Trade
from app.schemas import (
    BacktestSessionRead,
    BacktestTradeImport,
    BacktestTradeImportResult,
)
from app.services.backtester import _commission_value, _normalize_commission_mode, to_trade_read


FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "entry_time": (
        "entrytime",
        "entrydate",
        "entrydatetime",
        "opentime",
        "opendate",
        "opendatetime",
        "openedat",
        "entrytimestamp",
        "entry",
    ),
    "exit_time": (
        "exittime",
        "exitdate",
        "exitdatetime",
        "closetime",
        "closedate",
        "closedatetime",
        "closedat",
        "exittimestamp",
        "exit",
    ),
    "side": ("side", "direction", "type", "position", "tradetype", "action", "buysell"),
    "entry_price": (
        "entryprice",
        "entry",
        "openprice",
        "pricein",
        "entryfill",
        "avgentry",
        "averageentry",
    ),
    "exit_price": (
        "exitprice",
        "exit",
        "closeprice",
        "priceout",
        "exitfill",
        "avgexit",
        "averageexit",
    ),
    "quantity": ("quantity", "qty", "contracts", "shares", "lots", "volume", "size", "filledqty"),
    "realized_pnl": (
        "pnl",
        "pl",
        "profit",
        "profitloss",
        "realizedpnl",
        "netpnl",
        "netprofit",
        "grosspnl",
        "result",
    ),
    "commission_amount": (
        "commission",
        "commissions",
        "brokercommission",
        "brokercommissions",
    ),
    "fee_amount": (
        "fee",
        "fees",
        "brokerfee",
        "brokerfees",
        "transactionfee",
        "transactionfees",
        "cost",
        "costs",
    ),
    "symbol": ("symbol", "ticker", "instrument", "market", "contract", "asset"),
    "strategy_name": ("strategy", "strategyname", "setup", "playbook", "system"),
    "stop_loss": ("stoploss", "stop", "sl", "stopprice"),
    "take_profit": ("takeprofit", "target", "tp", "targetprice"),
    "r_multiple": ("r", "rmultiple", "rmultiple", "rvalue", "rr", "riskreward"),
    "notes": ("notes", "note", "comment", "comments", "review"),
    "tags": ("tags", "tag", "mistakes", "mistaketags", "labels"),
}

DATE_FORMATS = (
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%d",
    "%m/%d/%Y %H:%M:%S",
    "%m/%d/%Y %H:%M",
    "%m/%d/%Y %I:%M:%S %p",
    "%m/%d/%Y %I:%M %p",
    "%m/%d/%Y",
    "%d/%m/%Y %H:%M:%S",
    "%d/%m/%Y %H:%M",
    "%d/%m/%Y",
    "%Y.%m.%d %H:%M:%S",
    "%Y.%m.%d %H:%M",
)


def import_trade_csv(
    db: Session,
    user_id: int,
    payload: BacktestTradeImport,
    fallback_csv_path: Path,
    fallback_rows: int,
) -> BacktestTradeImportResult:
    rows, headers = _read_csv(payload.csv_text)
    if not rows:
        raise HTTPException(status_code=400, detail="CSV did not contain any data rows")

    mapping = {
        key: value
        for key, value in (payload.column_mapping or {}).items()
        if isinstance(key, str) and isinstance(value, str) and value.strip()
    }
    parsed_rows: list[dict[str, Any]] = []
    errors: list[str] = []
    symbols: list[str] = []

    for index, row in enumerate(rows, start=2):
        try:
            parsed = _parse_trade_row(
                row,
                headers,
                mapping,
                index,
                payload.strategy_name,
                payload.default_commission_mode,
                payload.default_commission_value,
                payload.default_fee_mode,
                payload.default_fee_value,
            )
        except ValueError as exc:
            if len(errors) < 25:
                errors.append(str(exc))
            continue
        parsed_rows.append(parsed)
        if parsed["symbol"]:
            symbols.append(parsed["symbol"])

    if not parsed_rows:
        detail = errors[0] if errors else "No importable trades were found"
        raise HTTPException(status_code=400, detail=detail)

    symbol = _clean_text(payload.symbol) or _most_common(symbols) or "IMPORTED"
    source_name = _clean_text(payload.source_name)
    session_name = _clean_text(payload.account_name) or f"{source_name or symbol} Import"
    instrument = _clean_text(payload.instrument) or source_name or symbol
    strategy_name = _clean_text(payload.strategy_name)
    start_at = min(row["entry_time"] for row in parsed_rows)
    end_at = max(row["exit_time"] for row in parsed_rows)
    realized_pnl = sum(float(row["realized_pnl"]) for row in parsed_rows)
    current_offset = max(0, min(len(parsed_rows) - 1, max(fallback_rows - 1, 0)))

    session = BacktestSession(
        user_id=user_id,
        name=session_name,
        symbol=symbol,
        instrument=instrument,
        timeframe=_clean_text(payload.timeframe) or "Imported",
        csv_path=str(fallback_csv_path),
        currency=_clean_text(payload.currency),
        timezone="UTC",
        pnl_multiplier=1.0,
        strategy_name=strategy_name,
        start_at=start_at,
        end_at=end_at,
        start_offset=0,
        end_offset=current_offset,
        current_offset=current_offset,
        initial_balance=payload.initial_balance,
        realized_pnl=realized_pnl,
        status="COMPLETE",
        default_commission_mode=_normalize_commission_mode(payload.default_commission_mode),
        default_commission_value=_commission_value(
            payload.default_commission_mode,
            payload.default_commission_value,
        ),
        default_fee_mode=_normalize_commission_mode(payload.default_fee_mode),
        default_fee_value=_commission_value(payload.default_fee_mode, payload.default_fee_value),
    )
    db.add(session)
    db.flush()
    db.add(Position(user_id=user_id, session_id=session.id))

    trades: list[Trade] = []
    for offset, row in enumerate(parsed_rows):
        trade = Trade(
            user_id=user_id,
            session_id=session.id,
            status="CLOSED",
            side=row["side"],
            entry_time=row["entry_time"],
            entry_offset=offset,
            entry_price=row["entry_price"],
            quantity=row["quantity"],
            remaining_quantity=0.0,
            stop_loss=row["stop_loss"],
            take_profit=row["take_profit"],
            exit_time=row["exit_time"],
            exit_offset=offset,
            exit_price=row["exit_price"],
            gross_pnl=row["gross_pnl"],
            realized_pnl=row["realized_pnl"],
            r_multiple=row["r_multiple"],
            commission_mode=row["commission_mode"],
            commission_value=row["commission_value"],
            commission_amount=row["commission_amount"],
            fee_mode=row["fee_mode"],
            fee_value=row["fee_value"],
            fee_amount=row["fee_amount"],
            strategy_name=row["strategy_name"],
            notes=row["notes"],
            mistake_tags=json.dumps(row["tags"]),
        )
        db.add(trade)
        trades.append(trade)

    db.commit()
    db.refresh(session)
    for trade in trades:
        db.refresh(trade)

    return BacktestTradeImportResult(
        session=BacktestSessionRead.model_validate(session),
        trades=[to_trade_read(trade) for trade in trades],
        imported_rows=len(trades),
        skipped_rows=len(rows) - len(trades),
        errors=errors,
        detected_columns=headers,
    )


def _read_csv(csv_text: str) -> tuple[list[dict[str, str]], list[str]]:
    text = csv_text.lstrip("\ufeff").strip()
    if not text:
        return [], []
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    headers = [header.strip() for header in (reader.fieldnames or []) if header and header.strip()]
    if not headers:
        raise HTTPException(status_code=400, detail="CSV is missing a header row")
    rows = []
    for row in reader:
        rows.append({(key or "").strip(): (value or "").strip() for key, value in row.items()})
    return rows, headers


def _parse_trade_row(
    row: dict[str, str],
    headers: list[str],
    mapping: dict[str, str],
    row_number: int,
    default_strategy: str | None,
    default_commission_mode: str | None,
    default_commission_value: float | None,
    default_fee_mode: str | None,
    default_fee_value: float | None,
) -> dict[str, Any]:
    entry_time = _parse_datetime(_field(row, headers, mapping, "entry_time"), "entry time", row_number)
    exit_value = _field(row, headers, mapping, "exit_time")
    exit_time = _parse_datetime(exit_value, "exit time", row_number) if exit_value else entry_time
    side = _parse_side(_field(row, headers, mapping, "side"), row_number)
    entry_price = _parse_float(_field(row, headers, mapping, "entry_price"), "entry price", row_number)
    exit_price = _parse_float(_field(row, headers, mapping, "exit_price"), "exit price", row_number)
    quantity = _parse_float(_field(row, headers, mapping, "quantity"), "quantity", row_number)
    pnl_value = _field(row, headers, mapping, "realized_pnl")
    commission_mode, commission_value, commission_amount = _row_cost_config(
        row,
        headers,
        mapping,
        "commission_amount",
        default_commission_mode,
        default_commission_value,
        entry_price,
        exit_price,
        quantity,
    )
    fee_mode, fee_value, fee_amount = _row_cost_config(
        row,
        headers,
        mapping,
        "fee_amount",
        default_fee_mode,
        default_fee_value,
        entry_price,
        exit_price,
        quantity,
    )
    total_costs = commission_amount + fee_amount
    price_derived_pnl = (exit_price - entry_price) * quantity * (1 if side == "LONG" else -1)
    realized_pnl = (
        _parse_float(pnl_value, "realized P&L", row_number)
        if pnl_value
        else price_derived_pnl - total_costs
    )
    gross_pnl = realized_pnl + total_costs if pnl_value else price_derived_pnl
    return {
        "entry_time": entry_time,
        "exit_time": exit_time,
        "side": side,
        "entry_price": entry_price,
        "exit_price": exit_price,
        "quantity": quantity,
        "gross_pnl": gross_pnl,
        "realized_pnl": realized_pnl,
        "commission_mode": commission_mode,
        "commission_value": commission_value,
        "commission_amount": commission_amount,
        "fee_mode": fee_mode,
        "fee_value": fee_value,
        "fee_amount": fee_amount,
        "symbol": _clean_text(_field(row, headers, mapping, "symbol")),
        "strategy_name": _clean_text(_field(row, headers, mapping, "strategy_name"))
        or _clean_text(default_strategy),
        "stop_loss": _parse_optional_float(_field(row, headers, mapping, "stop_loss")),
        "take_profit": _parse_optional_float(_field(row, headers, mapping, "take_profit")),
        "r_multiple": _parse_optional_float(_field(row, headers, mapping, "r_multiple")),
        "notes": _clean_text(_field(row, headers, mapping, "notes")),
        "tags": _parse_tags(_field(row, headers, mapping, "tags")),
    }


def _field(row: dict[str, str], headers: list[str], mapping: dict[str, str], field: str) -> str:
    mapped = mapping.get(field)
    if mapped and mapped in row and row[mapped].strip():
        return row[mapped].strip()

    header_by_key = {_normalize_header(header): header for header in headers}
    for alias in FIELD_ALIASES.get(field, ()):
        header = header_by_key.get(alias)
        if header and row.get(header, "").strip():
            return row[header].strip()
    return ""


def _row_cost_config(
    row: dict[str, str],
    headers: list[str],
    mapping: dict[str, str],
    field: str,
    default_mode: str | None,
    default_value: float | None,
    entry_price: float,
    exit_price: float,
    quantity: float,
) -> tuple[str, float, float]:
    explicit_amount = _parse_optional_float(_field(row, headers, mapping, field))
    if explicit_amount is not None:
        amount = max(explicit_amount, 0.0)
        return ("FIXED" if amount > 0 else "NONE"), amount, amount

    mode = _normalize_commission_mode(default_mode)
    value = _commission_value(mode, default_value)
    if mode == "NONE" or value <= 0:
        return "NONE", 0.0, 0.0
    if mode == "FIXED":
        return mode, value, value
    amount = (abs(entry_price * quantity) + abs(exit_price * quantity)) * (value / 100)
    return mode, value, amount


def _parse_datetime(value: str, label: str, row_number: int) -> datetime:
    clean = _clean_text(value)
    if not clean:
        raise ValueError(f"Row {row_number}: missing {label}")
    iso = clean.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(iso)
        return parsed.replace(tzinfo=None) if parsed.tzinfo else parsed
    except ValueError:
        pass
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(clean, fmt)
        except ValueError:
            continue
    timestamp = pd.to_datetime(clean, errors="coerce")
    if pd.isna(timestamp):
        raise ValueError(f"Row {row_number}: invalid {label} '{value}'")
    parsed = timestamp.to_pydatetime()
    return parsed.replace(tzinfo=None) if parsed.tzinfo else parsed


def _parse_side(value: str, row_number: int) -> str:
    clean = _normalize_header(value)
    if clean in {"long", "buy", "bought", "l", "bto"} or "long" in clean or "buy" in clean:
        return "LONG"
    if clean in {"short", "sell", "sold", "s", "sto"} or "short" in clean or "sell" in clean:
        return "SHORT"
    raise ValueError(f"Row {row_number}: side must be LONG/SHORT or BUY/SELL")


def _parse_float(value: str, label: str, row_number: int) -> float:
    parsed = _parse_optional_float(value)
    if parsed is None:
        raise ValueError(f"Row {row_number}: missing or invalid {label}")
    return parsed


def _parse_optional_float(value: str) -> float | None:
    clean = _clean_text(value)
    if not clean:
        return None
    negative = clean.startswith("(") and clean.endswith(")")
    clean = clean.replace(",", "")
    clean = re.sub(r"[^0-9eE+\-.]", "", clean)
    if clean in {"", "-", "+", "."}:
        return None
    try:
        value_float = float(clean)
    except ValueError:
        return None
    if not math.isfinite(value_float):
        return None
    return -abs(value_float) if negative else value_float


def _parse_tags(value: str) -> list[str]:
    tags: list[str] = []
    for part in re.split(r"[;,|]", value or ""):
        tag = part.strip()
        if tag and tag not in tags:
            tags.append(tag[:80])
    return tags


def _clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    clean = str(value).strip()
    return clean or None


def _normalize_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.strip().lower())


def _most_common(values: list[str]) -> str | None:
    if not values:
        return None
    counts = {value: values.count(value) for value in set(values)}
    return max(counts, key=counts.get)
