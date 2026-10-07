# EdgeLab frontend

The native Pine foundation pins PineTS 0.11.0 and builds a separate classic worker asset with esbuild. The browser fetches that trusted asset from its own origin, then runs compilation and execution in a blob worker created inside an opaque `sandbox="allow-scripts"` frame. Its CSP denies network connections, imports and parent-origin storage; user source and results travel only as messages. The parent verifies frame identity, a cryptographic nonce and bounded result schemas, and the fixed bridge terminates/revokes its worker on completion, cancellation or timeout. These are isolation and availability controls, not a global memory/operation budget. Unsupported secondary-symbol/timeframe requests fail explicitly; data comes from the supplied local candle context.

The chart editor supports EdgeLab DSL and native Pine v5/v6. Choose a Pine template or paste source with a version header, then **Check script** to generate declared settings and enable saving. **Run** calculates the loaded chart snapshot; **Add to chart** saves source, inputs and validated metadata together. Script history and chart workspaces preserve native source and inputs. Source, input, context and account changes invalidate pending results.

Native Pine uses the active symbol’s session-filtered, aggregated chart bars, up to the latest 20,000 loaded bars. Live chart calculations exclude the forming timeframe bucket. Common line, step, area, histogram, candle and circle plots preserve placement, colors and null gaps; unsupported drawings/styles/options and more than sixteen disconnected segments per plot produce visible warnings. The runtime permits eight plots and 24 inputs. Secondary-symbol/timeframe data requests fail instead of fabricating candles.

Pine strategies use their own entries, exits, capital and cost settings. The editor and Quant show the actual engine metrics, closed trades, open positions and pending orders; open positions are not forcibly closed and pending orders are not counted as fills. Quant’s DSL crossing rules do not apply to native scripts. PineTS is experimental and strategy results must not be presented as TradingView-identical. Snapshot execution uses UTC, a 24x7 session and USD, and missing tick/point metadata falls back to 0.01/1 with warnings. Compare assumptions before relying on results.

Pine-enabled builds use AGPL-3.0-only: distribute the complete matching application source and build scripts, and offer them to service users. `LICENSE.txt` and `THIRD_PARTY_NOTICES.txt` ship as static assets and are linked from the native editor; these notices are not a substitute for matching application source. See the root notices for upstream attribution.

Compatibility mode supports canonical Journal trade paging, account filtering, direct review links, review updates, and manual account creation. Review and account saves use the same server APIs as the current interface; failed saves keep the open form for retry.

Daily notes and calendar day review work in both interfaces. Shared and account notes stay separate; drafts are keyed by owner, UTC date, and note scope. Explicit saves preserve whitespace and allow an empty replacement body. Save locks and confirmed responses survive a same-page interface switch. Linked reviews retain the selected date and account, and day trades load the complete UTC entry day in API pages before displaying 100 trades per page. Each amount retains its own currency.

The modern Journal loads the complete canonical trade history before updating dashboards, analytics, account comparisons, filters, and review queues. Immutable-ID API pages remain stable when entry times change or records are deleted during loading; later inserts appear on the next refresh. Failed refreshes keep the previous complete results, and superseded or owner-switched loads cannot replace them. Trade lists, analytics segments, position-mix legends, and underlying-trade lists display at most 100 rows per page while calculations use all matching trades.

Compatibility mode serves real canonical analytics at `/app/journal/analytics` and `/app/journal/reports`: complete-history filters, all twelve breakdown dimensions, position mix, weak spots, exact trade drill-down, and saved trade reviews. Both interfaces share validated, owner-scoped filter and selection context across reloads and interface switches; explicit linked dimensions take priority. Account scope uses the same confirmed storage API. Monetary totals, profit factors, and expectancy rankings are withheld across currencies. Compatibility analytics performs no legacy backfill. `/app/reports` remains the separate backtest reports route.

Compatibility `/app/journal/dashboard` provides full-history performance, equity, Edge Score, risk behavior, a six-week calendar, daily reflections, all nine account comparison lenses, and exact recent/queued trade reviews. Both interfaces share owner-scoped date, comparison selection, and reflection drafts. Linked dates and owned accounts take priority; unavailable dates/accounts cannot open an editor. Reflection saves preserve whitespace and empty text, require server confirmation, and retain failed drafts for retry. Balances include every selected account, including accounts without trades. Account balances and actual trade currencies must agree before monetary totals, profit factor, equity, or Edge Score are combined. Each comparison column applies the same currency check independently. Compatibility dashboard performs no legacy backfill; The modern `/app/journal` alias retains its existing Overview behavior; compatibility capability in this iteration is scoped to the exact `/app/journal/dashboard` route.

Older dashboard reflection drafts did not record their account scope. The dashboard keeps their text available in a read-only recovery field so the owner can choose the correct date and account before saving it.

