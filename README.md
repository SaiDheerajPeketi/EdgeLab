# EdgeLab

EdgeLab is a local-first trading workspace for market replay, charting, trade journaling, and performance review. It combines a React client with a FastAPI backend and can run as a small SQLite installation or as a multi-service PostgreSQL/TimescaleDB stack.

The native Pine editor uses PineTS 0.11.0 with reviewed local source patches under AGPL-3.0-only; EdgeLab's original code uses the same licence. See [LICENSE](LICENSE), [third-party notices](THIRD_PARTY_NOTICES.md) and [reproducible engine build](frontend/vendor/pinets/README.md). Distribution or service deployments of Pine-enabled builds must offer complete matching application source, including changes and build scripts. The chart editor supports original EdgeLab DSL and experimental native Pine v5/v6 indicators and strategy tests; PineTS results are not guaranteed to match TradingView.

The editor's community catalog preserves 29 original GPL-3.0 studies by Alex Orekhov (everget), with commit, source hash and licence records. Four originals use Pine v6; the other 25 have separate reviewed Pine v5 derivatives, while their originals remain available to inspect and download. Catalog refreshes preserve immutable revisions and explicitly select the reviewed revision, including older pinned archives. Saved scripts and chart copies retain their own source. See [catalog maintenance](scripts/README.md#pine-community-catalog).

Pine-enabled browser builds generate a matching application source download at `/source/`, available from the public footer, settings and Pine editor. The archive captures current frontend/backend code, locked dependencies, verified original Pine inputs and overrides, build scripts and deployment configuration, with file checksums and build/run instructions. Post-build verification refuses a source offer if input files changed during compilation. Credentials, trading records, market datasets, Git history, generated bundles and internal planning documents are excluded. Rebuild the API and browser from the same checkout when deploying this source offer.

Native Pine `plot()` supports its sixteen current arguments, including solid, dashed and dotted line styles and diamond step lines. Custom inputs, source-first visibility, offsets and chart placement remain intact. Connected paths keep dash patterns visible at narrow bar spacing; area fills remain continuous. Line spacing, phase origins and diamond geometry use local canvas metrics, without verified TradingView pixel equivalence.

Native Pine `plotarrow` renders up/down arrows from signed numeric signals, with custom minimum/maximum pixel heights, directional colors, offsets and source-first `show_last`. Zero and missing values draw no arrow. Length uses the absolute signal relative to its full retained snapshot with a minimum-height floor; this normalization, defaults and pixel geometry are local policies, without verified TradingView equivalence.

Native Pine `plotchar` signals support Unicode characters, separate text, bar conditions, absolute prices, offsets and pane-edge placement. Omitted characters use a star; multi-character strings display their first Unicode codepoint while preserving the native source output. Character fonts, sizes and omitted colors use local defaults; exact TradingView glyph and pixel parity is not guaranteed.

Native Pine signal shapes include crosses, diamonds and flags alongside circles, squares, triangles, arrows and labels. Pane-top and pane-bottom signals follow their bars horizontally while staying at the pane edge and leaving price autoscale unchanged. Shape dimensions, text metrics and edge spacing use local canvas rules; exact TradingView pixels are not guaranteed.

## What is here

- Live and historical charts, multi-pane layouts, indicators, drawings, and order-flow views.
- Manual replay with market, limit, and stop orders, risk controls, partial exits, and session reports.
- A trade journal with accounts, imports, broker synchronization, notes, reviews, and analytics.
- Dataset discovery and scheduled market-data population for forex and crypto.
- Optional Redis caching, background analytics, telemetry, and a legacy Node API.

Journal settings support capture defaults and reusable note templates in both the modern and compatibility interfaces. Defaults merge into existing journal data, and successful saves require a server acknowledgment; private drafts and pending saves survive interface changes.

Chart and Appearance settings expose nine staged display/palette controls in both interfaces. Apply preserves hidden options and other presets while saving and activating `Settings default` atomically for the next workspace load. Density saves independently after server confirmation; Appearance reset affects density only.

