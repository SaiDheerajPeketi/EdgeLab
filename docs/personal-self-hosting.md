# Personal self-hosting and free feeds

This is a separate, single-user local installation. It has a local workspace identity and data exports without Google, Stripe or a subscription. Production and beta keep their existing access rules. The personal build uses three services: Nginx/frontend, one FastAPI process, and a historical data downloader. SQLite and CSVs avoid running PostgreSQL, Redis or an auth service on your laptop.

## Start and stop

Install Node.js 22.13+ and Docker with Compose v2, then run from the repository root:

```bash
npm run personal:start
```

Open <http://localhost:8081> and choose **Open workspace**. The home and pricing routes go to the workspace in this build. Your existing preview and beta/production volumes are separate.

```bash
npm run personal:logs -- data-populator
npm run personal:check
npm run personal:stop
```

If your Docker engine uses a named context, you may set `DOCKER_CONTEXT` in the private personal `.env`; this selects the engine for personal commands without changing your global Docker context.

The stop command preserves data. To restart or rebuild after an update, run `personal:start` again. The helper generates private signing, proxy and encryption keys once in `.artifacts/personal/.env`, with owner-only file permissions. It preserves them on later runs. Do not share this file or replace its keys after storing broker credentials.

The Compose project name is pinned to `edgelab-personal`. The frontend is bound to **127.0.0.1 only**; the API has no published port. HTTP and WebSocket admission check the loopback Host and actual socket peer, or the private Nginx proxy key. Forwarded-address headers alone cannot grant local access. The API starts with proxy-header trust disabled. Personal mode rejects public origins and non-development configuration; it is not a public or multi-user deployment.

## Real replay history

On first start, the downloader fetches approximately 30 days of BTCUSDT, ETHUSDT and SOLUSDT one-minute Binance spot candles. It updates every five minutes and derives M5, M15, M30, H1, H4 and daily CSVs. Downloads can take a few minutes; refresh the replay dataset list after completion. Live Binance charts use the existing public market stream independently of the historical job.

Files live under `.artifacts/personal/datasets/`; the API mounts this folder read-only. The downloader resumes using its manifest. Edit these non-secret settings in the private personal `.env`, then restart with `personal:start`:

| Setting | Default | Effect |
| --- | --- | --- |
| `EDGELAB_PERSONAL_PORT` | `8081` | Separate loopback frontend port |
| `EDGELAB_PERSONAL_CRYPTO_SYMBOLS` | `BTCUSDT,ETHUSDT,SOLUSDT` | Binance spot symbols to retain |
| `EDGELAB_PERSONAL_LOOKBACK_DAYS` | `30` | Initial historical lookback |
| `EDGELAB_PERSONAL_REFRESH_SECONDS` | `300` | Download interval; minimum 60 seconds |

Increasing symbol count/history increases bandwidth, disk and memory. Lookback controls the initial fetch; it does not automatically delete older saved bars. There is one dataset writer; do not start a second downloader against the same directory. Real upstream failures are reported, without substituting synthetic prices.

## Free coverage and limits

Provider availability and account eligibility depend on your jurisdiction. Free personal access is not a licence to redistribute data through the commercial EdgeLab service.

| Market | Source and cost | Working path here | Limit |
| --- | --- | --- | --- |
| Crypto spot | [Binance public APIs](https://developers.binance.com/en/docs/products/spot/faqs/market_data_only), no API key | Existing live chart/watchlist plus automatic replay history | Binance venue/spot coverage; network or regional restrictions may apply |
| Alternative crypto spot | [Kraken public OHLC](https://docs.kraken.com/api-reference/market-data/get-ohlc-data), no account | Optional recent-history importer below | Latest 720 entries maximum; unfinished current bar excluded; not a new live chart adapter |
| US stocks/ETFs | [Alpaca Basic](https://docs.alpaca.markets/us/docs/about-market-data-api), free personal/paper account | Optional IEX history importer using your keys | IEX-only volume/prices; conservatively ends history at least 16 minutes ago; not a consolidated tape or new live stream |
| Indian stocks, indices and derivatives | [Angel One SmartAPI](https://smartapi.angelone.in/), own broker/API account | Existing broker connection/live quote interface | Existing minute chart construction still has day-high/low/volume and currency-scaling limitations; do not treat it as verified minute OHLC |
| FX, metals and index CFDs | Broker-authorized CSV exports or a separately licensed API | Place permitted OHLC CSVs in the dataset folder | No new free intraday FX feed enabled automatically |
| US options | Alpaca Basic includes an indicative feed | Not integrated by these importers | Full OPRA data is not the free indicative feed |
| Futures and global exchange depth | Exchange/broker-specific entitlements | Import data you have rights to use | Complete global real-time tapes and futures L2 are not available universally free |

[Binance historical archive terms](https://github.com/binance/binance-public-data/blob/master/TERMS_AND_CONDITIONS.md) and live API terms are distinct. Preserve attribution/provenance and review the current terms before sharing or commercial use.

Dukascopy website terms specifically restrict automated access and database construction, despite permitting limited personal downloads. The personal build disables its existing website polling endpoints and does not run its unattended downloader. Product-specific permission/API terms must be established before enabling that use. See [Dukascopy terms](https://www.dukascopy.com/swiss/english/legal-pages/terms-of-use/).

Daily [ECB reference rates](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html), [SEC company filings](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) and [FRED macro series](https://fred.stlouisfed.org/docs/api/terms_of_use.html) are useful supplemental sources. They are not intraday candles and are not imported by this variant.

## Optional personal history imports

With the personal stack running, inspect supported options:

```bash
npm run personal:feeds -- --help
npm run personal:feeds -- kraken --symbol XBTUSD
# After configuring your own Alpaca keys:
npm run personal:feeds -- alpaca --symbol AAPL --lookback-days 7
```

Kraken requires no key. Alpaca requires your own free account's API key and secret, saved as `APCA_API_KEY_ID` and `APCA_API_SECRET_KEY` in the private personal `.env`. Run `personal:start` after editing so the downloader receives them. The helper does not register a provider account or purchase a plan. Use the importer's documented arguments; these imports are explicitly requested snapshots, not an Alpaca streaming service.

Imports retain provider/feed provenance and use separate dataset identities. They validate OHLC values, sort/deduplicate timestamps, exclude unfinished candles and write atomically. Provider timeouts and pagination limits fail visibly. Imported keys remain server-side and never enter browser build values, URLs, source offers or data exports.

## Backups and upgrades

Your account database is in the `edgelab-personal_personal-api-data` Docker volume; downloaded/imported datasets and private keys are in `.artifacts/personal/`. Back up **both**. Stop the personal stack before copying SQLite files and their WAL/SHM companions. Preserve original encryption keys when restoring broker credentials. See [maintenance](maintenance.md) for consistent backups.

Rebuild API and frontend together after pulling a reviewed update. Startup applies the existing Alembic migrations to the personal database. The personal stack has no replica/failover guarantee and no paid infrastructure bill beyond your own hardware, power and Internet. Keep provider account entitlements and free-tier limits separate from software hosting cost.
