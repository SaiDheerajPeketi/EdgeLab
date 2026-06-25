from app.config import (
    database_connect_args,
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
    }


def test_database_connect_args_keep_sqlite_timeout():
    assert database_connect_args("sqlite:////tmp/edgelab.db") == {
        "check_same_thread": False,
        "timeout": 60,
    }
