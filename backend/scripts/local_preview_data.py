"""Disposable synthetic local preview. Never opens or updates an existing DB.

Run with PYTHONPATH=backend and --directory pointing to a nonexistent directory.
The emitted preview.json contains paths and existing local-development settings;
it grants no subscription, places no orders, and changes no security policy.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


def candles(start: datetime, count: int, price: float) -> list[dict]:
    rows = []
    random_source = random.Random(int(price * 1_000_000))
    volatility = .00055 if price > 20000 else .00005 if price < 10 else .00015
    drift = 0.0
    previous = price
    for index in range(count):
        if index % 240 == 0:
            drift = random_source.uniform(-volatility * .16, volatility * .16)
        change = random_source.gauss(drift, volatility)
        if random_source.random() < .003:
            change += random_source.choice((-1, 1)) * volatility * random_source.uniform(3, 7)
        close = previous * (1 + change)
        upper_wick = previous * abs(random_source.gauss(0, volatility * .55))
        lower_wick = previous * abs(random_source.gauss(0, volatility * .55))
        rows.append({"Timestamp": start + timedelta(minutes=index), "Open": round(previous, 8),
                     "High": round(max(previous, close) + upper_wick, 8),
                     "Low": round(min(previous, close) - lower_wick, 8), "Close": round(close, 8),
                     "Volume": round(random_source.lognormvariate(5, .5) * (1 + abs(change) / volatility), 4)})
        previous = close
    return rows


def aggregate(rows: list[dict], minutes: int) -> list[dict]:
    return [{"Timestamp": group[0]["Timestamp"], "Open": group[0]["Open"],
             "High": max(row["High"] for row in group), "Low": min(row["Low"] for row in group),
             "Close": group[-1]["Close"], "Volume": round(sum(row["Volume"] for row in group), 4)}
            for index in range(0, len(rows) - minutes + 1, minutes)
            if len(group := rows[index:index + minutes]) == minutes]


def seed_preview_order_flow(db: Session, user_id: int, now: datetime) -> dict:
    """Add offline synthetic trade/footprint records to an explicitly owned preview.

    The caller must verify the disposable preview manifest before opening an
    existing database. This helper never creates a default application session.
    """
    from sqlalchemy import select
    from app.models import BetaUser, MarketInstrument
    from app.schemas import MarketIdentifierCreate, MarketInstrumentCreate
    from app.services.market_infrastructure import (
        TradeTickRecord, build_footprints, create_instrument, ingest_trade_ticks,
    )

    user = db.get(BetaUser, user_id)
    if user is None or user.email != "developer@localhost.edgelab" or user.name != "Demo data":
        raise ValueError("Order-flow preview requires the disposable Demo data user")
    if now.tzinfo is None:
        raise ValueError("Order-flow preview requires an explicit timezone-aware clock")
    if db.scalar(select(MarketInstrument.id).where(
            MarketInstrument.user_id == user_id, MarketInstrument.canonical_symbol == "BTCUSDT")):
        raise ValueError("Order-flow preview refuses to replace an existing BTCUSDT instrument")
    end = now.astimezone(timezone.utc).replace(second=0, microsecond=0)
    start = end.replace(minute=0) - timedelta(hours=2)
    instrument = create_instrument(db, user_id, MarketInstrumentCreate(
        canonical_symbol="BTCUSDT", display_name="Demo BTCUSDT · synthetic offline trades",
        asset_class="CRYPTO", instrument_type="SPOT", base_asset="BTC", quote_asset="USDT",
        currency="USD", tick_size=Decimal("0.5"), tick_value=Decimal("0.5"),
        identifiers=[MarketIdentifierCreate(provider="offline-fixture", provider_symbol="BTCUSDT",
            metadata={"demo": True, "synthetic": True})],
        metadata={"demo": True, "synthetic": True, "description": "Not live market data"}))
    random_source = random.Random(187)
    level = 0
    records = []
    for index in range(int((end - start).total_seconds() // 10)):
        level = max(-8, min(8, level + random_source.choice((-1, 0, 1))))
        records.append(TradeTickRecord(
            external_trade_id=f"synthetic-preview:{index}", sequence=index,
            exchange_timestamp=start + timedelta(seconds=index * 10),
            price=Decimal("65000") + Decimal(level) / 2,
            size=Decimal(random_source.randint(1, 24)) / 100,
            aggressor_side="BID" if index % 3 == 0 else "ASK"))
    inserted, duplicates, gaps = ingest_trade_ticks(db, user_id, instrument.id, "offline-fixture", records)
    if duplicates or gaps:
        raise ValueError("Synthetic preview trade sequence must be new and continuous")
    footprints = {}
    for interval in (60, 300, 900, 3600):
        completed_end = datetime.fromtimestamp(int(end.timestamp()) // interval * interval, timezone.utc)
        rows = build_footprints(db, user_id, instrument.id, provider="offline-fixture",
            from_at=start, to_at=completed_end, interval_seconds=interval)
        footprints[str(interval)] = len(rows)
    return {"instrument_id": instrument.id, "provider": "offline-fixture", "synthetic": True,
            "trade_ticks": inserted, "footprints": footprints}


def create_preview(directory: Path, *, as_of: datetime | None = None) -> dict:
    directory = directory.expanduser().absolute()
    # Exclusive mkdir is the authority check: no existing DB/dataset can be used,
    # including an empty directory, symlink, or a concurrent second invocation.
    directory.mkdir(parents=True, exist_ok=False)
    database = directory / "preview.db"
    dataset_root = directory / "datasets"
    now = (as_of or datetime.now(timezone.utc)).astimezone(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = now.replace(second=0, microsecond=0)
    start = today - timedelta(days=7)
    count = int((end - start).total_seconds() // 60)
    counts = {}
    replay_rows = []
    for symbol, price in (("BTCUSDT", 65000.0), ("EURUSD", 1.08), ("ES", 5700.0)):
        folder = dataset_root / symbol
        folder.mkdir(parents=True)
        minute_rows = candles(start, count, price)
        if symbol == "ES":
            replay_rows = minute_rows
        for timeframe, minutes in (("M1", 1), ("M5", 5), ("M15", 15), ("H1", 60)):
            rows = minute_rows if minutes == 1 else aggregate(minute_rows, minutes)
            path = folder / f"{symbol}_{timeframe}.csv"
            with path.open("x", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=["Timestamp", "Open", "High", "Low", "Close", "Volume"])
                writer.writeheader()
                # CSV metadata reads use the existing UTC DATE_FORMAT parser;
                # pandas candle reads also accept this format.
                writer.writerows({**row, "Timestamp": row["Timestamp"].strftime("%Y-%m-%d %H:%M:%S")} for row in rows)
            counts[f"{symbol}:{timeframe}"] = len(rows)

    # Models are imported only after the fresh-directory guard. Their default
    # engine is never connected; all writes use this explicit isolated engine.
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from app.db import Base
    from app.models import (AppStorageItem, BacktestSession, BetaUser, DatasetAsset, DatasetTimeframe,
                            JournalDailyNote, Playbook, Position, Trade)
    from app.schemas import CanonicalTradeCreate, JournalAccountCreate, JournalTagCreate
    from app.services.journal import create_account, create_tag, create_trade
    from app.services.session_summaries import refresh_session_summary

    database_url = f"sqlite:///{database}"
    engine = create_engine(database_url)
    try:
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            user = BetaUser(email="developer@localhost.edgelab", name="Demo data", provider="email",
                            status="APPROVED", beta_position=1)
            db.add(user)
            db.flush()
            accounts = [create_account(db, user.id, JournalAccountCreate(
                name=name, provider="Synthetic preview", currency="USD", timezone="UTC",
                initial_balance=balance, color=color, notes="Demo data — no real account or orders."))
                for name, balance, color in (("Demo · Swing account", 50000, "#22d3ee"),
                                             ("Demo · Intraday account", 25000, "#a78bfa"))]
            tags = [create_tag(db, user.id, JournalTagCreate(name=name, category=category, color=color))
                    for name, category, color in (("Plan followed", "POSITIVE", "#22c55e"),
                                                  ("Late entry", "MISTAKE", "#fb7185"),
                                                  ("Opening range", "SETUP", "#38bdf8"),
                                                  ("Demo data", "PROCESS", "#a78bfa"))]
            for index in range(80):
                side = "LONG" if index % 3 else "SHORT"
                entry = start + timedelta(minutes=90 + index * 120)
                is_open = index >= 76
                if is_open:
                    entry = min(end - timedelta(minutes=1), max(today, now - timedelta(minutes=(80 - index) * 5)))
                entry = entry.replace(second=0, microsecond=0)
                exit_time = entry + timedelta(minutes=35 + index % 40)
                entry_offset = int((entry - start).total_seconds() // 60)
                exit_offset = int((exit_time - start).total_seconds() // 60)
                price = Decimal(str(replay_rows[entry_offset]["Close"]))
                exit_price = None if is_open else Decimal(str(replay_rows[exit_offset]["Close"]))
                amount = Decimal("0") if exit_price is None else (exit_price - price) * (1 if side == "LONG" else -1)
                create_trade(db, user.id, CanonicalTradeCreate(
                    account_id=accounts[index % 2].id, symbol="ES", side=side,
                    entry_time=entry, exit_time=None if is_open else exit_time,
                    entry_price=price, exit_price=exit_price,
                    quantity=1 + index % 3, commission=Decimal("1.25"), fees=Decimal("0.30"),
                    stop_loss=price - 12 if side == "LONG" else price + 12,
                    take_profit=price + 24 if side == "LONG" else price - 24,
                    r_multiple=None if is_open else amount / 12,
                    strategy_name=("Demo · Opening range", "Demo · Trend pullback", "Demo · Range reversal")[index % 3],
                    reviewed=index % 4 != 0, rating=1 + index % 5, setup_grade=("A", "B", "C")[index % 3],
                    emotional_state=("Patient", "Focused", "Rushed")[index % 3],
                    tag_ids=[tags[index % 3].id, tags[3].id],
                    note="Synthetic preview trade. " + ("Waited for the planned entry." if amount >= 0 else "Review entry timing and risk.")))
            for day in range(8):
                for account in accounts:
                    db.add(JournalDailyNote(user_id=user.id, account_id=account.id,
                        account_scope_key=str(account.id), note_date=(start + timedelta(days=day)).date(),
                        body="Demo data. Plan: wait for confirmation; review the first loss before increasing size."))
            assets = {}
            for symbol in ("BTCUSDT", "EURUSD", "ES"):
                asset = DatasetAsset(user_id=user.id, asset_key=symbol, name=f"Demo {symbol}", symbol=symbol,
                                     folder_path=str(dataset_root / symbol), currency="USD", timezone="UTC")
                db.add(asset)
                db.flush()
                assets[symbol] = asset
                for timeframe in ("M1", "M5", "M15", "H1"):
                    path = dataset_root / symbol / f"{symbol}_{timeframe}.csv"
                    stat = path.stat()
                    db.add(DatasetTimeframe(user_id=user.id, asset_id=asset.id, timeframe=timeframe,
                        csv_path=str(path), rows=counts[f"{symbol}:{timeframe}"], first_timestamp=start.isoformat(),
                        last_timestamp=(start + timedelta(minutes=(counts[f"{symbol}:{timeframe}"] - 1) * {"M1": 1, "M5": 5, "M15": 15, "H1": 60}[timeframe])).isoformat(),
                        file_size=stat.st_size, file_mtime_ns=stat.st_mtime_ns))
            for index, title in enumerate(("Opening range", "Trend pullback", "Range reversal")):
                playbook = Playbook(user_id=user.id, name=f"Demo · {title}", description="Synthetic review example",
                                    rules="Wait for confirmation; define risk; review every completed trade.")
                db.add(playbook)
                db.flush()
                session = BacktestSession(user_id=user.id, name=f"Demo · {title}", symbol="ES", instrument="ES",
                    timeframe="M1", dataset_asset_id=assets["ES"].id, csv_path=str(dataset_root / "ES" / "ES_M1.csv"),
                    currency="USD", timezone="UTC", strategy_name=playbook.name, playbook_id=playbook.id,
                    start_at=start, end_at=end, start_offset=0, current_offset=1800 + index * 600,
                    end_offset=count - 1, replay_ready=True, status="ACTIVE", initial_balance=25000)
                db.add(session)
                db.flush()
                # Match BacktestService.create_session: reads must not lazily
                # insert a missing position while completing a receipt.
                db.add(Position(user_id=user.id, session_id=session.id))
                for trade_index in range(8):
                    offset = 200 + trade_index * 100
                    entry_price = replay_rows[offset]["Close"]
                    exit_price = replay_rows[offset + 25]["Close"]
                    side = "LONG" if trade_index % 2 else "SHORT"
                    pnl = (exit_price - entry_price) * (1 if side == "LONG" else -1)
                    db.add(Trade(user_id=user.id, session_id=session.id, playbook_id=playbook.id,
                        status="CLOSED", side=side, entry_time=start + timedelta(minutes=offset),
                        entry_offset=offset, entry_price=entry_price, quantity=1, remaining_quantity=0,
                        exit_time=start + timedelta(minutes=offset + 25), exit_offset=offset + 25,
                        exit_price=exit_price, gross_pnl=pnl, realized_pnl=pnl - 1.55,
                        r_multiple=pnl / 12, commission_amount=1.25, fee_amount=.30,
                        strategy_name=playbook.name, notes="Synthetic preview result, not real performance."))
                db.flush()
                refresh_session_summary(db, user.id, session.id)
            layout = {"schemaVersion": 2, "settingsDefaultsVersion": 2, "chartStyle": "candles",
                      "drawings": [], "indicatorInstances": [{"id": "demo-ema-20", "kind": "ema",
                          "settings": {"period": 20, "color": "#22d3ee"}, "visible": True}],
                      "magnetMode": "off", "paneLayout": "single", "showOrderOverlays": True,
                      "smoothCandles": False, "timeframe": "5m",
                      "watchlistSelection": {"id": None, "symbol": "ES"}}
            for key, value in {"chart-layout.v1": layout, "live-chart-layout.v1": layout,
                    "order-sizing-mode.v1": "risk", "order-default-risk-percent.v1": "1",
                    "order-default-quantity.v1": "1", "order-risk-base.v1": "CURRENT_BALANCE",
                    "order-commission-mode.v1": "FIXED", "order-commission-fixed.v1": "1.25",
                    "order-fee-mode.v1": "FIXED", "order-fee-fixed.v1": "0.30",
                    "notebook-template.v1": "Demo review\nSetup:\nExecution:\nWhat worked:\nNext action:",
                    "live-journal.v1": {"settings": {"default_broker": "Synthetic preview",
                        "default_currency": "USD", "default_entry_type": "TAKEN",
                        "require_account_for_taken_trades": True}}}.items():
                db.add(AppStorageItem(user_id=user.id, namespace="edgelab", key=key, value=value))
            order_flow = seed_preview_order_flow(db, user.id, now)
            db.commit()
    finally:
        engine.dispose()

    manifest = {"demo": True, "database": str(database), "dataset_root": str(dataset_root),
                "user": "developer@localhost.edgelab", "canonical_trades": 80, "replay_sessions": 3,
                "order_flow": order_flow,
                "dataset_rows": counts, "start": start.isoformat(), "end": end.isoformat(),
                "environment": {"DATABASE_URL": database_url, "EDGELAB_MARKET_DATA_DATABASE_URL": database_url,
                    "EDGELAB_DATASETS_ROOT": str(dataset_root), "EDGELAB_DEPLOYMENT_MODE": "beta",
                    "EDGELAB_DEV_AUTH_BYPASS": "1", "EDGELAB_PUBLIC_ORIGIN": "http://localhost:5174",
                    "CORS_ORIGINS": "http://localhost:5174,http://127.0.0.1:5174",
                    "EDGELAB_BILLING_ENABLED": "0", "EDGELAB_UI_KILL_SWITCH": "0",
                    "EDGELAB_UI_SHELL_V2": "1", "EDGELAB_UI_JOURNAL_V2": "1",
                    "EDGELAB_UI_SETTINGS_V2": "1", "EDGELAB_UI_CHART_V2": "1",
                    "EDGELAB_UI_PUBLIC_V2": "1"}}
    manifest["csv_sha256"] = {str(path.relative_to(dataset_root)): hashlib.sha256(path.read_bytes()).hexdigest()
                              for path in sorted(dataset_root.rglob("*.csv"))}
    (directory / "preview.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True, help="New disposable directory; must not exist")
    arguments = parser.parse_args()
    print(json.dumps(create_preview(arguments.directory), indent=2))
