# EdgeLab Beta Launch Feature Inventory

Framework choice: `Remotion`, because the repo is already React-heavy and the fastest defensible path is to reuse real React surfaces and wrap them in motion rather than rebuild the product shell from scratch.

## Verified feature inventory

| Feature | Where it lives in code | User-facing behavior | Why it matters |
| --- | --- | --- | --- |
| Beta access, seat count, and waitlist gating | `frontend/src/routes/AppRoutes.tsx`, `frontend/src/pages/AuthSignInPage.tsx`, `backend/app/api/routes.py` (`/auth/*`) | Users enter through Google, see live beta-seat / waitlist state, and are either admitted into `/app` or redirected into waitlist mode. | This is the beta-launch entry point and the correct product framing for the video reveal. |
| Session gateway and strategy-first session creation | `frontend/src/components/SessionGateway.tsx`, `frontend/src/components/DatasetSessionPanel.tsx`, `frontend/src/store/backtestStore.ts`, `backend/app/services/backtester.py#create_session` | Users pick a market, timeframe, date range, strategy, optional playbook, balance, and cost model, then start or resume a replay session. | It establishes how EdgeLab begins: from a deliberate session, not a generic dashboard. |
| Dataset catalog, refresh, and asset metadata overrides | `frontend/src/lib/api.ts`, `backend/app/services/datasets.py`, `backend/app/api/routes.py` (`/datasets*`) | Users can browse discovered instruments/timeframes, refresh the catalog, watch refresh status, and override asset currency/timezone/PnL multiplier. | Replay quality depends on real dataset control, and the app exposes it directly. |
| Historical replay engine | `frontend/src/store/backtestStore.ts`, `frontend/src/components/ReplayController.tsx`, `backend/app/services/backtester.py#advance/#advance_compact/#jump` | Replay can play, pause, step, jump by timestamp or offset, and sync only compact deltas when possible. | This is the product core: price action unfolds as a controllable simulation, not a static chart. |
| Order ticket with risk sizing and bracket logic | `frontend/src/components/OrderTicket.tsx`, `frontend/src/lib/orderSettings.ts`, `backend/app/services/backtester.py#place_order` | Users place market/limit/stop orders with quantity or risk-percent sizing, stop loss, take profit, breakeven trigger, commissions, fees, notes, and playbook linkage. | It turns replay into actionable execution practice instead of passive chart review. |
| Interactive chart studio | `frontend/src/components/TradingChart.tsx`, `frontend/src/App.tsx`, `frontend/src/lib/charting.ts`, `frontend/src/lib/chartLayouts.ts`, `frontend/src/lib/chartSettings.ts` | The chart supports drawings, indicator stacks, multi-pane layouts, magnet mode, order overlays, floating toolbars, fullscreen, saved layouts, and timeframe shortcuts. | This is EdgeLab’s visual signature and the strongest source material for motion. |
| Pending orders, position controls, and execution tape | `frontend/src/components/PendingOrders.tsx`, `frontend/src/components/PositionPanel.tsx`, `frontend/src/components/ExecutionTape.tsx`, `backend/app/services/backtester.py#update_order/#update_position/#cancel_order` | Users edit pending orders, adjust live position brackets, and inspect execution history as the replay evolves. | It makes the trading loop feel alive and stateful on screen. |
| Metrics bar, results workspace, and denormalized summaries | `frontend/src/components/MetricsBar.tsx`, `frontend/src/components/ResultsPanel.tsx`, `backend/app/services/metrics.py`, `backend/app/services/strategy_summaries.py`, `backend/app/services/dashboard_summaries.py` | Users see win rate, profit factor, drawdown, expectancy, equity curves, side splits, calendar results, and strategy performance. | It closes the learning loop with proof, not just intuition. |
| Trade log, journal editing, and detail drawer | `frontend/src/components/TradeLog.tsx`, `frontend/src/components/JournalEntryModal.tsx`, `frontend/src/components/TradeDetailDrawer.tsx`, `backend/app/services/backtester.py#update_journal/#update_trade_strategy` | Users inspect closed trades, attach notes, screenshots, emotional state, mistake tags, and strategy labels, then revisit them in a richer detail drawer. | This is where replay becomes review memory. |
| Playbooks and strategy management | `frontend/src/components/PlaybookBoard.tsx`, `frontend/src/components/SessionGateway.tsx`, `frontend/src/components/EdgeLabWorkspace.tsx`, `backend/app/services/backtester.py#create_playbook/#update_playbook/#delete_playbook` | Users create rule-based playbooks, link them to sessions/trades, and analyze performance grouped by strategy. | It codifies process, which is one of EdgeLab’s clearest differentiators. |
| Day view, trade view, and notebook review surfaces | `frontend/src/components/EdgeLabWorkspace.tsx` (`DayViewPage`, `TradeViewPage`, `NotebookPage`) | Users review grouped daily performance, searchable trade history, and note templates tied back to specific trades or results panels. | It extends analytics into deeper qualitative review. |
| Live markets workspace | `frontend/src/components/EdgeLabWorkspace.tsx` (`LiveMarketsPage`), `frontend/src/lib/api.ts` (`getBinanceInstruments`, `getDukascopyInstruments`, `getAngelOneInstruments`, `getApiWebSocketUrl`) | Users build watchlists and monitor Binance, Dukascopy, and Angel One symbols with live charts, live tickers, and provider-specific feeds. | It widens EdgeLab from historical replay into live market context. |
| Economic calendar | `frontend/src/components/EdgeLabWorkspace.tsx` (`EconomicCalendarPage`), `frontend/src/lib/api.ts#getForexFactoryCalendar`, `backend/app/api/routes.py#/economic-calendar/forex-factory` | Users filter scheduled macro events by impact, currency, day, and event type, with cached refresh behavior. | It adds decision context around live trading and replay planning. |
| Feedback capture with screenshots and diagnostics | `frontend/src/components/EdgeLabWorkspace.tsx` (`FeedbackPage`), `frontend/src/lib/api.ts#postFeedback/#getFeedbackSubmissions`, `backend/app/api/routes.py#/feedback` | Users submit categorized feedback, optional session context, HAR diagnostics, and screenshot attachments, then review recent submissions. | It is highly relevant for a beta launch and is explicitly product-facing. |
| App data export/import | `frontend/src/components/EdgeLabWorkspace.tsx` (`GlobalSettingsPage`), `frontend/src/lib/api.ts#exportAppDataBundle/#importAppDataBundle`, `backend/app/api/routes.py#/app-data/*` | Users can export the full EdgeLab data bundle and restore it later, replacing sessions, trades, notes, layouts, and settings. | It signals data ownership and operational safety for serious users. |
| Journal workspace and finance tracker | `frontend/src/components/EdgeLabWorkspace.tsx` (`JournalWorkspacePage`, `FinanceTrackerPage`) | Separate from backtests, users can log live sessions, missed setups, linked accounts, journal playbooks, and income/expense or prop-firm cashflow. The current implementation is local-state / app-storage led inside the SPA. | It broadens EdgeLab from replay lab into a trading operating system. |

