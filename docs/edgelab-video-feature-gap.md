# EdgeLab feature implementation backlog

## Executive verdict

EdgeLab already has a substantial foundation: manual live journaling, replay/backtesting, trade review notes and screenshots, reports, multiple live watchlists, real-time OHLCV feeds, common indicators, drawing tools, chart settings, named layouts, and 1/2/4-chart views.

It is not yet at feature parity with the two reference videos. The largest gaps are:

1. A journal that is docked directly beside the chart, with broker-connected trade synchronization.
2. Review fields and journal analytics such as reviewed state, rating, Edge Score, risk behavior, asset/direction/holding-time analysis, daily notes, and account comparison.
3. True order-flow data and footprint/TPO visualization, including CME futures.
4. Up to 16 independently configurable charts with selective synchronization and shareable workspaces.
5. A Quant-style AI assistant, chart-image analysis, voice input, and an AI-editable custom-indicator runtime.
6. A product-wide UI/UX revamp so the landing page, settings, navigation, forms, dashboards, and utility screens share the same modern, vibrant, fluid EdgeLab identity as the strongest parts of the charting app.

The combined backlog identifies **229 concrete implementation items**: 72 foundation items (`P0`), 144 core-parity or core-experience items (`P1`), nine power-user items (`P2`), and four reference-roadmap items (`P3`). Of these, 102 extend something EdgeLab already has and 127 are currently missing.

The checklist below combines the exhaustive functional backlog found by comparing the videos with the current application and the requested product-wide UI/UX revamp. Items explicitly described as “coming soon” in the videos are separated from features demonstrated as available; the redesign workstream is separately identified so visual modernization is not mistaken for LuxAlgo feature parity.

## Audit scope

Reference videos:

- [A Trading Journal Built Into Your Charts](https://www.youtube.com/watch?v=mk7Krpbt8gQ) — LuxAlgo, 8:12.
- [A Breakdown Of The Most Advanced Charting Platform Ever Built](https://www.youtube.com/watch?v=ycW3toifDHg) — LuxAlgo, 12:56.

EdgeLab was reviewed at commit `5162b10`, using the actual frontend/backend source, API documentation, and exported application screens. The most relevant implementation files were:

- `frontend/src/components/EdgeLabWorkspace.tsx`
- `frontend/src/components/TradingChart.tsx`
- `frontend/src/components/ChartToolbar.tsx`
- `frontend/src/components/ChartObjectsPanel.tsx`
- `frontend/src/components/Sidebar.tsx`
- `frontend/src/components/marketing/MarketingShell.tsx`
- `frontend/src/components/marketing/HeroDemo.tsx`
- `frontend/src/pages/LandingPage.tsx`
- `frontend/src/styles.css`
- `frontend/src/lib/charting.ts`
- `frontend/src/lib/chartLayouts.ts`
- `frontend/src/lib/chartSettings.ts`
- `backend/app/models.py`
- `backend/app/api/routes.py`
- `backend/app/services/backtester.py`

YouTube blocked the downloadable video streams during the audit, so the video comparison uses the complete timestamped English captions and YouTube chapter metadata. The video-derived list covers every explicitly demonstrated or narrated function. The UI/UX section is an EdgeLab redesign specification, not a request to clone LuxAlgo's copyrighted visual treatment.

### Status and priority legend

- `Partial`: EdgeLab has related functionality, but not the complete behavior shown.
- `Missing`: no matching production implementation was found.
- `P0`: foundation or dependency for several downstream features.
- `P1`: core reference-video parity.
- `P2`: advanced workflow or power-user parity.
- `P3`: the reference video itself labels the feature as future/coming soon.

## What EdgeLab already has — do not rebuild

- Manual Journal accounts with name, broker label, currency, color, starting balance, notes, archive/restore/delete, account P&L, balance, win rate, drawdown, equity, and recent trades.
- Taken and missed Journal entries, multiple account links, long/short direction, entry/exit time and price, size, stop, target, R multiple, strategy, playbook, emotion, mistake tags, rich notes, commission, brokerage/fees, and screenshot attachment.
- Journal trade editing/deletion; account, session, direction, strategy, entry-type, and free-text filtering.
- Journal dashboard cards, recent trades, account balance, calendar heatmap, drawdown, profit factor, and separate day/week review.
- Journal reports for performance, account breakdown, day/time, R-multiple risk, strategy, and missed-trade clusters.
- Trade-linked notes and screenshots, including image copy/open actions.
- Backtest/replay sessions, market/limit/stop orders, long/short positions, stop/target, risk sizing, breakeven, partial exits, costs, metrics, reports, replay-to-trade navigation, and trade overlays on the replay chart.
- A capable CSV importer for completed backtests, with preview, automatic/manual column mapping, Tradovate/NinjaTrader recognition, costs, tags, notes, stops, targets, and skipped-row reporting. It currently imports into Backtest, not the live Journal.
- Multiple create/rename/delete watchlists and symbol search across Binance spot, Dukascopy cross-asset instruments, and Angel One SmartAPI instruments.
- Live OHLCV charts and an on-chart data display for date/time, open, high, low, close, volume, and bar change.
- Major and custom aggregatable timeframes, keyboard interval entry, and candles, Heikin Ashi, line, and area styles.
- Single, two-column, two-row, and four-chart layouts. Each pane already has its own timeframe, style, settings, drawings, and indicators.
- Named chart layouts and chart-settings templates, persisted through app storage.
- Seventeen built-in studies: EMA, SMA, WMA, DEMA, TEMA, HMA, VWAP, Bollinger Bands, Donchian Channel, Keltner Channel, SuperTrend, RSI, MACD, ATR, Momentum, FVG, and inverse FVG.
- Cursor/crosshair, trend line, horizontal line, vertical line, rectangle/zone, Fibonacci retracement, measure, long-position, short-position, and text tools.
- Weak/strong OHLC magnet modes, drawing undo, selection, editing, visibility, locking, deletion, styling, and an Objects/Layers panel.
- Chart visual settings, saved presets, indicator settings, full-screen chart mode, and a basic right-click menu.

## Implementation backlog

### 1. Integrated chart and journal experience

- [ ] `JRN-01 · P0 · Partial` — Add a dockable, collapsible, resizable Journal panel directly beside both Live and Replay charts; the current Journal is a separate workspace.
- [x] `JRN-02 · P1 · Missing` — Add compact and expanded Journal modes, preserving the current chart, selected symbol, time range, account scope, and open trade when switching modes.
- [x] `JRN-03 · P0 · Missing` — Create a common right-panel manager for Journal, Watchlist, Quant chat, Data Window, Objects, and code editor panels, including open/close and width persistence.
- [x] `JRN-04 · P0 · Partial` — Add one persistent account-scope control—All Accounts, one account, or selected accounts—and apply it consistently to dashboard, trades, calendar, notes, and analytics. Current filters are page-specific.
- [x] `JRN-05 · P1 · Missing` — Preserve deep links between chart, trade, calendar day, daily note, analytics segment, and account so every drill-down can return to its originating context.
- [x] `JRN-06 · P1 · Missing` — Add first-run Journal onboarding with the add-account prompt shown in the reference.
- [x] `JRN-07 · P2 · Missing` — Add an optional sample-trades import/reset flow for evaluating the Journal before connecting or importing a real account.

### 2. Broker accounts, synchronization, CSV ingestion, and manual entry

- [x] `ACC-01 · P0 · Missing` — Build a broker/integration catalog grouped by crypto, stocks/options, futures, and other supported markets instead of a free-text broker field.
- [x] `ACC-02 · P0 · Missing` — Build the broker-account connection flow: provider selection, authorization/API credentials, account discovery, account selection, initial synchronization, and disconnect/reconnect.
- [x] `ACC-03 · P0 · Missing` — Synchronize connected accounts and closed trades automatically in near real time.
- [x] `ACC-04 · P1 · Missing` — Add an explicit Refresh action plus last-synced time, connection state, pending state, and provider error/recovery messages.
- [x] `ACC-05 · P0 · Missing` — Implement incremental synchronization using provider trade/order IDs and cursors so repeated refreshes are idempotent.
- [x] `ACC-06 · P0 · Missing` — Reconcile fills and partial fills into closed trades, including scaling in/out, commissions, fees, corrections, cancelled orders, and provider-side edits.
- [x] `ACC-07 · P0 · Partial` — Reuse the existing Backtest CSV parser as a true Journal/account import path; imported trades must populate Journal accounts, dashboard, calendar, notes, comparison, and analytics.
- [x] `ACC-08 · P1 · Partial` — Add Journal import presets and instructions for broker exports, including the Tradovate “export Orders, not Performance” workflow demonstrated in the video.
- [x] `ACC-09 · P1 · Partial` — Extend import review with destination account create/select, source timezone, currency, symbol normalization, previewed trade grouping, duplicate detection, and editable mapping.
- [x] `ACC-10 · P1 · Missing` — Add a durable import history with imported/skipped/duplicate/error counts, row-level diagnostics, and safe rollback of one import.
- [x] `ACC-11 · P1 · Partial` — Add a global quick “Add trade” action that does not require pre-creating or entering a Journal session.
- [x] `ACC-12 · P1 · Partial` — Complete manual-entry parity: account, symbol/contract, buy/sell or long/short, quantity, entry and exit fills/times, prices, costs, stop, target, tags, rating, grade, and notes.

### 3. Trade model, review workflow, and chart linkage

- [x] `TRD-01 · P0 · Partial` — Normalize imported broker orders/fills and manually entered executions into a single canonical trade record while retaining the raw execution trail.
- [x] `TRD-02 · P1 · Missing` — Add a persistent reviewed/unreviewed state and review queue.
- [x] `TRD-03 · P1 · Missing` — Add a 1–5 star trade rating.
- [x] `TRD-04 · P1 · Missing` — Add a formal setup/quality grade such as A+, A, B, and C; do not overload mistake tags for this.
- [x] `TRD-05 · P1 · Partial` — Generalize current mistake tags into reusable positive/setup tags and mistake/process tags, with custom tag management.
- [x] `TRD-06 · P1 · Partial` — Add a dedicated multi-select tag filter. Current free-text search can match tags but cannot compose precise tag filters.
- [x] `TRD-07 · P1 · Partial` — Extend the trade-review editor to save reviewed state, rating, setup grade, generalized tags, entry, exit, stop, target, notes, and screenshots together.
- [ ] `TRD-08 · P0 · Partial` — Add “show on chart” for live/imported Journal trades. EdgeLab has replay-trade focusing, but Journal trades cannot currently drive the Live chart.
- [ ] `TRD-09 · P0 · Missing` — On chart navigation, load the correct symbol and historical interval, center the exact entry/exit period, and draw entry, exit, stop, target, direction, and fill markers.
- [x] `TRD-10 · P1 · Partial` — Use the same review drawer from trade list, recent trades, calendar day, account view, comparison, analytics drill-down, and chart marker.

### 4. Journal dashboard, calendar, daily notes, and account comparison

- [ ] `DSH-01 · P1 · Partial` — Make the main dashboard account-scope aware and show aggregate net/gross P&L, win rate, profit factor, trade count, costs, balance, and drawdown for that scope. It currently emphasizes the latest day and all active accounts.
- [ ] `DSH-02 · P1 · Partial` — Add the main dashboard equity curve; equity exists elsewhere but not in the Journal command-center layout shown in the video.
- [ ] `DSH-03 · P1 · Missing` — Implement Edge Score comparing a recent period with the immediately preceding equivalent period.
- [ ] `DSH-04 · P1 · Missing` — Define and expose the Edge Score components, comparison window, change direction, confidence/sample size, and explanation instead of presenting an opaque score.
- [ ] `DSH-05 · P1 · Missing` — Add a risk-behavior panel using measurable behavior such as planned-versus-actual risk, stop adherence, oversizing, loss escalation, and rule/tag violations.
- [ ] `DSH-06 · P1 · Partial` — Make dashboard calendar cells clickable and open the selected day’s trades and note; the separate Day View already supports day selection.
- [ ] `DSH-07 · P1 · Partial` — Make dashboard recent trades clickable and open the shared review flow.
- [x] `DSH-08 · P0 · Missing` — Add a Daily Note entity independent of a trade, keyed by date and optional account scope, so no-trade days can also be journaled.
- [ ] `DSH-09 · P1 · Missing` — Create/edit a daily note from the dashboard calendar and Day View.
- [ ] `DSH-10 · P1 · Missing` — Automatically display every trade for that date inside its Daily Note and link each one to review/chart.
- [ ] `DSH-11 · P1 · Partial` — Expand Notes into a searchable daily-notes library while retaining the current trade-note library; include account/date filters and empty/no-trade days.
- [ ] `DSH-12 · P1 · Missing` — Add two independent account selectors for side-by-side comparison.
- [ ] `DSH-13 · P1 · Missing` — Compare the two accounts across KPI cards, equity curves, calendar, drawdown, costs, directions, symbols/markets, times, hold durations, sizes, tags, ratings, and strategies.
- [ ] `DSH-14 · P0 · Missing` — Define mixed-currency behavior for aggregate and comparison views: explicit non-combinable mode or dated FX normalization with the rate/source shown.

### 5. Journal analytics and weak-spot discovery

- [ ] `ANL-01 · P1 · Partial` — Add shared date-range, account, symbol/market, strategy, and tag filters across every Journal analytics view.
- [ ] `ANL-02 · P1 · Missing` — Add performance breakdown by market/asset class.
- [ ] `ANL-03 · P1 · Missing` — Add performance breakdown by symbol/contract.
- [ ] `ANL-04 · P1 · Missing` — Add long-versus-short direction analysis.
- [ ] `ANL-05 · P1 · Missing` — Add holding-duration buckets and best/worst duration analysis.
- [ ] `ANL-06 · P1 · Missing` — Add position-size or risk-size buckets and best/worst size analysis.
- [ ] `ANL-07 · P1 · Missing` — Add tag-level performance, frequency, win rate, expectancy, P&L, and sample size.
- [ ] `ANL-08 · P1 · Missing` — Add rating-level performance and correlation between rating/grade and results.
- [ ] `ANL-09 · P1 · Missing` — Add “positions by market” and “positions by symbol” asset-mix pie/donut charts.
- [ ] `ANL-10 · P1 · Partial` — Add a consolidated weak-spots summary ranking best/worst weekday, hour, market, symbol, direction, hold duration, position size, tag, rating, and account. EdgeLab currently has only some of these dimensions.
- [ ] `ANL-11 · P1 · Missing` — Show gross result, transaction costs, and net result within every relevant breakdown so the user can identify what costs the most.
- [ ] `ANL-12 · P2 · Missing` — Make each analytics row/bar/segment drill into the exact matching trades and shared review flow.

### 6. Core chart shell, instruments, sessions, and live data

- [x] `CHT-01 · P1 · Partial` — Put symbol selection in the chart’s main toolbar instead of requiring interaction with the separate watchlist column.
- [x] `CHT-02 · P1 · Missing` — Add type-anywhere symbol search when the chart has focus, with keyboard selection and no conflict with timeframe/drawing shortcuts.
- [x] `CHT-03 · P0 · Partial` — Create one normalized symbol universe across crypto, equities, ETFs, forex, indices, commodities, futures, options/derivatives, and provider-specific identifiers.
- [ ] `CHT-04 · P0 · Missing` — Add real-time and historical CME futures data, including the nano-futures coverage called out in the video.
- [x] `CHT-05 · P0 · Missing` — Add exchange calendars, futures contract metadata, tick size/value, session templates, expiration, and continuous-contract roll logic.
- [x] `CHT-06 · P1 · Missing` — Add a Regular Trading Hours versus Extended Trading Hours toggle and use it consistently for rendering and indicator calculations.
- [x] `CHT-07 · P1 · Missing` — Add per-symbol pre-market/post-market background highlighting controls.
- [x] `CHT-08 · P1 · Missing` — Add a chart timezone selector, default it to UTC, format chart/data-window times in it, and persist it in the workspace.
- [x] `CHT-09 · P1 · Partial` — Add “Chart settings” to the right-click menu. EdgeLab has a settings button and a minimal context menu, but not this shortcut.
- [x] `CHT-10 · P0 · Partial` — Harden live-feed continuity with normalized timestamps, sequence/gap detection, reconnect/backfill, stale-data state, and provider health. EdgeLab currently has provider-specific polling/socket behavior and a limited cache.

### 7. Order flow, footprint, TPO, and advanced chart types

- [ ] `OFL-01 · P0 · Missing` — Build or license a tick/trade feed with aggressor side, price, size, exchange timestamp, and historical retrieval; OHLCV candles alone cannot produce the demonstrated footprint.
- [x] `OFL-02 · P0 · Missing` — Build the price-by-bar aggregation service for bid volume, ask volume, total volume, delta, trade count, and average trade size.
- [x] `OFL-03 · P0 · Missing` — Add Footprint as a first-class chart style and load it directly from the chart-style menu.
- [x] `OFL-04 · P1 · Missing` — Implement zoom-aware footprint detail so cells appear at usable zoom levels and degrade cleanly when zoomed out.
- [x] `OFL-05 · P1 · Missing` — Add bid/ask ladder display mode.
- [x] `OFL-06 · P1 · Missing` — Add per-bar volume profile display mode.
- [x] `OFL-07 · P1 · Missing` — Add per-bar delta profile display mode.
- [x] `OFL-08 · P1 · Missing` — Add absolute-delta display mode.
- [x] `OFL-09 · P1 · Missing` — Add footprint positioning/alignment controls and average-trade-size display.
- [x] `OFL-10 · P1 · Missing` — Add footprint color controls and reusable footprint templates.
- [x] `OFL-11 · P1 · Missing` — Detect and highlight configurable bid/ask imbalances, including thresholds and stacked imbalances.
- [x] `OFL-12 · P1 · Missing` — Detect and mark unfinished auctions.
- [x] `OFL-13 · P1 · Missing` — Add the optional footprint statistics table and allow its displayed metric to switch, including average trade size.
- [x] `OFL-14 · P1 · Missing` — Add TPO/Market Profile as a first-class chart style with session, bracket, profile, value-area, and point-of-control settings.
- [x] `OFL-15 · P1 · Missing` — Add order-flow-based indicators to the indicator catalog and make their values available to tooltips, object management, saved layouts, and AI context.

### 8. Multi-chart layouts, synchronization, workspaces, screenshots, and sharing

- [x] `LAY-01 · P1 · Partial` — Expand chart layouts from a maximum of four panes to a maximum of 16, including an explicit **4×4 grid** preset plus other useful arrangements and responsive sizing.
- [ ] `LAY-02 · P0 · Missing` — Give every pane its own symbol/data subscription. Current panes share the selected watchlist symbol and candle set.
- [x] `LAY-03 · P1 · Missing` — Add independent synchronization toggles for symbol, interval, crosshair, and chart style.
- [x] `LAY-04 · P1 · Missing` — Synchronize crosshair time/price and visible range across selected panes when enabled.
- [x] `LAY-05 · P1 · Missing` — Add “sync drawings across charts,” with a clear symbol/timeframe mapping policy.
- [x] `LAY-06 · P1 · Partial` — Expand named layouts into full workspaces containing symbols, intervals, styles, colors/settings, drawings, indicators, pane grid, panel arrangement, watchlist selection, timezone, and RTH/ETH state. Current named layouts save chart-pane state only.
- [x] `LAY-07 · P2 · Partial` — Add workspace duplicate, rename, default/startup selection, and conflict-safe autosave/recovery in addition to current save/load/delete.
- [x] `LAY-08 · P1 · Missing` — Add the three demonstrated sharing scopes: chart plus panel, panels only, and complete chart layout/workspace.
- [x] `LAY-09 · P0 · Missing` — Store versioned, immutable share snapshots with access controls, expiry/revocation, and an “open as copy” workflow.
- [x] `LAY-10 · P1 · Missing` — Add a chart screenshot action that captures the whole chart cleanly and downloads a PNG; trade snapshot attachments are not equivalent.

### 9. Drawing tools, favorites, quick actions, and object layers

- [x] `DRW-01 · P1 · Partial` — Expand line tools beyond one trend line and horizontal/vertical lines: ray, extended line, segment, angle, horizontal ray, and parallel channel.
- [x] `DRW-02 · P1 · Partial` — Expand the single Fibonacci retracement into the needed Fibonacci family, with configurable saved levels and styles.
- [x] `DRW-03 · P1 · Missing` — Add multi-point chart-pattern tools.
- [x] `DRW-04 · P1 · Missing` — Add Elliott Wave tools.
- [x] `DRW-05 · P1 · Missing` — Add harmonic-pattern tools.
- [x] `DRW-06 · P1 · Missing` — Add freehand brush/path drawing.
- [x] `DRW-07 · P1 · Missing` — Add arrows and geometric shapes.
- [x] `DRW-08 · P1 · Partial` — Add callout/comment tools distinct from the current one-anchor text label.
- [x] `DRW-09 · P1 · Missing` — Add flags and a searchable icon/emoji marker library.
- [x] `DRW-10 · P2 · Partial` — Add the demonstrated quick-measure gesture/action; the standard two-click Measure tool already exists.
- [x] `DRW-11 · P2 · Partial` — Add a visible quick eraser that deletes a targeted object; keyboard delete/current clear-all behavior is not the same workflow.
- [x] `DRW-12 · P1 · Missing` — Add persistent/stay-in-drawing mode. EdgeLab currently returns to cursor/crosshair after each completed drawing.
- [x] `DRW-13 · P2 · Missing` — Allow the left drawing rail to be hidden/collapsed while leaving shortcuts available.
- [x] `DRW-14 · P2 · Missing` — Add user favorites for drawing tools and persist their order.
- [x] `DRW-15 · P2 · Missing` — Add the **circular chart toolbox** shown in the video: an Alt/Option radial quick wheel populated from favorite tools, with mouse selection and a keyboard-accessible fallback.
- [x] `DRW-16 · P1 · Partial` — Add drag reordering/z-order in the Objects tree plus bring forward/back/front/back actions. Current objects can be selected, hidden, locked, edited, or deleted but not layered.

### 10. Indicator catalog and custom indicator source

- [ ] `IND-01 · P1 · Partial` — Expand the 17-study catalog into a broad first-party professional library. Build original equivalents; do not copy LuxAlgo’s proprietary code or branding.
- [x] `IND-02 · P1 · Partial` — Replace the flat indicator menu with searchable categories for basic, volatility, momentum, structure, volume, order flow, custom, and favorites.
- [x] `IND-03 · P1 · Missing` — Add preview images/cards and concise behavior descriptions for each indicator.
- [x] `IND-04 · P1 · Missing` — Add indicator favorites and a fast favorites strip/quick-add control.
- [ ] `IND-05 · P0 · Missing` — Add a Pine-compatible editor or a documented EdgeLab indicator DSL/runtime; Pine itself requires a deliberate compatibility/licensing decision.
- [ ] `IND-06 · P0 · Missing` — Compile/evaluate custom indicators in an isolated, resource-limited worker with deterministic historical and live updates.
- [ ] `IND-07 · P1 · Missing` — Add editor syntax highlighting, autocomplete, diagnostics, version history, save/rename/duplicate/delete, and reusable user scripts.
- [ ] `IND-08 · P1 · Missing` — Add “Add to chart,” settings/input generation, object-tree integration, saved-workspace persistence, and clear runtime-error states for custom indicators.

### 11. Quant-style AI, voice, chart vision, and AI-generated studies

- [ ] `AI-01 · P0 · Missing` — Add a docked Quant assistant on the chart rather than a separate generic help surface.
- [ ] `AI-02 · P0 · Missing` — Persist and list both chart-analysis conversations and backtest/indicator-building conversations.
- [ ] `AI-03 · P0 · Missing` — Stream assistant responses and expose queued/running/completed/failed/cancelled generation states.
- [ ] `AI-04 · P0 · Missing` — Supply structured chart context: symbol, provider, timeframe, timezone, visible/history bars, session mode, active indicators, settings, drawings, selected objects, and selected region.
- [ ] `AI-05 · P1 · Missing` — Add a model selector for supported AI models.
- [ ] `AI-06 · P1 · Missing` — Show the per-model token/credit/cost policy before use and display actual usage afterward.
- [ ] `AI-07 · P1 · Missing` — Add microphone dictation with recording/transcription state, edit-before-send, cancellation, and permission/error handling.
- [ ] `AI-08 · P0 · Missing` — Generate a custom indicator from natural language or dictation and write the source into the indicator editor.
- [ ] `AI-09 · P1 · Missing` — Allow iterative follow-up edits in the same conversation while retaining the prior source, chart context, and test result.
- [ ] `AI-10 · P1 · Missing` — Let the assistant add the generated indicator to the active chart and expose its settings immediately.
- [ ] `AI-11 · P0 · Missing` — Automatically backtest a generated study over a stated window—the demonstration uses 60 days—with configurable symbol, timeframe, rules, costs, and sample range.
- [ ] `AI-12 · P1 · Missing` — Return reproducible backtest assumptions, metrics, warnings, source version, and rerun controls instead of only prose.
- [ ] `AI-13 · P0 · Missing` — Send a full-chart screenshot and its structured chart context directly to the assistant.
- [ ] `AI-14 · P1 · Missing` — Add chart-image analysis that can return a reasoned daily bias, relevant levels, invalidation, uncertainty, and risk warning.
- [ ] `AI-15 · P1 · Missing` — Let the assistant offer to turn analysis into an indicator, write the source, add it to the chart, and update real-time score/probability labels.
- [ ] `AI-16 · P1 · Missing` — Add the star/capture tool: drag-select a chart region, enter text or dictate without first opening chat, and send the cropped image plus prompt to Quant.
- [ ] `AI-17 · P0 · Missing` — Isolate generated code and model tools with time/memory limits, permission boundaries, audit records, prompt/data-retention controls, and safe failure recovery.
- [ ] `AI-18 · P0 · Missing` — Add server-side provider routing, encrypted API credentials, per-user quotas, rate limits, cancellation, usage accounting, and cost ceilings.

### 12. Features explicitly announced as future in the reference videos

These belong in the product roadmap but should not be treated as prerequisites for matching the videos’ currently available feature set.

- [ ] `RDM-01 · P3 · Missing` — Add an Order Book panel with live depth, ladder controls, aggregation, and provider availability states. The chart video says this tab is “coming.”
- [ ] `RDM-02 · P3 · Missing` — Add an Alerts panel and alert engine. The chart video says alerts are “coming.”
- [ ] `RDM-03 · P3 · Missing` — Add direct Tradovate account synchronization. The journal video presents CSV import now and direct integration as later work.
- [ ] `RDM-04 · P3 · Missing` — Add direct NinjaTrader account synchronization. The journal video presents CSV import now and direct integration as later work.

### 13. Required platform work that makes the visible features reliable

- [ ] `PLT-01 · P0 · Partial` — Move production Journal data from one app-storage JSON document into relational, user-scoped entities for accounts, connections, trades, fills, tags, reviews, ratings, daily notes, imports, and sync cursors.
- [x] `PLT-02 · P0 · Missing` — Add a migration/backfill path from existing Journal app storage and imported Backtest sessions without losing user data.
- [x] `PLT-03 · P0 · Missing` — Store broker credentials/tokens in an encrypted secret store; never persist them in browser storage or logs. Add rotation and revocation.
- [ ] `PLT-04 · P0 · Missing` — Add background jobs/webhooks with retries, dead-letter handling, idempotency, rate-limit backoff, provider audit logs, and sync observability.
- [x] `PLT-05 · P0 · Missing` — Build normalized market-data storage/streaming for candles, trades, depth, footprint aggregates, historical backfill, and multi-pane fan-out.
- [x] `PLT-06 · P0 · Missing` — Add data/provider entitlements and billing gates for free crypto/equity/ETF order flow versus paid futures access, matching the commercial behavior described in the video.
- [ ] `PLT-07 · P0 · Missing` — Add durable storage for custom scripts, AI conversations, generated artifacts, full workspaces, and share snapshots with explicit ownership.
- [ ] `PLT-08 · P0 · Missing` — Add focused automated coverage for import reconciliation, broker sync idempotency, rating/notes analytics, market session/timezone behavior, footprint aggregation, 16-pane synchronization, share permissions, AI usage accounting, and generated-code isolation.
- [ ] `PLT-09 · P1 · Partial` — Add user-visible diagnostics and recovery for stale feeds, incomplete history, unsupported symbols, sync/import conflicts, indicator runtime errors, AI failures, and expired/revoked shares.

### 14. Product-wide UI/UX revamp

This is a replacement visual-and-interaction workstream for EdgeLab, not a LuxAlgo skin. Preserve EdgeLab's product truth, workflows, chart affordances, dark trading-terminal character, electric-cyan identity, data density, and existing good behavior. Replace the dated and fragmented presentation across the whole product. “Vibrant” should come from deliberate color fields, live data, contrast, depth, and authored moments—not random neon gradients or glass on every surface. “Flowy” should come from clear hierarchy, spatial continuity, responsive layouts, and purposeful motion—not animation that delays trading tasks.

Use two expression levels inside one system:

- **Landing and public pages — Persuade:** memorable, confident, visually expressive, product-demonstrative, and centered on a clear action.
- **Authenticated app and settings — Operate:** fast, restrained, information-dense, predictable, keyboard-friendly, and calm during repeated use.

#### 14.1 Visual direction and design-system foundation

- [ ] `UIR-01 · P0 · Partial` — Inventory every route, panel, modal, menu, empty state, loading state, and error state; capture desktop, tablet, and mobile baselines and label each surface as retain, restyle, restructure, or replace.
- [ ] `UIR-02 · P0 · Missing` — Produce and approve three production-grade cross-product direction studies before implementation, each showing the landing first viewport plus a dense authenticated screen and settings screen; choose one coherent EdgeLab world, not separate themes per page.
- [ ] `UIR-03 · P0 · Missing` — Record durable product truth before the redesign and document the implemented visual system afterward, including the chosen direction, protected product behaviors, route-specific intent, and explicit non-goals.
- [ ] `UIR-04 · P0 · Partial` — Consolidate semantic design tokens for backgrounds, surfaces, raised layers, borders, text, accents, focus, status, charts, spacing, radii, elevation, blur, and motion; migrate repeated one-off hex/RGBA and utility combinations in changed surfaces.
- [ ] `UIR-05 · P0 · Partial` — Expand the current near-black/cyan palette into an accessible vibrant system with named roles for interaction, selection, information, profit, loss, warning, neutral, and chart series; keep the existing no-purple differentiator unless the brand direction is explicitly changed.
- [ ] `UIR-06 · P0 · Partial` — Establish a responsive typography system for expressive public-page display type, workhorse application text, compact labels, and tabular financial data, with defined weights, line heights, truncation, and numeric alignment.
- [ ] `UIR-07 · P0 · Partial` — Define one spacing, grid, sizing, and density system covering marketing sections, page scaffolds, app chrome, side panels, forms, cards, tables, chart toolbars, and 1-to-16-pane layouts.
- [ ] `UIR-08 · P1 · Partial` — Define a restrained material and elevation language for base, inset, floating, modal, and selected surfaces so hierarchy does not depend on repeated white borders and near-identical dark cards.
- [ ] `UIR-09 · P0 · Partial` — Build shared, accessible primitives for buttons, icon buttons, fields, selects, comboboxes, toggles, checkboxes, radios, sliders, segmented controls, tabs, cards, tables, badges, tooltips, menus, popovers, dialogs, drawers, banners, and toasts.
- [ ] `UIR-10 · P0 · Partial` — Specify and implement every component state—default, hover, pressed, focused, selected, disabled, read-only, loading, success, warning, error, and destructive—with consistent feedback and no color-only meaning.
- [ ] `UIR-11 · P1 · Partial` — Standardize icon family, stroke weight, optical size, filled/outline usage, button sizing, labels, and tooltip rules; replace ambiguous icon-only actions or give them accessible names and discoverable help.
- [ ] `UIR-12 · P0 · Partial` — Define one data-visualization language for chart series, P&L, benchmark/comparison, selections, annotations, calendars, heatmaps, distributions, and low-sample states, including color-blind-safe alternatives.
- [ ] `UIR-13 · P1 · Partial` — Create a product vocabulary and UX-copy pass so “Journal,” “Backtest,” “Replay,” “session,” “account,” “workspace,” “layout,” “settings,” and status messages are named consistently and written in direct, human language.
- [ ] `UIR-14 · P0 · Missing` — Add a browsable component/state catalog with representative financial data, long labels, validation, loading, and empty cases so new feature teams reuse the system instead of reintroducing legacy patterns.

#### 14.2 App shell, navigation, and spatial continuity

- [x] `UIR-15 · P0 · Partial` — Rebuild the authenticated app around one modern shell shared by Live, Replay, Journal, Reports, settings, and future Quant/order-flow tools while preserving the active symbol, session, account scope, and working context.
- [x] `UIR-16 · P0 · Partial` — Simplify information architecture and navigation naming; group destinations by user job, remove duplicate routes to the same concept, and keep advanced tools discoverable without overwhelming the primary flow.
- [x] `UIR-17 · P1 · Partial` — Modernize the desktop sidebar with calmer grouping, unmistakable active state, intentional collapsed/expanded behavior, stable icon positions, useful hover labels, and no layout jump when it expands.
- [x] `UIR-18 · P1 · Missing` — Add a purpose-built tablet/mobile navigation pattern—compact rail, bottom navigation, or sheet as appropriate—instead of merely hiding the desktop sidebar below the large breakpoint.
- [ ] `UIR-19 · P1 · Partial` — Create a contextual page/workspace header that consistently exposes location, title, active scope, connection/data status, primary actions, and a return path without duplicating giant page headers.
- [ ] `UIR-20 · P1 · Missing` — Add a global command palette/search that can navigate screens, switch symbols/workspaces/accounts, find trades and notes, open settings, run safe actions, and surface keyboard shortcuts.
- [ ] `UIR-21 · P1 · Partial` — Preserve scroll position, selected row, open panel, filters, chart viewport, and unsaved draft where appropriate when navigating between chart, Journal, reports, review, and settings; support shareable deep links.
- [ ] `UIR-22 · P0 · Partial` — Unify right panels, inspectors, drawers, split views, and docked tools behind one resizable panel system with predictable close/back behavior, width persistence, minimum sizes, and collision rules.
- [ ] `UIR-23 · P0 · Partial` — Centralize layering, focus trapping, outside-click, Escape, scroll locking, portal placement, and viewport collision handling for menus, select lists, tooltips, color pickers, popovers, dialogs, and radial tools.
- [ ] `UIR-24 · P1 · Partial` — Provide coherent compact, comfortable, full-screen, and multi-pane density behavior so controls remain usable from laptop to ultrawide without wasting space or shrinking hit targets.
- [ ] `UIR-25 · P1 · Partial` — Consolidate profile, plan/entitlement, data-provider status, help, feedback, release information, and sign-out into a polished account/system menu rather than isolated footer controls.
- [ ] `UIR-26 · P2 · Missing` — Add an always-current shortcut reference and contextual shortcut hints for charting, replay, Journal, navigation, layouts, drawings, and the Alt/Option circular toolbox.

#### 14.3 Landing and public experience — Persuade mode

- [x] `UIR-27 · P0 · Partial` — Replace the landing first viewport with a clear product thesis, an immediate view of EdgeLab doing real work, one dominant CTA, one lower-commitment secondary action, and legible beta/waitlist status.
- [ ] `UIR-28 · P1 · Partial` — Turn the hero demo into a faithful, responsive product demonstration of the real chart–replay–journal–review loop; use realistic or clearly labeled synthetic data and keep controls understandable without prior product knowledge.
- [x] `UIR-29 · P1 · Partial` — Recompose the landing page as a paced story—capture context, execute/replay, journal, review, discover patterns, improve—with visual continuity between sections instead of disconnected feature blocks.
- [ ] `UIR-30 · P1 · Partial` — Author a distinctive EdgeLab visual world for marketing using confident scale, richer but controlled color, purposeful depth, custom diagrams/product crops, and one signature interaction; avoid generic glowing SaaS cards and decorative orbits as the main idea.
- [x] `UIR-31 · P1 · Partial` — Vary section composition, density, and rhythm; use full-width demonstrations, annotated workflows, comparison moments, and quiet breathing sections rather than an uninterrupted grid of similarly styled cards.
- [x] `UIR-32 · P1 · Missing` — Showcase the differentiating backlog capabilities—integrated chart Journal, 4×4 chart grid, circular chart toolbox, footprint/TPO, account comparison, and Quant—using accurate “available,” “beta,” or “planned” labels so the landing page never markets unshipped work as live.
- [x] `UIR-33 · P1 · Partial` — Rebuild public-page information architecture across Product, How it works, Pricing, FAQ, sign-in, legal, and future docs so anchor navigation, routes, page titles, and footer links behave consistently.
- [x] `UIR-34 · P1 · Partial` — Unify CTA hierarchy and state across header, hero, pricing, final close, beta capacity, and waitlist flows; preserve campaign/query context through sign-in and give every submission a clear success/error state.
- [x] `UIR-35 · P1 · Partial` — Redesign pricing and FAQ as part of the same world, with clear plan comparison, entitlements, billing frequency, edge cases, and honest data-provider/AI limitations rather than generic marketing chrome.
- [x] `UIR-36 · P1 · Missing` — Add trust and proof modules only from verified material—real workflow evidence, security/privacy facts, supported providers, performance methodology, or genuine user evidence—and provide intentional placeholders rather than fabricated claims where proof is unavailable.
- [x] `UIR-37 · P1 · Partial` — Rebuild marketing header, mobile menu, and footer for responsive continuity, current-section indication, keyboard operation, safe sticky behavior, and smooth handoff into authentication and the app.
- [x] `UIR-38 · P1 · Partial` — Meet public-page performance, accessibility, metadata, and search/social-preview requirements: stable layout, optimized media/fonts, semantic headings, visible content without JavaScript motion, reduced motion, descriptive titles, and share metadata.

#### 14.4 Settings redesign — Operate mode

- [x] `UIR-39 · P0 · Partial` — Consolidate Global, Journal, Backtest, chart, appearance, data/provider, account, AI, privacy/security, and storage controls into one scalable settings architecture; show only categories supported by the current build and preserve contextual sub-settings where faster.
- [x] `UIR-40 · P1 · Missing` — Add settings search with synonym matching, highlighted results, category filters, keyboard selection, and deep links that open and focus the exact control.
- [x] `UIR-41 · P1 · Partial` — Use a responsive local settings navigation with sticky desktop sections, clear selection, section counts/status where meaningful, and a compact mobile category picker that preserves the user's place.
- [x] `UIR-42 · P1 · Partial` — Create a standard setting-row anatomy: plain-language label, concise explanation, optional learn-more link, control, current/effective value, inherited/overridden state, validation, and save status.
- [x] `UIR-43 · P1 · Partial` — Standardize fields, comboboxes, toggles, segmented controls, color controls, sliders, file inputs, and numeric/unit inputs, including appropriate widths, units, examples, constraints, and keyboard behavior.
- [ ] `UIR-44 · P1 · Missing` — Choose and enforce one save contract per setting type—immediate, debounced autosave, or explicit section save—and expose saving, saved, retry, and conflict states without transient mystery messages.
- [x] `UIR-45 · P1 · Missing` — Protect edits with dirty-state indication, route-leave handling, undo for recent changes where safe, per-section reset, and a clear distinction between personal defaults, workspace overrides, and factory defaults.
- [x] `UIR-46 · P1 · Partial` — Replace generic failures with inline validation and recovery that identifies the exact field, allowed range/format, dependency, provider issue, or permission problem while preserving valid user input.
- [x] `UIR-47 · P0 · Partial` — Move irreversible or broad-impact controls into explicit danger zones with impact summaries, typed or deliberate confirmation proportional to risk, progress, cancellation where possible, and auditable completion/failure.
- [x] `UIR-48 · P1 · Missing` — Give broker/data/AI integrations polished connection cards showing connected identity, environment, capability/entitlement matrix, last sync, latency/health, permissions, reconnect, refresh, revoke, and provider-specific remediation.
- [x] `UIR-49 · P1 · Partial` — Turn app-data and broker CSV import/export into step-based flows with drop-zone affordance, file validation, preview, conflict/replacement explanation, record counts, progress, result summary, error download, and safe retry.
- [x] `UIR-50 · P1 · Partial` — Add live previews for appearance, chart visual settings, color palettes, density, and relevant defaults, with before/after reset behavior and no accidental mutation of the active workspace until applied.
- [x] `UIR-51 · P1 · Missing` — Add a coherent privacy/security and AI-data area covering active sessions, credential handling, export/delete, chart-image sharing, conversation retention, model-provider routing, microphone permission, and generated-code permissions.
- [x] `UIR-52 · P1 · Partial` — Make all settings usable at narrow widths: controls stack without clipping, local navigation remains reachable, helper text does not overwhelm the control, sticky actions respect the viewport, and software keyboards do not hide focused fields.
- [x] `UIR-53 · P1 · Partial` — Add contextual entry points from charts, Journal, imports, providers, orders, and Quant to the exact relevant setting, plus a reliable “Back to…” path that restores the originating context.
- [x] `UIR-54 · P1 · Partial` — Remove dashboard-like metric tiles and ornamental status pills from settings where they do not help a decision; lead with configuration, health, impact, and the next action while retaining genuinely useful summaries.

#### 14.5 Refresh every remaining product surface

- [x] `UIR-55 · P1 · Partial` — Redesign sign-in, callback, beta-capacity, waitlist, expired-session, and access-denied screens as one trustworthy authentication journey with consistent branding, progress, recovery, and return-to-origin behavior.
- [ ] `UIR-56 · P1 · Partial` — Redesign first-run onboarding and the session gateway around one obvious next step, progressive disclosure, recent/resumable work, sample-data choices, and clear provider/data prerequisites.
- [ ] `UIR-57 · P1 · Partial` — Refresh dashboards and reports with stronger hierarchy, fewer interchangeable cards, aligned financial numbers, purposeful comparison, legible chart annotation, shared filters, and drill-down affordances.
- [ ] `UIR-58 · P1 · Partial` — Refresh Journal accounts, trades, calendar, notes, day/week review, reports, and settings as one coherent system while preserving the higher-density workflow needed for frequent review.
- [ ] `UIR-59 · P1 · Partial` — Refresh chart and replay chrome—top toolbar, drawing rail, watchlist, data window, objects, order ticket, replay transport, pane headers, context menu, and inspectors—without shrinking the plot or hiding expert controls.
- [ ] `UIR-60 · P1 · Partial` — Refresh Live Markets, watchlists, symbol/provider search, connection state, instrument metadata, and feed errors so scanning is fast and stale, delayed, unsupported, or disconnected data is unmistakable.
- [ ] `UIR-61 · P1 · Partial` — Replace long create/edit/import forms with short task-based flows using progressive disclosure, sensible defaults, review steps for consequential actions, preserved drafts, and a clear completion destination.
- [ ] `UIR-62 · P1 · Partial` — Standardize dense tables and lists with sticky headers where useful, numeric alignment, sort/filter state, row selection, bulk actions, expandable detail, keyboard traversal, responsive fallback, and virtualization for large datasets.
- [ ] `UIR-63 · P1 · Partial` — Design first-class empty, loading, skeleton, partial-data, offline, stale, permission-denied, unsupported, error, retrying, and success states for every major surface; each state must explain what happened and the next safe action.
- [ ] `UIR-64 · P1 · Partial` — Standardize dialogs, sheets, menus, popovers, tooltips, banners, and toasts with clear hierarchy, proportional emphasis, focus return, safe dismissal, action timing, and no critical information that vanishes before it can be read.
- [x] `UIR-65 · P1 · Partial` — Bring Pricing, Legal, not-found, maintenance, and other secondary public/system pages into the same visual world, typography, navigation, responsive grid, and accessibility standard instead of leaving legacy islands.

#### 14.6 Motion, feedback, and “flowy” behavior

- [ ] `UIR-66 · P0 · Partial` — Define one motion grammar with named durations, easings, distances, staggering limits, interruption rules, and allowed uses for public storytelling versus repeated application tasks.
- [ ] `UIR-67 · P1 · Partial` — Use restrained route and section transitions that preserve spatial context and perceived continuity without blanking content, replaying on every back navigation, or delaying input.
- [ ] `UIR-68 · P1 · Partial` — Animate panels, drawers, inspectors, dialogs, menus, layout changes, and responsive navigation from their spatial origin with reversible, interruption-safe transitions and stable focus.
- [ ] `UIR-69 · P1 · Partial` — Add purposeful microfeedback for save, copy, import, sync, favorite, reorder, pin, connection, filter, and destructive actions; use optimistic feedback only where rollback and failure are clear.
- [ ] `UIR-70 · P1 · Partial` — Give chart interactions crisp feedback for active pane, linked crosshair, layout selection, favorite drawing, radial-tool selection, capture region, and order placement without animating price in a misleading way.
- [ ] `UIR-71 · P0 · Partial` — Honor `prefers-reduced-motion` across CSS, GSAP, chart transitions, marquees, loaders, and the circular toolbox; keep all content and controls visible and fully usable when motion is disabled.
- [ ] `UIR-72 · P0 · Partial` — Keep repeated animation on compositor-safe transforms/opacity, pause offscreen decorative work, cancel stale transitions, avoid layout thrash, and enforce smooth interaction on representative low-power devices.

#### 14.7 Accessibility, responsiveness, performance, and rollout quality

- [ ] `UIR-73 · P0 · Partial` — Meet WCAG 2.2 AA contrast and interaction requirements for text, controls, charts, focus, disabled states, overlays, validation, and high-density data at every supported theme/density combination.
- [ ] `UIR-74 · P0 · Partial` — Make every workflow keyboard-complete with logical tab order, visible `:focus-visible`, skip/navigation landmarks, predictable Escape/Enter/arrow behavior, restored focus after overlays, and no chart-shortcut collisions.
- [ ] `UIR-75 · P0 · Partial` — Add correct landmarks, headings, labels, descriptions, live regions, table semantics, dialog/menu patterns, and screen-reader names/states; provide textual summaries or tables for essential chart-only information.
- [ ] `UIR-76 · P0 · Partial` — Never encode profit/loss, connection, selection, risk, or severity by color alone; pair color with sign, label, icon, pattern, shape, or position and test common color-vision deficiencies.
- [ ] `UIR-77 · P1 · Partial` — Support 200% browser zoom, large text, coarse pointers, safe-area insets, visible software-keyboard focus, and at least 44×44 touch targets where the interface is used by touch.
- [ ] `UIR-78 · P1 · Missing` — Make layouts resilient to long names, large numbers, alternative currencies/date formats, translated labels, right-to-left text where practical, and user content without relying on hard-coded English widths.
- [ ] `UIR-79 · P0 · Partial` — Set and enforce page-level performance budgets for initial load, interaction latency, layout shift, route chunks, fonts, product-demo media, long lists, charts, and multi-pane workspaces; lazy-load noncritical marketing and advanced-tool code.
- [ ] `UIR-80 · P0 · Missing` — Add screenshot baselines and visual-regression coverage for every redesigned route at agreed desktop/tablet/mobile widths plus compact/full-screen/multi-pane variants and all critical states.
- [ ] `UIR-81 · P0 · Missing` — Add interaction and accessibility tests for navigation, settings save/undo/errors, dialogs, menus, focus return, responsive navigation, reduced motion, imports, authentication, and the most important chart/Journaling flows.
- [ ] `UIR-82 · P1 · Missing` — Validate the redesign with representative traders on first-visit comprehension, time-to-start/resume, settings discovery, chart-space efficiency, Journal review speed, error recovery, and keyboard/touch use; turn findings into measured acceptance criteria.
- [ ] `UIR-83 · P0 · Missing` — Roll out by shared primitives and route groups behind controlled flags, migrate the shell before dependent screens, prevent old/new component mixing within a completed route, preserve deep links and data, and provide a reversible fallback until parity is verified.
- [ ] `UIR-84 · P0 · Missing` — Define redesign completion per route: approved direction honored, behavior preserved, no legacy islands, responsive screenshots reviewed, critical states exercised, keyboard and screen-reader checks passed, performance budget met, and the resulting system documented.

## Recommended implementation sequence

1. **Product and visual foundation:** `UIR-01` through `UIR-14`; approve one visual direction, lock product truth, tokens, primitives, component states, and the responsive grid before route-by-route styling.
2. **Technical foundation:** `PLT-01` through `PLT-05`, canonical trades/fills, Journal CSV destination, chart symbol normalization, and full-workspace state.
3. **Shell and flagship redesign:** migrate app shell/navigation/panels, settings, landing, authentication, and onboarding first; these establish the reusable system for every later feature.
4. **Journal parity:** docked Journal, review fields, chart targeting, daily notes, dashboard/Edge Score, analytics, account comparison, and the corresponding Journal surface refresh.
5. **Connected accounts:** secure provider framework, generic synchronization, refresh/reconciliation, provider-specific connectors, and their settings/health experience.
6. **Chart-workspace parity:** independent symbols, 16 panes including 4×4, synchronization, RTH/ETH, timezone, sharing, advanced drawings, circular toolbox, indicator discovery, and refreshed chart chrome.
7. **Order flow:** tick/depth ingestion, footprint/TPO, order-flow indicators, futures/session infrastructure, commercial entitlements, and legible dense-data design.
8. **AI:** custom-indicator runtime first, then Quant chat, voice, chart capture/vision, code generation, automatic backtesting, and clear permission/usage states.
9. **Quality and migration:** complete `UIR-66` through `UIR-84` continuously per migrated route, then remove legacy components only after behavior, accessibility, performance, and visual parity are verified.
10. **Reference roadmap:** Order Book, Alerts, and direct Tradovate/NinjaTrader synchronization.

## Scope guardrails

- Reproduce capabilities and workflows, not LuxAlgo’s copyrighted UI, proprietary indicator formulas, names, or source code.
- Treat AI-generated bias and probability overlays as decision support, with visible uncertainty and no implied guarantee.
- Do not label ordinary candle volume as “order flow.” Footprint, delta, imbalance, and unfinished-auction features require trade-level bid/ask data of sufficient quality.
- Keep Backtest and live Journal semantics distinct internally, but make imported historical trades usable in the same Journal analytics and review experience.
- Keep the redesign faithful to EdgeLab rather than copying the references: preserve real product behavior and the strongest existing chart conventions while replacing legacy presentation across an entire route at a time.
- Treat landing/public pages as expressive persuasion surfaces and the authenticated workspace as an efficient operating surface; they may differ in intensity, but must visibly belong to one system.
- Do not fabricate customers, performance figures, provider support, pricing, security claims, testimonials, or future-feature availability to make the new landing page look complete.
