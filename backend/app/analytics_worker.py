from __future__ import annotations

import logging
import time

from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.models import BetaUser
from app.services.dashboard_summaries import refresh_user_dashboard_summary
from app.services.session_summaries import refresh_user_session_summaries


logger = logging.getLogger(__name__)


def run_once() -> dict[str, int]:
    touched = 0
    dashboard_summaries = 0
    with SessionLocal() as db:
        user_ids = db.scalars(select(BetaUser.id)).all()
        for user_id in user_ids:
            touched += refresh_user_session_summaries(db, user_id)
            refresh_user_dashboard_summary(db, user_id)
            dashboard_summaries += 1
        db.commit()
    return {
        "session_summaries_refreshed": touched,
        "dashboard_summaries_refreshed": dashboard_summaries,
    }


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
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
