import logging
import time

from app.config import settings
from app.db import SessionLocal, init_db
from app.services.data_populator import ScheduledDataPopulator
from app.services.datasets import DatasetCatalogService


logger = logging.getLogger(__name__)


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    init_db()
    populator = ScheduledDataPopulator(
        settings.datasets_root,
        forex_symbols=settings.data_populator_forex_symbols,
        crypto_symbols=settings.data_populator_crypto_symbols,
        backfill_mode=settings.data_populator_backfill_mode,
        lookback_days=settings.data_populator_lookback_days,
        derived_timeframes=settings.data_populator_derived_timeframes,
        forex_start_date=settings.data_populator_forex_start_date,
        crypto_start_date=settings.data_populator_crypto_start_date,
        request_timeout_seconds=settings.data_populator_request_timeout_seconds,
    )
    catalog = DatasetCatalogService(settings.datasets_root, SessionLocal)
    interval = max(60, settings.data_populator_interval_seconds)

    while True:
        summary = populator.populate_once()
        try:
            with SessionLocal() as db:
                catalog.refresh_catalog(db)
        except Exception:
            logger.exception("Dataset catalog refresh failed")
        logger.info(
            "Data population finished: fetched=%s instruments=%s errors=%s",
            summary.fetched,
            len(summary.results),
            len(summary.errors),
        )
        if summary.errors:
            for result in summary.errors:
                logger.warning("%s failed: %s", result.asset_id, result.error)
        time.sleep(interval)


if __name__ == "__main__":
    main()
