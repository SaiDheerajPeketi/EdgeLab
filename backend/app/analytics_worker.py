from __future__ import annotations

import logging
import time

from sqlalchemy import select, text

from app.config import settings
from app.db import SessionLocal, engine
from app.models import BetaUser
from app.observability import configure_logging, configure_tracing
from app.services.dashboard_summaries import refresh_user_dashboard_summary
from app.services.session_summaries import refresh_user_session_summaries


logger = logging.getLogger(__name__)
ANALYTICS_SWEEP_LOCK = 1702091
ANALYTICS_USER_BATCH_SIZE = 200


def _sqlite_user_ids():
    after_id = None
    while True:
        statement = select(BetaUser.id).order_by(BetaUser.id).limit(ANALYTICS_USER_BATCH_SIZE)
        if after_id is not None:
            statement = statement.where(BetaUser.id > after_id)
        # Release SQLite's read lock before account transactions commit writes.
        with SessionLocal() as db:
            page = db.scalars(statement).all()
        if not page:
            return
        yield from page
        after_id = page[-1]


def run_once() -> dict[str, int]:
    touched = 0
    dashboard_summaries = 0
    # Keep one coordinator transaction open for the sweep's ownership lock.
    # Account work commits separately, so one failure cannot undo earlier users.
    with SessionLocal() as coordinator:
        if coordinator.get_bind().dialect.name == "postgresql" and not coordinator.scalar(
            text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": ANALYTICS_SWEEP_LOCK},
        ):
            logger.info("analytics-worker skipped: another sweep is running")
            return {"session_summaries_refreshed": 0, "dashboard_summaries_refreshed": 0}
        if coordinator.get_bind().dialect.name == "sqlite":
            user_ids = _sqlite_user_ids()
        else:
            user_ids = coordinator.scalars(
                select(BetaUser.id).order_by(BetaUser.id).execution_options(yield_per=ANALYTICS_USER_BATCH_SIZE)
            )
        try:
            for user_id in user_ids:
                with SessionLocal() as db:
                    account_touched = refresh_user_session_summaries(db, user_id)
                    refresh_user_dashboard_summary(db, user_id)
                    db.commit()
                touched += account_touched
                dashboard_summaries += 1
        finally:
            user_ids.close()
    return {
        "session_summaries_refreshed": touched,
        "dashboard_summaries_refreshed": dashboard_summaries,
    }


def main() -> None:
    configure_logging(
        log_level=settings.observability_log_level,
        json_logs=settings.observability_json_logs,
        service_name=settings.otel_service_name or "edgelab-analytics-worker",
    )
    configure_tracing(
        service_name=settings.otel_service_name or "edgelab-analytics-worker",
        service_namespace=settings.otel_service_namespace,
        environment=settings.otel_environment,
        otlp_endpoint=settings.otel_exporter_otlp_endpoint,
        otlp_headers=settings.otel_exporter_otlp_headers,
        sample_ratio=settings.otel_trace_sample_ratio,
        sql_engines=(engine,),
    )
    interval_seconds = max(settings.analytics_interval_seconds, 5)
    logger.info("analytics-worker starting with %ss interval", interval_seconds)
    while True:
        started_at = time.perf_counter()
        try:
            counts = run_once()
            logger.info(
                "analytics-worker refreshed %s session summaries and %s dashboard summaries",
                counts["session_summaries_refreshed"],
                counts["dashboard_summaries_refreshed"],
            )
        except Exception:
            logger.exception("analytics-worker refresh failed")
        elapsed = time.perf_counter() - started_at
        time.sleep(max(interval_seconds - elapsed, 1))


if __name__ == "__main__":
    main()