Manual account and trade-review drafts use shared, authenticated-owner-scoped session storage, surviving refreshes and switches between interfaces in the same tab. Compatibility review saves acknowledge only visible fields, retaining pending execution edits for the modern drawer. Modern reviews send only edited fields; saved notes remain separate from the empty new-note editor. Successful saves clear submitted values, Cancel discards the draft, and closing a review preserves it. Broker credentials are excluded from draft storage.

The frontend is a React 18 and Vite application. It provides the public site, authentication flow, chart and replay workspaces, journal, reports, order flow, Quant assistant, settings, and shared-workspace views.

Both `/app/journal/settings` and `/app/settings/journal` provide capture defaults and review note templates in either interface. Saves report success after server confirmation; validation, independent retry, owner-scoped drafts, and pending saves survive interface switches. Only changed capture fields are sent, and journal records are preserved when other journal writes are queued during a defaults save. Settings revalidate when reopened; note templates retain their exact multiline text.

`/app/settings/backtest` provides all eleven order and replay preferences in both interfaces. Choices save immediately; valid numeric edits wait 600 ms. Each changed key requires its own server acknowledgment, so partial failures retain only unconfirmed edits for explicit retry. Owner-scoped drafts and failed-attempt recovery survive reloads and interface switches; later edits are preserved while earlier saves finish. Undo and section reset include chart-line confirmation. Confirmed sizing values prefill new orders, confirmation governs future chart-line changes, and commission/fee defaults prefill new replay sessions; existing sessions keep their own costs. Changing a cost mode preserves its inactive numeric values.

`/app/settings/chart` and `/app/settings/appearance` share all nine display and palette controls in both interfaces. They edit the existing `Settings default` preset; when absent, a new preset clones the active chart's full settings. Apply atomically saves changed controls and activates the preset for the next workspace load. Text sizes must be whole numbers from 10 to 18; up/down colors update their body aliases while preserving independent wick and border colors. Hidden options, unknown metadata, and every other preset remain intact. Owner-scoped drafts, pending saves, explicit retries, and later edits survive interface switches. Later toolbar saves and deletions wait for the atomic operation and retain their own changes.

Appearance density previews immediately, but feedback defaults and local confirmed values change only after server acknowledgment. Density saves merge only that preference and preserve diagnostic sharing. Appearance reset changes density only; Chart reset stages the nine displayed controls only. Undo restores the relevant prior draft.

Account settings in both interfaces revoke only the current browser session. EdgeLab requires `ok: true` before clearing its token and navigating to `/auth/signin`; failures preserve the session and offer Retry. Pending revocation survives interface switches, and late responses cannot clear a replacement session, including another token for the same owner.

Privacy shares the confirmed diagnostic-sharing preference, private drafts, retry, Undo, and field-scoped reset. Effective feedback defaults change only after acknowledgment; unknown preferences and density are preserved. Credential and recipient-sharing rows describe enforced boundaries. Quant requests browser microphone permission when Dictate is used; permission does not guarantee an available transcription service. Generated indicators use restricted EdgeLab DSL; arbitrary generated JavaScript/Python execution is unavailable.

Quant recording cleanup discards audio and stops microphone tracks on Cancel, panel closure, and session changes, including permission streams that arrive late. Closing the panel also aborts its pending transcription request and ignores stale results; aborting the browser request cannot retract audio already received by a provider. Empty recordings and recordings over 5 MB are rejected locally, with a 60-second recording stop timer. The transcription service remains a separate availability requirement.

Global (`/app/settings` and `/app/settings/global`) distinguishes browser language/time zone from the interface formatting locale resolved from the page language. AI (`/app/settings/ai`) loads the authenticated `/quant/models` catalog and reports live models, deterministic offline fixtures, unavailable reasons, adapter readiness, credential requirements, and supported operations. Empty catalogs and load failures remain distinct; Retry and Refresh only read availability. A late catalog response cannot reveal a previous session’s metadata. Catalog readiness is not a provider connectivity test. Quant retains server conversations and generated artifacts per conversation; new conversations use 30 days, and external requests require explicit consent for extra chart/history/image context.

Portable data accepts only explicit EdgeLab version 1 bundles and the 23 supported account tables. Local checks reject malformed rows, duplicate or unsafe record IDs, unsupported tables, and invalid creation times; the server separately validates columns and owned relationships. A downloadable server export must include every supported table and a creation time. An import reports completion only after `ok: true`, a valid completion time, and exact counts for all 23 tables, including zero for omitted tables. Transfer responses are discarded after session replacement, expiry, or sign-out.

Imports require a secure browser with Web Locks and working durable browser storage. Requests for the same account hold shared locks through their response bodies; replacement holds an exclusive lock, cancels unsent storage saves, waits for active requests, clears that owner's browser mirrors, and invalidates old page generations. Catalog discovery and replay repair reads also participate because they can write account data. Local mirrors and session drafts use the new generation after reload; preserved legacy copies cannot migrate back into restored server data. Dataset streams read committed catalog data and stop publishing when their account or generation changes. Other accounts' mirrors and authentication remain intact.