Account and Privacy settings share current-session revocation and confirmed diagnostic-sharing preferences across both interfaces. Global shows actual interface/browser regional values; AI availability comes from the account’s server model catalog, with explicit offline-fixture and failure states.

Stripe billing provides server-created subscription Checkout and Customer Portal sessions, signed webhook reconciliation, and account-scoped billing status. It defaults to disabled test mode; credentials belong only on the API. The launch catalog is EdgeLab Pro at USD $29/month or $290/year, with no trial. Provider prices must match the configured plan before checkout can open. See [billing setup](backend/README.md#stripe-billing).

Production mode accepts verified Google accounts and requires a current live paid subscription for workspace APIs and streams. Data exports require that subscription in both production and beta mode. `/pricing` shows the validated server catalog, monthly/yearly choice and hosted Stripe checkout; success returns check provider status rather than grant access. `/account` remains available for billing management and sign-out without workspace access. Set both `EDGELAB_DEPLOYMENT_MODE` and `VITE_DEPLOYMENT_MODE` to `beta` for the optional capped beta workspace; the local Compose file selects beta explicitly. Live checkout remains unavailable until merchant credentials and matching provider prices are configured.

Legacy beta accounts without a Google identity can verify their exact email through Gmail or Google Workspace and retain their history; first verification revokes older sessions. Existing accounts using third-party email without Google ownership authority require separate mailbox recovery. Verification alone does not grant a paid subscription.

## Quick start

The smallest supported installation needs only Docker:

```bash
docker compose -f docker-compose.local.yml up --build -d
```

Open <http://localhost:8080>. This mode uses a single FastAPI container, SQLite, local developer sign-in, and the CSV files under `datasets/`. Application data lives in a Docker volume and survives normal container restarts.

Production images keep test-only Python packages out of the runtime, precompress browser assets during the build, and reuse one backend image across the API and worker services.

Add datasets beneath `datasets/`, then refresh the catalog from the application. Generated market data is intentionally not committed.

## Development

Use Node.js 22 or newer and Python 3.12:

```bash
npm install
python3.12 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt -r backend/requirements-dev.txt
EDGELAB_DEV_AUTH_BYPASS=1 EDGELAB_JWT_SECRET=local-dev-secret npm run dev
```

The frontend runs at <http://127.0.0.1:5173>, FastAPI at <http://127.0.0.1:8000>, and the optional compatibility API at <http://127.0.0.1:3001>.

A fresh local Vite preview can show the redesigned landing page while the API is offline. Saved rollout settings still take precedence, and workspace data requires the backend. See [frontend development](frontend/README.md) for the local preview policy.

## Verification

```bash
npm run build
PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests
npm test
sh scripts/audit-dependencies.sh
docker compose config
docker compose -f docker-compose.local.yml config
```

The UI regression workflow uses Node.js 22 and the same backend virtual environment as local development. It runs the full JavaScript and Python suites after the production build, then checks production Pine instrument sizing, per-entry exits, public fallback routes, and the existing UI gates. Provider-boundary fixtures verify checkout navigation without charging a merchant account.

## Repository map

| Path | Purpose |
| --- | --- |
| `frontend/` | React/Vite application |
| `backend/app/` | FastAPI application and services |
| `backend/alembic/` | Database migrations |
| `datasets/` | Local CSV dataset root; contents are ignored |
| `docker/` | Nginx, PgBouncer, and observability configuration |
| `e2e/` | Playwright tests and their reviewed visual baselines |
| `benchmark/` | k6 capacity tests |
| `scripts/` | Development and UI-quality tooling |

## Documentation

- [Setup and deployment](docs/setup-and-deployment.md)
- [Architecture](docs/architecture.md)
- [Configuration](docs/configuration.md)
- [API guide](docs/api-reference.md)
- [Backend development](backend/README.md)
- [Frontend development](frontend/README.md)
- [Deployment utilities](deployment/README.md)
- [Security policy](SECURITY.md)

Machine-readable UI inventories and certification records under `docs/` are test inputs. Keep them in sync with UI changes; they are not end-user documentation.
