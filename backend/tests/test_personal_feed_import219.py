from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import pytest

from scripts import import_personal_feeds as feeds

NOW = datetime(2026, 10, 10, 12, 0, tzinfo=timezone.utc)
START = NOW - timedelta(days=1)
END = NOW - timedelta(minutes=16)


def alpaca_row(timestamp=START, **values):
    return {"t": timestamp.isoformat(), "o": 10, "h": 12, "l": 9, "c": 11, "v": 4, **values}


@pytest.fixture
def alpaca_keys(monkeypatch):
    monkeypatch.setenv("APCA_API_KEY_ID", "private-key")
    monkeypatch.setenv("APCA_API_SECRET_KEY", "private-secret")


def test_alpaca_uses_iex_fixed_origin_bounds_and_paginates(alpaca_keys):
    requests = []
    pages = [
        {"bars": {"AAPL": [alpaca_row(), alpaca_row(START + feeds.MINUTE)]}, "next_page_token": "next"},
        {"bars": {"AAPL": [alpaca_row(c=12)]}, "next_page_token": None},
    ]

    def fetch(request, timeout):
        requests.append((request, timeout))
        return pages.pop(0)

    result = feeds.alpaca_history("AAPL", START, END, now=NOW, fetch=fetch)
    assert [bar.timestamp for bar in result] == [START, START + feeds.MINUTE]
    assert result[0].close == 12
    request, timeout = requests[0]
    assert urlparse(request.full_url).netloc == "data.alpaca.markets"
    assert request.get_header("Apca-api-key-id") == "private-key"
    assert timeout == 20
    query = parse_qs(urlparse(request.full_url).query)
    assert query["feed"] == ["iex"] and query["timeframe"] == ["1Min"]
    assert query["end"] == [(END - feeds.MINUTE).isoformat()]
    assert parse_qs(urlparse(requests[1][0].full_url).query)["page_token"] == ["next"]


@pytest.mark.parametrize("rows", [
    [alpaca_row(v=-1)], [alpaca_row(h=8)], [alpaca_row(c=float("nan"))],
    [alpaca_row(c=True)], [alpaca_row(END)], [{"t": START.isoformat(), "o": 10}],
    [alpaca_row(START.replace(second=1))],
])
def test_alpaca_rejects_invalid_or_partial_rows(alpaca_keys, rows):
    with pytest.raises(ValueError):
        feeds.alpaca_history("AAPL", START, END, now=NOW,
                             fetch=lambda *_: {"bars": {"AAPL": rows}, "next_page_token": None})


def test_alpaca_refuses_unbounded_or_future_range_before_network(alpaca_keys):
    def fetch(*_):
        pytest.fail("Invalid ranges must not reach the provider")

    for start, end in [(END, END), (START - timedelta(days=30), END), (START, NOW)]:
        with pytest.raises(ValueError):
            feeds.alpaca_history("AAPL", start, end, now=NOW, fetch=fetch)


def test_alpaca_missing_keys_and_loop_fail_safely(monkeypatch, alpaca_keys):
    monkeypatch.delenv("APCA_API_SECRET_KEY")
    with pytest.raises(ValueError, match="Set your own"):
        feeds.alpaca_history("AAPL", START, END, now=NOW, fetch=lambda *_: pytest.fail())
    monkeypatch.setenv("APCA_API_SECRET_KEY", "private-secret")
    with pytest.raises(ValueError, match="repeated"):
        feeds.alpaca_history("AAPL", START, END, now=NOW,
                             fetch=lambda *_: {"bars": {}, "next_page_token": "same"})


def test_alpaca_stops_after_max_pages(alpaca_keys):
    calls = []
    def fetch(*_):
        calls.append(1)
        return {"bars": {}, "next_page_token": str(len(calls))}
    with pytest.raises(ValueError, match="page limit"):
        feeds.alpaca_history("AAPL", START, END, now=NOW, fetch=fetch)
    assert len(calls) == feeds.MAX_PAGES


def test_credentials_never_follow_redirects_or_appear_in_errors(monkeypatch, alpaca_keys):
    from urllib.error import HTTPError
    request = feeds.Request(feeds.ALPACA_URL, headers={"APCA-API-SECRET-KEY": "private-secret"})
    assert feeds.NoRedirects().redirect_request(request, None, 302, "", {}, "https://other.example") is None
    class Opener:
        def open(self, *_args, **_kwargs):
            raise HTTPError(feeds.ALPACA_URL, 302, "private-secret", {}, None)
    monkeypatch.setattr(feeds, "build_opener", lambda *_: Opener())
    with pytest.raises(ValueError) as error:
        feeds.read_json(request, 20)
    assert "private-secret" not in str(error.value)
    assert "302" in str(error.value)


def kraken_row(timestamp, **values):
    row = [int(timestamp.timestamp()), "10", "12", "9", "11", "10.5", "4", 2]
    for key, value in values.items():
        row[int(key)] = value
    return row