Reload and verify account data after any sent import. With Web Locks and secure UUIDs, saves reserve server receipts before sending and hold their shared account lock through body consumption and receipt verification. Lost responses and requests left by closed tabs retain bound durable markers. Imports first check all interrupted operations under the exclusive lock; a running or unverifiable receipt leaves the entire batch paused. Terminal recovery discards account mirrors and drafts, advances the generation, and requires reload before further writes. A lost import response can recover success only from a completed HTTP 200 receipt matching every submitted table count. Legacy markers without receipts remain blocked. Reloading alone does not clear uncertainty. Coordination with older clients or other devices remains pending.

Both Storage interfaces provide **Check interrupted saves** under Portable data. The check reads completion receipts without repeating a save or import; running saves, connection failures, and legacy markers keep imports paused. Completed or canceled operations clear staged transfer data and offer **Reload workspace**, keeping transfers disabled until reload. A check with no interrupted operations leaves transfers usable. The shared account transfer controller preserves staged files, confirmation, pending imports and recovery checks across interface switches. Accepted file validation may finish for the new view; detached native pickers and export downloads are suppressed. Account/session and data-generation changes discard private drafts and stale callbacks. Same-tab save completion refreshes the recovery status automatically.

Validated staged files can survive a same-tab reload through owner/generation-scoped session storage. A SHA-256 digest binds each draft to the exact stored session without retaining its token; changed sessions and invalid envelopes are rejected. Reload always clears the IMPORT confirmation. If the browser cannot retain a draft, the file stays available in memory across interface switches and the UI asks the user to choose it again after reload. Imports and terminal recovery purge staged files. The compatibility Storage deep link exposes the same controls with its existing presentation and row focus behavior.

Receipt reservation and completion checks share the existing 600-call account allowance per server window, permitting at most 300 receipted requests per minute with the default window. High-frequency replay advances retain their existing shared locks and legacy uncertainty markers without receipts, preserving playback throughput; interrupted advances cannot be automatically recovered through receipts. Raising the abuse-control allowance and enabling receipts for replay advancement remain pending explicit authorization.

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

ATR and SuperTrend follow the published [ATR smoothing](https://www.tradingview.com/support/solutions/43000501823-average-true-range-atr/) and [SuperTrend band recurrence](https://www.tradingview.com/support/solutions/43000634738-supertrend/) definitions. EdgeLab's original indicator DSL is separate from the native Pine execution path.

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
npx playwright test --config e2e/pine-runtime.config.ts
npx playwright test --config e2e/pine-editor.config.ts
```

`test:ui` is the full Playwright suite and is much slower than the build and contract checks. Update visual snapshots only after reviewing the changed images.

The dedicated Pine suite uses the already-built production worker and a loopback fixture server. Run the build first. It checks native calculations and strategy fills, denied network/parent access, result validation, message spoofing and cancellation/timeout acknowledgments. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for a specific local Chromium binary; installed Firefox/WebKit run when available.

The Pine editor suite runs the real isolated engine against loaded replay bars on desktop and mobile. It checks generated inputs, source revisions and persistence, chart overlays and panes, actual closed/open/pending strategy records, Quant runs, cancellation and stale account/context results, readable code, keyboard focus, and scrolling inside mobile ledgers. Its API fixtures supply application data; they do not replace native execution results.

The public landing uses a lazily loaded Three.js 0.186.1 scene with bounded rendering, reduced-motion support and a readable fallback when WebGL is unavailable. The Dockerfile installs the pinned workspace dependency from the root lockfile; it needs no external asset downloads at runtime. EdgeLab vector marks are available in `/brand/edgelab-mark.svg` and `/brand/edgelab-mark-mono.svg`; the favicon uses the same geometry.

The indicator editor includes a source-preserving community catalog of 21 GPL-3.0 originals by Alex Orekhov (everget). Source previews and downloads verify their packaged revision and SHA-256; imports open an unsaved draft and require preparation for saving. Upstream provenance survives user edits, history, duplication and chart snapshots. Four originals use v6 with experimental execution; 17 older originals remain inspectable and downloadable while migration is pending. See [catalog maintenance](../scripts/README.md#pine-community-catalog) for append-only upstream refreshes. The dedicated `e2e/pine-catalog.config.ts` suite checks real-engine imports, provenance, verified downloads, failure recovery and mobile controls against an already-built frontend.

Native Pine execution treats supplied bars as closed historical snapshots, including Live chart snapshots. Bar states derive from their position in that snapshot rather than wall-clock time; the final bar is confirmed historical data. Tick updates, realtime rollback and `varip` persistence between ticks remain unavailable. Preparation discloses these boundaries. Enabled `calc_on_every_tick`, `calc_on_order_fills` and `calc_on_every_history_tick` strategy settings fail with `UNSUPPORTED_EXECUTION_SETTING` after resolving their values, rather than silently running once per bar. False constant and input aliases retain normal next-bar order processing. These compatibility guards are scoped to each isolated PineTS 0.11.0 instance; they do not rewrite user source or modify global engine prototypes.
