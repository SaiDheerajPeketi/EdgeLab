# EdgeLab frontend

Compatibility mode supports canonical Journal trade paging, account filtering, direct review links, review updates, and manual account creation. Review and account saves use the same server APIs as the current interface; failed saves keep the open form for retry.

Manual account and trade-review drafts use shared, authenticated-owner-scoped session storage, surviving refreshes and switches between interfaces in the same tab. Compatibility review saves acknowledge only visible fields, retaining pending execution edits for the modern drawer. Modern reviews send only edited fields; saved notes remain separate from the empty new-note editor. Successful saves clear submitted values, Cancel discards the draft, and closing a review preserves it. Broker credentials are excluded from draft storage.

The frontend is a React 18 and Vite application. It provides the public site, authentication flow, chart and replay workspaces, journal, reports, order flow, Quant assistant, settings, and shared-workspace views.

## Run it

Install the root workspace dependencies, then start the frontend:

```bash
npm install
npm run dev:frontend
```

Vite listens on <http://127.0.0.1:5173> and proxies `/api` to FastAPI on port 8000. For the complete local development stack, use `npm run dev` from the repository root.

## Layout

| Path | Purpose |
| --- | --- |
| `src/pages/` | Public, legal, auth, and shared-workspace pages |
| `src/routes/` | Browser routes and protected-route handling |
| `src/components/` | Workspace surfaces and reusable UI |
| `src/lib/` | API clients and domain helpers |
| `src/store/` | Replay and workspace state |
| `src/workers/` | Browser workers for indicator execution |
| `public/vendor/` | Vendored browser assets required at runtime |

Workspace URLs are stable and deep-linkable. The main groups are `/app/live`, `/app/replay`, `/app/order-flow`, `/app/quant`, `/app/journal/*`, `/app/reports`, and `/app/settings/*`.

## Indicator calculations

The library includes native chart studies and 20 first-party EdgeLab DSL studies. Native and DSL ATR/RSI use Wilder smoothing with a full-period seed; ADX waits for both directional-movement and DX warmup windows. SuperTrend retains recursive trailing bands and changes direction on closing-price crossings. Flat RSI and MFI return a neutral 50; unchanged typical prices contribute to neither side of MFI.

Historical Volatility requires a complete window of valid positive-price log returns. Its `periodsPerYear` input defaults to 252 and should be set to the expected number of bars per year for the chart timeframe and market calendar. Existing two-argument `histvol(source, period)` scripts retain the 252 default; `histvol(source, period, periodsPerYear)` supports explicit annualization.

Chart VWAP follows the pane's selected exchange session, including FX/CME overnight rollover and daylight saving time. It accumulates the filtered source bars before chart aggregation, then plots the last VWAP value in each chart candle; a candle spanning rollover therefore uses the current session's source volume. Calculations without a session context retain the UTC-day default.

Custom studies use a 350 ms worker limit on Live charts and a 1,200 ms limit on Replay charts. Cancellation and every completion/error path clear timers and terminate the worker; a browser worker-start failure is shown as an indicator error.

ATR and SuperTrend follow the published [ATR smoothing](https://www.tradingview.com/support/solutions/43000501823-average-true-range-atr/) and [SuperTrend band recurrence](https://www.tradingview.com/support/solutions/43000634738-supertrend/) definitions. EdgeLab's indicator DSL is original and is not Pine Script compatible.

## Build-time configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `VITE_API_BASE_URL` | API prefix used by the browser | `/api` |
| `VITE_API_BEARER_TOKEN` | Optional token for protected non-user routes | empty |
| `VITE_DEPLOYMENT_MODE` | `beta` or `production` marketing mode | `beta` |
| `VITE_BETA_SEATS_TOTAL` | Fallback beta capacity shown before API hydration | `500` |
| `VITE_BETA_SEATS_TAKEN` | Fallback occupied-seat count | `0` |

These values are compiled into the bundle. Rebuild the frontend after changing them.

The production image precompresses JavaScript, CSS, HTML, JSON, and SVG output once at build time. Nginx serves those files directly and keeps fingerprinted assets cached for one year.

## Checks

From the repository root:

```bash
npm run build
npm run quality:ui
npm run test:ui
```

`test:ui` is the full Playwright suite and is much slower than the build and contract checks. Update visual snapshots only after reviewing the changed images.