def test_kraken_is_keyless_recent_only_and_drops_unfinished_tail():
    requests = []
    def fetch(request, timeout):
        requests.append(request)
        return {"error": [], "result": {"XXBTZUSD": [
            kraken_row(NOW - 2 * feeds.MINUTE), kraken_row(NOW - feeds.MINUTE), kraken_row(NOW)
        ], "last": int(NOW.timestamp())}}
    bars = feeds.kraken_history("XBTUSD", now=NOW, fetch=fetch)
    assert [bar.timestamp for bar in bars] == [NOW - 2 * feeds.MINUTE, NOW - feeds.MINUTE]
    assert urlparse(requests[0].full_url).netloc == "api.kraken.com"
    assert not any("key" in key.lower() for key in requests[0].headers)


@pytest.mark.parametrize("rows", [
    [kraken_row(NOW), kraken_row(NOW - feeds.MINUTE)],
    [kraken_row(NOW + feeds.MINUTE)],
    [kraken_row(NOW, **{"6": "NaN"})],
    [kraken_row(NOW)] * 722,
])
def test_kraken_rejects_invalid_future_or_overlarge_responses(rows):
    with pytest.raises(ValueError):
        feeds.kraken_history("XBTUSD", now=NOW,
                             fetch=lambda *_: {"error": [], "result": {"XXBTZUSD": rows, "last": 1}})


def test_provider_folders_preserve_identity_merge_corrections_and_closed_derivations(tmp_path):
    original = [feeds.candle(START + index * feeds.MINUTE, [10, 12, 9, 11, 4]) for index in range(7)]
    summary = feeds.write_history(tmp_path, "alpaca", "AAPL", original, derived=("M5",))
    correction = feeds.candle(START, [10, 13, 9, 12, 5])
    feeds.write_history(tmp_path, "alpaca", "AAPL", [correction], derived=("M5",))
    path = tmp_path / "ALPACA_IEX_AAPL" / "ALPACA_IEX_AAPL_M1.csv"
    rows = list(feeds.csv.DictReader(path.open()))
    assert len(rows) == 7 and float(rows[0]["Close"]) == 12
    assert summary["rows"] == 7
    derived = list(feeds.csv.DictReader(path.with_name("ALPACA_IEX_AAPL_M5.csv").open()))
    assert len(derived) == 1 and float(derived[0]["High"]) == 13
    provenance = (path.parent / "provenance.json").read_text()
    for artifact in path.parent.glob("*"):
        assert artifact.stat().st_mode & 0o777 == 0o644
    assert "IEX only" in provenance and "private-key" not in provenance and "private-secret" not in provenance
    assert not list(path.parent.glob(".personal-import-*"))
    feeds.write_history(tmp_path, "kraken", "AAPL", original)
    assert (tmp_path / "KRAKEN_AAPL" / "KRAKEN_AAPL_M1.csv").exists()


def test_unknown_or_conflicting_source_is_never_silently_merged(tmp_path):
    folder = tmp_path / "ALPACA_IEX_AAPL"
    folder.mkdir()
    path = folder / "ALPACA_IEX_AAPL_M1.csv"
    path.write_text(",".join(feeds.DATA_COLUMNS) + "\n")
    bars = [feeds.candle(START, [10, 12, 9, 11, 4])]
    with pytest.raises(ValueError, match="lacks provenance"):
        feeds.write_history(tmp_path, "alpaca", "AAPL", bars)
    (folder / "provenance.json").write_text('{"provider": "kraken"}')
    with pytest.raises(ValueError, match="differs"):
        feeds.write_history(tmp_path, "alpaca", "AAPL", bars)
    with pytest.raises(ValueError):
        feeds.write_history(tmp_path, "alpaca", "../../escape", bars)


def test_atomic_write_failure_preserves_existing_file_and_cleans_temp(tmp_path, monkeypatch):
    path = tmp_path / "existing.csv"
    path.write_text("old")
    def fail_replace(*_):
        raise OSError("simulated storage failure")
    monkeypatch.setattr(feeds.Path, "replace", fail_replace)
    with pytest.raises(OSError):
        feeds.atomic_text(path, "new")
    assert path.read_text() == "old"
    assert not list(tmp_path.glob(".personal-import-*"))


def test_cli_refuses_nonpersonal_use_and_kraken_date_arguments(monkeypatch, tmp_path):
    monkeypatch.setenv("EDGELAB_DEPLOYMENT_MODE", "production")
    with pytest.raises(SystemExit) as error:
        feeds.main(["kraken", "--symbol", "XBTUSD", "--root", str(tmp_path)])
    assert error.value.code == 2
    with pytest.raises(SystemExit):
        feeds.main(["kraken", "--symbol", "XBTUSD", "--personal-use", "--start", "2026-10-01"])
    assert list(tmp_path.iterdir()) == []


def test_kraken_accepts_720_completed_candles_plus_its_uncommitted_tail():
    rows = [kraken_row(NOW - timedelta(minutes=720 - index)) for index in range(721)]
    bars = feeds.kraken_history("XBTUSD", now=NOW,
                                fetch=lambda *_: {"error": [], "result": {"XXBTZUSD": rows, "last": 1}})
    assert len(bars) == 720 and bars[-1].timestamp == NOW - feeds.MINUTE
