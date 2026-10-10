import pytest

from app.config import (
    RequestAdmissionConfig,
    Settings,
    database_connect_args,
    database_engine_options,
    default_database_url,
    default_market_data_database_url,
)


def test_default_database_url_builds_postgres_url_from_parts(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("POSTGRES_DB", "bench")
    monkeypatch.setenv("POSTGRES_USER", "edge")
    monkeypatch.setenv("POSTGRES_PASSWORD", "secret")
    monkeypatch.setenv("EDGELAB_POSTGRES_HOST", "postgres.internal")
    monkeypatch.setenv("EDGELAB_POSTGRES_CONNECT_PORT", "6543")

    assert (
        default_database_url()
        == "postgresql+psycopg://edge:secret@postgres.internal:6543/bench"
    )


def test_default_database_url_prefers_explicit_override(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:////tmp/edgelab.db")
    monkeypatch.setenv("POSTGRES_DB", "ignored")
    monkeypatch.setenv("EDGELAB_POSTGRES_HOST", "ignored")

    assert default_database_url() == "sqlite:////tmp/edgelab.db"


def test_default_market_data_database_url_falls_back_to_primary_database(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("EDGELAB_MARKET_DATA_DATABASE_URL", raising=False)
    monkeypatch.setenv("POSTGRES_DB", "bench")
    monkeypatch.setenv("POSTGRES_USER", "edge")
    monkeypatch.setenv("POSTGRES_PASSWORD", "secret")
    monkeypatch.setenv("EDGELAB_POSTGRES_HOST", "postgres.internal")
    monkeypatch.setenv("EDGELAB_POSTGRES_CONNECT_PORT", "6543")

    assert (
        default_market_data_database_url()
        == "postgresql+psycopg://edge:secret@postgres.internal:6543/bench"
    )


def test_default_market_data_database_url_prefers_explicit_override(monkeypatch):
    monkeypatch.setenv(
        "EDGELAB_MARKET_DATA_DATABASE_URL",
        "postgresql+psycopg://edge:secret@timescaledb:5432/market",
    )
    monkeypatch.setenv("DATABASE_URL", "sqlite:////tmp/edgelab.db")

    assert (
        default_market_data_database_url()
        == "postgresql+psycopg://edge:secret@timescaledb:5432/market"
    )


def test_database_connect_args_disable_psycopg_prepared_statements():
    assert database_connect_args("postgresql+psycopg://edge:secret@pgbouncer:6432/edgelab") == {
        "prepare_threshold": None,
        "connect_timeout": 10,
    }


def test_database_connect_args_keep_sqlite_timeout():
    assert database_connect_args("sqlite:////tmp/edgelab.db") == {
        "check_same_thread": False,
        "timeout": 60,
    }


def test_database_operating_points_honor_configuration(monkeypatch):
    monkeypatch.setenv("EDGELAB_DB_SQLITE_LOCK_TIMEOUT_SECONDS", "0.05")
    monkeypatch.setenv("EDGELAB_DB_POOL_RECYCLE_SECONDS", "600")
    monkeypatch.setenv("EDGELAB_DB_POOL_SIZE", "7")
    monkeypatch.setenv("EDGELAB_DB_POOL_MAX_OVERFLOW", "3")
    monkeypatch.setenv("EDGELAB_DB_POOL_TIMEOUT_SECONDS", "1.5")
    monkeypatch.setenv("EDGELAB_DB_CONNECT_TIMEOUT_SECONDS", "4")
    assert database_connect_args("sqlite:///test.db")["timeout"] == 0.05
    assert database_connect_args("postgresql+psycopg://example/db")["connect_timeout"] == 4
    assert database_engine_options("postgresql+psycopg://example/db") == {
        "pool_pre_ping": True, "pool_recycle": 600, "pool_size": 7,
        "max_overflow": 3, "pool_timeout": 1.5,
    }
    assert database_engine_options("sqlite:///test.db") == {"pool_pre_ping": True}


@pytest.mark.parametrize("name,value", [
    ("EDGELAB_DB_SQLITE_LOCK_TIMEOUT_SECONDS", "nan"),
    ("EDGELAB_DB_SQLITE_LOCK_TIMEOUT_SECONDS", "inf"),
    ("EDGELAB_DB_SQLITE_LOCK_TIMEOUT_SECONDS", "-1"),
    ("EDGELAB_DB_SQLITE_LOCK_TIMEOUT_SECONDS", "301"),
    ("EDGELAB_DB_POOL_RECYCLE_SECONDS", "0"),
    ("EDGELAB_DB_POOL_RECYCLE_SECONDS", "86401"),
    ("EDGELAB_DB_POOL_SIZE", "0"),
    ("EDGELAB_DB_POOL_SIZE", "1001"),
    ("EDGELAB_DB_POOL_MAX_OVERFLOW", "-1"),
    ("EDGELAB_DB_POOL_MAX_OVERFLOW", "invalid"),
    ("EDGELAB_DB_POOL_TIMEOUT_SECONDS", "nan"),
    ("EDGELAB_DB_POOL_TIMEOUT_SECONDS", "inf"),
    ("EDGELAB_DB_POOL_TIMEOUT_SECONDS", "0"),
    ("EDGELAB_DB_POOL_TIMEOUT_SECONDS", "61"),
    ("EDGELAB_DB_CONNECT_TIMEOUT_SECONDS", "0"),
    ("EDGELAB_DB_CONNECT_TIMEOUT_SECONDS", "121"),
    ("EDGELAB_DB_CONNECT_TIMEOUT_SECONDS", "1.5"),
])
def test_invalid_database_operating_points_fail_with_variable_name(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    url = "sqlite:///test.db" if "SQLITE" in name else "postgresql+psycopg://example/db"
    with pytest.raises(ValueError, match=name):
        if "TIMEOUT" in name and "POOL" not in name:
            database_connect_args(url)
        else:
            database_engine_options(url)


def test_admission_operating_points_load_into_settings(monkeypatch):
    monkeypatch.setenv("EDGELAB_HTTP_QUEUE_WAIT_SECONDS", "0.05")
    monkeypatch.setenv("EDGELAB_HTTP_QUEUE_DEPTH", "60")
    monkeypatch.setenv("EDGELAB_HTTP_PROBE_BUDGET", "4")
    monkeypatch.setenv("EDGELAB_HTTP_VALIDATION_THREAD_RESERVE", "6")
    monkeypatch.setenv("EDGELAB_HTTP_SQL_CHECKOUT_MULTIPLIER", "3")
    tuning = RequestAdmissionConfig.from_env()
    assert tuning == RequestAdmissionConfig(0.05, 60, 4, 6, 3)
    assert Settings().request_admission == tuning


@pytest.mark.parametrize("name,value", [
    ("EDGELAB_HTTP_REQUEST_LIMIT", "-1"),
    ("EDGELAB_HTTP_REQUEST_LIMIT", "10001"),
    ("EDGELAB_HTTP_REQUEST_LIMIT", "invalid"),
    ("EDGELAB_HTTP_REQUEST_LIMIT", "nan"),
    ("EDGELAB_HTTP_QUEUE_WAIT_SECONDS", "nan"),
    ("EDGELAB_HTTP_QUEUE_WAIT_SECONDS", "inf"),
    ("EDGELAB_HTTP_QUEUE_WAIT_SECONDS", "-1"),
    ("EDGELAB_HTTP_QUEUE_WAIT_SECONDS", "5.001"),
    ("EDGELAB_HTTP_QUEUE_WAIT_SECONDS", "invalid"),
    ("EDGELAB_HTTP_QUEUE_DEPTH", "-1"),
    ("EDGELAB_HTTP_QUEUE_DEPTH", "1025"),
    ("EDGELAB_HTTP_QUEUE_DEPTH", "1.5"),
    ("EDGELAB_HTTP_PROBE_BUDGET", "-1"),
    ("EDGELAB_HTTP_PROBE_BUDGET", "33"),
    ("EDGELAB_HTTP_VALIDATION_THREAD_RESERVE", "0"),
    ("EDGELAB_HTTP_VALIDATION_THREAD_RESERVE", "257"),
    ("EDGELAB_HTTP_SQL_CHECKOUT_MULTIPLIER", "0"),
    ("EDGELAB_HTTP_SQL_CHECKOUT_MULTIPLIER", "9"),
])
def test_invalid_admission_operating_points_fail_with_variable_name(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(ValueError, match=name):
        Settings()