## Reconstructed user flows

### 1. Beta entry to first replay
1. User lands on `/` and sees seat / waitlist status in the marketing shell.
2. User opens `/auth/signin` and continues with Google.
3. `AppRoutes` restores the beta session and redirects approved users to `/app`.
4. The workspace opens on the session gateway.
5. User chooses an instrument, timeframe, replay window, strategy, and optional playbook.
6. User starts a session and EdgeLab creates a replay-ready backtest state with the matching dataset.

### 2. Replay and execution loop
1. The user resumes or opens a session from the gateway.
2. Replay controls set speed, step size, or a jump target by date/time or offset.
3. The chart advances candle by candle while the store prefetches surrounding bars.
4. The user opens the order ticket, chooses market / limit / stop, sets risk rules, and places an order.
5. Pending orders, open position state, and execution tape update as candles trigger fills or brackets.
6. The user edits order lines or position targets directly from chart overlays.

### 3. Review and analytics loop
1. Closed trades populate the trade log and results caches.
2. The user opens a trade journal modal or detail drawer.
3. Notes, mistake tags, screenshots, emotional state, and strategy labels are saved back to the trade.
4. Metrics, equity curves, strategy summaries, day view, trade view, and notebook surfaces rehydrate from the updated trade set.
5. The user compares strategy groups, session groups, and calendar/day breakdowns to refine playbooks.

### 4. Data and workspace management
1. User refreshes datasets or watches the dataset stream for catalog updates.
2. User overrides asset metadata such as timezone, currency, or PnL multiplier when needed.
3. User exports the app data bundle for backup / migration, or imports a bundle to restore a workspace.
4. User submits beta feedback with screenshots and diagnostics directly from the app.

### 5. Live context loop
1. User opens Live Markets and selects a provider-backed watchlist.
2. EdgeLab loads historical context, then upgrades into live polling or streaming depending on provider.
3. User opens the Economic Calendar to filter upcoming high-impact events by currency or day.
4. User can keep live journal and finance-tracker surfaces separate from backtest analytics.
