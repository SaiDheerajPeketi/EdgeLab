"""Personal ingestion must not open the API's account catalog."""
from dataclasses import replace

import pytest

from app import data_populator as entrypoint


@pytest.mark.parametrize("mode", ["personal", "beta", "production"])
def test_populator_catalog_ownership(monkeypatch, mode):
    captured = {}

    class StopAfterConfiguration(Exception):
        pass

    def capture(root, **options):
        captured.update(options)
        raise StopAfterConfiguration()

    monkeypatch.setattr(entrypoint, "settings", replace(entrypoint.settings, deployment_mode=mode))
    monkeypatch.setattr(entrypoint, "configure_logging", lambda **options: None)
    monkeypatch.setattr(entrypoint, "configure_tracing", lambda **options: None)
    monkeypatch.setattr(entrypoint, "init_market_data_db", lambda: None)
    monkeypatch.setattr(entrypoint, "ScheduledDataPopulator", capture)
    with pytest.raises(StopAfterConfiguration):
        entrypoint.main()
    assert captured["catalog_session_factory"] is (None if mode == "personal" else entrypoint.SessionLocal)
