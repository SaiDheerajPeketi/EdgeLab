from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, func, select
from sqlalchemy.engine import Engine

from app.db import Base


DEFAULT_BATCH_SIZE = 1000
DEFAULT_SAMPLE_SIZE = 5


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Copy a SQLite EdgeLab database into a target database and verify row counts plus sample rows."
    )
    parser.add_argument("--source-sqlite-path", required=True)
    parser.add_argument("--target-database-url", required=True)
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--sample-size", type=int, default=DEFAULT_SAMPLE_SIZE)
    parser.add_argument("--reset-target", action="store_true")
    return parser.parse_args()


def engine_for_url(database_url: str) -> Engine:
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    return create_engine(database_url, connect_args=connect_args)


def migrate_sqlite_to_database(
    source_database_url: str,
    target_database_url: str,
    *,
    batch_size: int = DEFAULT_BATCH_SIZE,
    sample_size: int = DEFAULT_SAMPLE_SIZE,
    reset_target: bool = False,
) -> dict[str, Any]:
    source_engine = engine_for_url(source_database_url)
    target_engine = engine_for_url(target_database_url)
    Base.metadata.create_all(target_engine)

    if reset_target:
        with target_engine.begin() as target_connection:
            for table in reversed(Base.metadata.sorted_tables):
                target_connection.execute(table.delete())

    migrated_rows: dict[str, int] = {}
    with source_engine.connect() as source_connection, target_engine.begin() as target_connection:
        for table in Base.metadata.sorted_tables:
            result = source_connection.execute(
                select(table).execution_options(stream_results=True)
            )
            inserted_rows = 0
            while True:
                batch = result.fetchmany(batch_size)
                if not batch:
                    break
                payload = [dict(row._mapping) for row in batch]
                target_connection.execute(table.insert(), payload)
                inserted_rows += len(payload)
            migrated_rows[table.name] = inserted_rows

    verification = verify_database_copy(
        source_engine,
        target_engine,
        sample_size=sample_size,
    )
    verification["migrated_rows"] = migrated_rows
    verification["source_database_url"] = source_database_url
    verification["target_database_url"] = target_database_url
    return verification


def verify_database_copy(
    source_engine: Engine,
    target_engine: Engine,
    *,
    sample_size: int = DEFAULT_SAMPLE_SIZE,
) -> dict[str, Any]:
    table_results: dict[str, Any] = {}
    with source_engine.connect() as source_connection, target_engine.connect() as target_connection:
        for table in Base.metadata.sorted_tables:
            source_count = source_connection.scalar(select(func.count()).select_from(table)) or 0
            target_count = target_connection.scalar(select(func.count()).select_from(table)) or 0
            source_samples = fetch_sample_rows(source_connection, table, sample_size)
            target_samples = fetch_sample_rows(target_connection, table, sample_size)
            table_results[table.name] = {
                "source_count": source_count,
                "target_count": target_count,
                "counts_match": source_count == target_count,
                "sample_rows_match": source_samples == target_samples,
                "source_samples": source_samples,
                "target_samples": target_samples,
            }

    return {
        "ok": all(
            result["counts_match"] and result["sample_rows_match"]
            for result in table_results.values()
        ),
        "tables": table_results,
    }


def fetch_sample_rows(connection, table, sample_size: int) -> list[dict[str, Any]]:
    if sample_size <= 0:
        return []
    order_columns = list(table.primary_key.columns) or list(table.columns)
    rows = connection.execute(select(table).order_by(*order_columns).limit(sample_size)).fetchall()
    return [normalize_row(dict(row._mapping)) for row in rows]


def normalize_row(row: dict[str, Any]) -> dict[str, Any]:
    return {key: normalize_value(value) for key, value in row.items()}


def normalize_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, list):
        return [normalize_value(item) for item in value]
    if isinstance(value, dict):
        return {key: normalize_value(item) for key, item in value.items()}
    return value


def main() -> None:
    args = parse_args()
    source_database_url = f"sqlite:///{Path(args.source_sqlite_path).resolve()}"
    summary = migrate_sqlite_to_database(
        source_database_url,
        args.target_database_url,
        batch_size=args.batch_size,
        sample_size=args.sample_size,
        reset_target=args.reset_target,
    )
    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
