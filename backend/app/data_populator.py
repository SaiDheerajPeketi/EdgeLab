import logging
import time

from app.config import settings
from app.db import SessionLocal, engine
from app.market_data_db import MarketDataSessionLocal, init_market_data_db, market_data_engine
from app.observability import configure_logging, configure_tracing
from app.services.data_populator import ScheduledDataPopulator


logger = logging.getLogger(__name__)


def main() -> None:
    configure_logging(
        log_level=settings.observability_log_level,
        json_logs=settings.observability_json_logs,
        service_name=settings.otel_service_name or "edgelab-data-populator",
    )
    configure_tracing(
        service_name=settings.otel_service_name or "edgelab-data-populator",
        service_namespace=settings.otel_service_namespace,
        environment=settings.otel_environment,
        otlp_endpoint=settings.otel_exporter_otlp_endpoint,
        otlp_headers=settings.otel_exporter_otlp_headers,
        sample_ratio=settings.otel_trace_sample_ratio,
        sql_engines=(engine, market_data_engine),
    )
    init_market_data_db()
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
        binance_archive_workers=settings.data_populator_binance_archive_workers,
        catalog_session_factory=SessionLocal,
        market_data_session_factory=MarketDataSessionLocal,
        catalog_import_enabled=settings.market_data_import_enabled,
    )
    interval = max(60, settings.data_populator_interval_seconds)
    logger.info(
        "Data populator starting: root=%s interval_seconds=%s backfill_mode=%s "
        "forex_symbols=%s crypto_symbols=%s derived_timeframes=%s",
        settings.datasets_root,
        interval,
        settings.data_populator_backfill_mode,
        ",".join(settings.data_populator_forex_symbols),
        ",".join(settings.data_populator_crypto_symbols),
        ",".join(settings.data_populator_derived_timeframes),
    )

    while True:
        summary = populator.populate_once()
        logger.info(
            "Data population finished: fetched=%s instruments=%s errors=%s",
            summary.fetched,
            len(summary.results),
            len(summary.errors),
        )
        if summary.errors:
            for result in summary.errors:
                logger.warning("%s failed: %s", result.asset_id, result.error)
        logger.info("Data populator sleeping for %s seconds", interval)
        time.sleep(interval)


if __name__ == "__main__":
    main()
