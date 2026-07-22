# EdgeLab Beta Launch: Screen & Feature Master Inventory Guide

> **Purpose**: This document provides an exhaustive, screen-by-screen and component-by-component breakdown of EdgeLab for marketing teams, copywriters, and video producers. Since no Figma mockups exist, this guide details both the **Visual Aesthetics** (colors, layouts, animations, dark mode tokens) and **Full Functional Behaviors** (order execution, tick replay, charting mechanics, performance formulas, data sync) alongside embedded `[VIDEO SCENE PROMPT]` markers for video scripting.

---

## Table of Contents

1. [Executive Product Overview & Design System](#1-executive-product-overview--design-system)
2. [Public Landing & Marketing Pages](#2-public-landing--marketing-pages)
3. [Authentication & Onboarding Flow](#3-authentication--onboarding-flow)
4. [Session Gateway & Backtest Setup Modal](#4-session-gateway--backtest-setup-modal)
5. [Main Trading Workspace & Charting Engine](#5-main-trading-workspace--charting-engine)
6. [Interactive Drawing & Annotation Suite](#6-interactive-drawing--annotation-suite)
7. [Tick-Level Replay Engine & Replay Bar](#7-tick-level-replay-engine--replay-bar)
8. [Order Execution Terminal & Risk Manager](#8-order-execution-terminal--risk-manager)
9. [Trade Log, Review & Slide-Over Drawer](#9-trade-log-review--slide-over-drawer)
10. [Trade Journal, Playbook & Strategy Engine](#10-trade-journal-playbook--strategy-engine)
11. [Executive Dashboard & Advanced Analytics](#11-executive-dashboard--advanced-analytics)
12. [Auxiliary Power Tools & System Settings](#12-auxiliary-power-tools--system-settings)

---

## 1. Executive Product Overview & Design System

### 1.1 Core Value Proposition
EdgeLab is an institutional-grade, tick-accurate market replay, trading simulator, and strategy analytics platform. It allows professional traders, prop firm candidates, and algorithmic analysts to backtest manual strategies on true tick and M1 historical market data with zero forward-looking bias, instant execution simulation, and deep statistical analytics.

### 1.2 Design System & Visual Palette
EdgeLab utilizes a modern, sleek dark-mode design system with glassmorphic cards, high-contrast chart elements, vibrant neon status indicators, and micro-interactions.

- **Background Canvas**: Dark Obsidian Black (`#05070a`), Deep Slate (`#091019`), and Glass Slate (`#0c1420/80` with `backdrop-filter: blur(16px)`).
- **Borders & Dividers**: Subtle Amber/Cyan outlines (`border-amber-300/15`, `border-cyan-500/20`, `border-slate-800`).
- **Primary Highlights**: Electric Cyan (`#06b6d4`), Bright Amber/Gold (`#f59e0b`), Emerald Green (`#10b981` for Long/Profit/Buy), Rose Red (`#f43f5e` for Short/Loss/Sell).
- **Glow Effects**: Radial ambient glows (`shadow-[0_0_18px_rgba(252,211,77,0.45)]`, `shadow-[0_0_24px_rgba(6,182,212,0.35)]`).
- **Typography**: Inter / System UI sans-serif with crisp tabular numbers for prices, PnL, and timestamps.

---

## 2. Public Landing & Marketing Pages

### 2.1 Public Landing Page
**Files**: [LandingPage.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/pages/LandingPage.tsx), [MarketingShell.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/components/marketing/MarketingShell.tsx), [HeroDemo.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/components/marketing/HeroDemo.tsx)

> `[VIDEO SCENE PROMPT 1.0]`: *Slow zoom into the dark obsidian hero section. Neon cyan and emerald chart lines glow softly against a deep grid background as the interactive hero demo simulates a live trade execution.*

#### Visual Description
- **Header Navigation Bar**: Fixed dark header with glassmorphism, featuring the glowing EdgeLab logomark (shield with cyan pulse), quick links (*Features*, *Pricing*, *Documentation*), and a high-contrast "Launch Workspace" CTA button (`bg-cyan-400 text-slate-950 hover:bg-cyan-300`).
- **Hero Banner**: Bold gradient headline *"Master the Markets with Tick-Accurate Replay"* in crisp white and cyan text. Subheadline emphasizes zero-latency data and institutional trade analytics.
- **Interactive Hero Demo Widget (`HeroDemo.tsx`)**: A mini live interactive chart running in the center of the hero fold. Demonstrates a simulated candlestick chart with a glowing Long Position box, live tick replay animation, and real-time PnL ticker update.
- **Feature Cards Grid**: 6 glassmorphic feature cards with neon Lucide icons (*Database*, *LineChart*, *Gauge*, *BookOpenCheck*, *ShieldCheck*, *Zap*). Hovering over cards illuminates subtle radial cyan border glows.
- **Social Proof / Metrics Counter Bar**: Displays live counter metrics: *"10M+ Candles Replayed"*, *"0ms Local Execution"*, *"99.9% Historical Precision"*, *"100+ Built-in Indicators"*.

#### Functional Description
- **Interactive Demo Controls**: Allows visitors to click *Play Replay*, *Execute Buy*, or *Toggle Indicators* right on the landing page without signing in.
- **Navigation Routing**: Seamless client-side routing to sign-in, pricing, or legal pages.
- **Responsive Layout**: Collapses into a clean mobile layout with hamburger slide-over menu for smaller screens.

---

### 2.2 Pricing Page
**Files**: [PricingPage.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/pages/PricingPage.tsx), [PricingSection.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/components/marketing/PricingSection.tsx)

> `[VIDEO SCENE PROMPT 1.1]`: *Pan across the pricing cards highlighting the "Beta Access / Pro" card illuminated with a golden ambient border glow.*

#### Visual Description
- **Tier Cards Grid**: 3 tier cards (*Free Beta*, *Pro Trader*, *Institutional/Prop*).
- **Featured Card**: The *Pro Trader* card is elevated with an amber/cyan glowing border (`border-amber-300/40`), a *"Most Popular"* pill badge, and a high-contrast primary button.
- **Billing Toggle**: Monthly / Annual billing toggle switch with a green *"Save 20%"* badge.
- **Feature Checkmarks**: Bulleted list with glowing emerald check icons for supported features (Unlimited datasets, multi-chart layout, custom playbooks, automated exports).

#### Functional Description
- **Interactive Billing Toggle**: Toggles pricing state between monthly and yearly rates with smooth transition animations.
- **Direct Auth Integration**: Clicking "Start Free Beta" redirects directly to Google OAuth or Email Sign-in with beta access pre-selected.

---

## 3. Authentication & Onboarding Flow

### 3.1 Sign-In & Auth Gateway
**Files**: [AuthSignInPage.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/pages/AuthSignInPage.tsx), [AuthTransitionScreen.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/components/auth/AuthTransitionScreen.tsx)

> `[VIDEO SCENE PROMPT 2.0]`: *Smooth transition from the landing CTA into the sleek centered sign-in card with Google One-Tap and magic link options.*

#### Visual Description
- **Centered Auth Card**: Minimalist glassmorphic card set against a subtle grid texture backdrop.
- **Branding Header**: EdgeLab icon logo with glowing status ring and subtitle *"Sign in to access your backtest workspace"*.
- **Google OAuth Button**: Styled white/slate button with official Google multicolor G logo.
- **Email Magic Link Input**: Clean dark text input field (`bg-[#050b11] border-slate-700 focus:border-cyan-400`) with an arrow-right action icon.
- **Beta Access Banner**: Glowing amber pill notification at top: `BETA WORKSPACE • Temporary beta data enabled`.

#### Functional Description
- **Google OAuth 2.0 Integration**: Redirects to Google authorization flow or uses pop-up handler.
- **Magic Link / Credentials**: Handles passwordless authentication tokens with client-side validation.
- **Session Rehydration**: Automatically checks local storage for active auth tokens and rehydrates session state.

---

### 3.2 Auth Transition Screen
**File**: [AuthTransitionScreen.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/components/auth/AuthTransitionScreen.tsx)

#### Visual Description
- **Full-Screen Transition Modal**: Deep obsidian background with a progress stepper panel.
- **Multi-Step Indicator**: 3 animated steps (*1. Load Callback*, *2. Restore Session*, *3. Open Workspace*) with checkmarks and active pulse indicators (`EdgePulseLoader`).

#### Functional Description
- **Token Exchange**: Exchanges authorization code for JWT bearer token.
- **State Handoff**: Loads user preferences, stored backtest sessions, and redirects cleanly to `/backtest` or `/dashboard`.

---

## 4. Session Gateway & Backtest Setup Modal

**File**: [SessionGateway.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/components/SessionGateway.tsx)

> `[VIDEO SCENE PROMPT 3.0]`: *Close-up of the Session Gateway modal. User selects M1 EURUSD dataset, sets a $100,000 balance, chooses a 1% risk rule, and clicks "Launch Replay Workspace".*

```
+-----------------------------------------------------------------------------------+
|  CREATE NEW BACKTEST SESSION                                            [ X ]     |
|-----------------------------------------------------------------------------------|
|  [ DATASET SELECTOR ]        [ PARAMETERS & COSTS ]       [ PLAYBOOK RULES ]      |
|  Symbol: EURUSD M1           Starting Balance: $100,000   Strategy: Liquidity Sweep|
|  Source: Dukascopy / Forex   Currency: USD                 Risk Limit: 1.0% / trade |
|  Range: 2024-01-01 to 2024   Commission: $3.50/lot        Rules: Checklist (4/4)   |
|-----------------------------------------------------------------------------------|
|  [ RESUME PREVIOUS SESSIONS ]                                                     |
|  > EURUSD_2024_NY_Session     52 Trades   WinRate: 68.2%   PnL: +$14,250 (+14.2R)   |
|-----------------------------------------------------------------------------------|
|  [ CANCEL ]                                          [ START BACKTEST SESSION ]   |
+-----------------------------------------------------------------------------------+
```

### Visual Description
- **Dual-Pane Modal Layout**: Left pane displays Dataset Selection & Session History; Right pane displays Session Configuration & Financial Parameters.
- **Dataset Cards**: Selectable grid cards showing market symbol badges (`EURUSD`, `GBPUSD`, `BTCUSD`), source provider (*Dukascopy*, *Binance*, *AngelOne*), and date availability spans.
- **Custom Pickers**: Custom dark selects (`ThemedSelect`) and calendar pickers (`ThemedDatePicker`, `ReplayDateTimePicker`) with slate/cyan styling.
- **Session History Table**: List of past backtests with status pills (*Active*, *Completed*), trade counts, net PnL in green/red, and one-click *Resume* or *Delete* buttons.

### Functional Description
- **Dataset Catalog Engine**: Queries backend `/api/market-data/datasets` catalog to display available high-density datasets.
- **Financial Controls**:
  - **Starting Balance**: Configurable from $1,000 to $10,000,000+.
  - **Account Currency**: USD, EUR, GBP, JPY, INR, AUD, CAD, CHF, SGD, AED.
  - **Commission Mode**: *None*, *Fixed $ per lot*, *Percent % of trade value*.
  - **Fee Mode**: *None*, *Fixed $ per trade*, *Percent %*.
  - **Slippage Simulation**: Simulated tick slippage on market orders.
- **Playbook Assignment**: Link session to predefined Playbook strategies (e.g. *"Liquidity Sweep + MSS"*, *"FVG Retest"*).
- **Session Persistence & Export**: Clone existing sessions, update session metadata, or export full session JSON.

---

## 5. Main Trading Workspace & Charting Engine

**Files**: [EdgeLabWorkspace.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/components/EdgeLabWorkspace.tsx), [TradingChart.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/components/TradingChart.tsx), [ChartObjectsPanel.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/components/ChartObjectsPanel.tsx), [components/charts/*](file:///Users/speketi/Projects/EdgeLab/frontend/src/components/charts/)

> `[VIDEO SCENE PROMPT 4.0]`: *Cinematic wide shot of the main multi-pane trading workspace. Candlestick chart streams forward in real-time replay mode while technical indicators and dynamic order lines highlight key levels.*

```
+-----------------------------------------------------------------------------------+
| [SYM: EURUSD] [M1|M5|M15|H1|H4|D1] [GRID 2x2] [IND: 4] [SETTINGS] [FULLSCREEN]  |
|-----------------------------------------------------------------------------------|
| [DRAWING TOOLBAR] |                                                               |
| (Cursor)          |   CANDLESTICK CHART STUDIO (Primary Pane)                     |
| (Trendline)       |   - High-DPI Canvas Candlesticks                              |
| (Fib Retrace)     |   - Dynamic Order Lines: Buy Entry @ 1.08500                  |
| (Long Pos)        |   - TP Line @ 1.09000 (+50 pips)                              |
| (Short Pos)       |   - SL Line @ 1.08300 (-20 pips)                              |
| (Ruler)           |                                                               |
| (Magnet)          |---------------------------------------------------------------|
| (Lock)            |   OSCILLATOR SUB-PANE (RSI / MACD / Volume Depth)             |
|-------------------|---------------------------------------------------------------|
| [REPLAY CONTROLLER] [<<] [PLAY/PAUSE] [>>] [SPEED: 5.0x] [DATE SCRUBBER=========] |
+-----------------------------------------------------------------------------------+
```

### 5.1 Workspace Header Bar
#### Visual Description
- Dark slate bar (`bg-[#091019] border-b border-slate-800`) spanning top of screen.
- **Symbol Selector Button**: Displays current instrument (e.g. `EURUSD`), timeframe badge (`M5`), and market status indicator.
- **Timeframe Switcher Group**: Button bar (`M1`, `M5`, `M15`, `H1`, `H4`, `D1`) with active cyan pill highlight. Supports direct keyboard shortcuts (`1`, `5`, `15`, `60`, `240`, `D`).
- **Layout Preset Selector**: Dropdown icons for Multi-Pane layouts (*Single Pane*, *2-Chart Vertical Split*, *2-Chart Horizontal Split*, *4-Chart Grid*).
- **Settings & Theme Toggles**: Quick icons for Chart Settings (`Settings2`), Objects Tree (`Layers`), Sidebar Toggles (`PanelLeftOpen`, `PanelRightOpen`), and Fullscreen (`Maximize2`).

#### Functional Description
- **Real-Time Layout Switcher**: Instantly re-arranges chart panes using `chartPaneLayoutById` with synchronized crosshairs.
- **Preset Management**: Load, save, and export chart visual presets (candle colors, grid lines, watermarks, background gradients).

---

### 5.2 Interactive Candlestick Chart Studio (`TradingChart.tsx`)
#### Visual Description
- **Canvas/SVG Hybrid Engine**: Crisp rendering supporting high FPS panning, zoom, and tick updates.
- **Candlestick Styles**: Japanese Candlesticks (Emerald Bullish `#10b981`, Rose Bearish `#f43f5e`), Bar Charts, Line Charts, Area Charts.
- **Grid Lines & Watermark**: Subtle background grid (`BacklitGrid`) with translucent instrument watermark text (`EURUSD M5`).
- **Candle Inspector Box**: Floating hover panel displaying `O: 1.08520 H: 1.08550 L: 1.08490 C: 1.08540 Vol: 1,420`.
- **Dynamic Crosshair**: Synchronized crosshair with price highlight on Y-axis and timestamp highlight on X-axis (`BacklitBarXAxis`, `BacklitYAxis`).

#### Functional Description
- **Multi-Timeframe Aggregation**: Converts raw M1 tick/candle data into higher timeframe bars (M5, M15, H1, H4, D1) dynamically on the fly.
- **Pan & Zoom Mechanics**: Mouse wheel zooming, drag-to-pan X-axis time series, and drag-to-scale Y-axis price domain.
- **Indicator Engine**:
  - Overlays: Moving Averages (SMA, EMA, WMA), VWAP, Bollinger Bands, Keltner Channels.
  - Sub-panes: RSI, MACD, Stochastic Oscillator, ATR, Volume Profile Depth (`BacklitHeatmapCells`).

---

### 5.3 Chart Objects Panel (`ChartObjectsPanel.tsx`)
#### Visual Description
- **Slide-Out Layers Panel**: Tree-view list displaying all active drawings and indicator instances for each chart pane.
- **Control Icons**: Hide/Show eye icon (`Eye`), Lock/Unlock padlock (`Lock`), Color Swatch, Duplicate, Delete (`Trash2`).

#### Functional Description
- **Object Layering (Z-Index)**: Move objects up/down in z-order, edit line weights/colors, or clear all drawings per pane.

---

## 6. Interactive Drawing & Annotation Suite

**Files**: [ChartToolbar.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/components/ChartToolbar.tsx), [ChartToolIcons.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/components/ChartToolIcons.tsx)

> `[VIDEO SCENE PROMPT 5.0]`: *Close-up of drawing a Fibonacci Retracements tool and placing a Long Risk/Reward box on the chart. PnL targets and R-multiples calculate dynamically.*

```
+---------------------------------------+
| CHART DRAWING TOOLBAR                 |
|---------------------------------------|
|  [+] Cursor / Crosshair Mode          |
|  [/] Trendline / Ray / Channel        |
|  [F] Fibonacci Retracement & Ext.     |
|  [R] Rectangle (Demand / Supply Zone) |
|  [T] Floating Text / Price Notes      |
|  [M] Ruler Tool (Pips / Bars / Time)  |
|  [L] Long Position Box (Risk/Reward)  |
|  [S] Short Position Box (Risk/Reward) |
|---------------------------------------|
|  [*] Magnet Mode: [ Strong | Weak ]   |
|  [x] Clear All Drawings               |
+---------------------------------------+
```

### Visual & Functional Breakdown of Drawing Tools

1. **Cursor & Selection Tools**: Pointer (`cursor`), Crosshair (`crosshair`), Eraser (`eraser`).
2. **Line Tools**:
   - **Trendline (`trendline`)**: Ray/Segment between two points with angle and pip distance label.
   - **Horizontal Line (`horizontalLine`)**: Infinite price level line with right-aligned price badge.
   - **Vertical Line (`verticalLine`)**: Infinite timestamp line.
   - **Parallel Channel (`parallelChannel`)**: 3-point channel defining upper/lower bounds and median line.
3. **Fibonacci Tools (`fibonacciRetracement`)**:
   - Customizable Fibonacci levels (0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0, 1.272, 1.618).
   - Semi-transparent color fills between golden ratio zones (e.g. 50%-61.8% OTE zone).
4. **Shape Tools**:
   - **Rectangle (`rectangle`)**: Supply/Demand zone boxes with custom border and opacity fill.
   - **Path (`path`)**: Multi-node polyline for drawing market structure waves (HH, HL, LH, LL).
5. **Measurement Tools**:
   - **Ruler Tool (`ruler`)**: Click-and-drag overlay calculating Pip distance, Price % change, Bar count, and Time elapsed.
6. **Risk/Reward Position Tools**:
   - **Long Position Box (`longPosition`)**: Emerald green target box, Rose red stop loss box, Entry line, dynamic Risk:Reward ratio (e.g., `1:3.25`), and potential $ PnL.
   - **Short Position Box (`shortPosition`)**: Inverse Short Risk/Reward projection box.
7. **Global Drawing Controls**:
   - **Magnet Mode (`MagnetMode`)**: Snap drawing anchor points to exact candle High/Low (Strong Magnet) or Close (Weak Magnet).
   - **Lock & Clear**: Lock all drawing positions (`lock`) or Purge all (`trash`).

---

## 7. Tick-Level Replay Engine & Replay Bar

**File**: [ReplayController.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/components/ReplayController.tsx)

> `[VIDEO SCENE PROMPT 6.0]`: *Close-up of the Replay Controller bar at the bottom of the workspace. The playback speed slider moves from 1x to 10x as price action speeds up, building candles bar-by-bar.*

```
+-----------------------------------------------------------------------------------+
|  [|<] [<< 5b] [ PLAY / PAUSE ] [5b >>] [>|]  |  SPEED: [=====o====] 5.0x          |
|  Date: 2024-01-15 14:30:00 UTC               |  Timeline Scrubber: [===|========] |
+-----------------------------------------------------------------------------------+
```

### Visual Description
- **Floating Bottom Bar**: Dark glassmorphic bar (`bg-[#091019f2] backdrop-blur-xl border border-slate-800 rounded-full px-6 py-3`).
- **Media Playback Buttons**: Play/Pause (`PlayCircle`, `PauseCircle`), Step Backward (`SkipBack`), Step 1 Bar Forward, Step 5 Bars Forward (`FastForward`), Jump to End (`SkipForward`).
- **Speed Slider Control**: Smooth slider ranging from `0.1x` to `100.0x` replay speed with quick preset pills (`1x`, `5x`, `10x`, `50x`).
- **Timeline Date Scrubber**: Horizontal progress bar showing current replay position relative to total session date range.
- **Jump to Date Picker (`ReplayDateTimePicker`)**: Date-time input field for jumping to specific timestamps.

### Functional Description
- **Tick-Accurate Progression**: Feeds historical M1 sub-bars to the charting and order execution engine.
- **Bar Building Animation**: Smooth bar aggregation visualizer showing sub-bar progress before closing higher-timeframe candles.
- **Instant Time Travel**: Dragging the scrubber or picking a date rewinds/fast-forwards session state cleanly.

---

## 8. Order Execution Terminal & Risk Manager

**Files**: [OrderTicket.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/components/OrderTicket.tsx), [PositionPanel.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/components/PositionPanel.tsx), [PendingOrders.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/components/PendingOrders.tsx), [ExecutionTape.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/components/ExecutionTape.tsx)

> `[VIDEO SCENE PROMPT 7.0]`: *Trader clicks "Buy Market" on the Order Ticket. Instant order fill sounds/animations trigger, entry line appears on chart, and user drags the Stop Loss line on the chart to adjust risk.*

```
+------------------------------------+  +-------------------------------------------------------------+
| ORDER TICKET terminal               |  | POSITIONS & ORDERS PANEL                                    |
|------------------------------------|  |-------------------------------------------------------------|
| [ MARKET ] [ LIMIT ] [ STOP ]      |  | SYM   SIDE   SIZE   ENTRY    MARK   SL      TP      PNL ($) |
| Side: [ BUY MARKET ] [ SELL MKT ]  |  | EURUSD LONG  1.00   1.08500  1.08700 1.08300 1.09000 +$200  |
| Risk Mode: [ 1.0% Balance ($1,000) ]|  |-------------------------------------------------------------|
| Lot Size:  1.25 Lots (Calculated)  |  | ACTIONS: [ CLOSE 100% ] [ SCALE 50% ] [ MOVE SL TO BE ]    |
| Stop Loss:   1.08300 (-20 pips)    |  +-------------------------------------------------------------+
| Take Profit: 1.09000 (+50 pips)    |
| Risk:Reward: 1 : 2.50              |
| [ EXECUTE BUY ORDER (Shift+B) ]    |
+------------------------------------+
```

### 8.1 Order Ticket Terminal (`OrderTicket.tsx`)
#### Visual Description
- Compact sidebar panel with dark card layout and segmented control tabs (*Market*, *Limit*, *Stop*).
- **Execution Buttons**: Large, high-contrast action buttons: Bright Emerald `BUY MARKET` and Bright Rose `SELL MARKET`.
- **Calculated Metrics Display**: Real-time display of Calculated Units/Lots, $ Risk Amount, $ Target PnL, and Risk:Reward Ratio.

#### Functional Description
- **Dynamic Position Sizing Calculator**:
  - **Risk Mode 1**: `% of Balance` (e.g. 1.0% risk on $100,000 = $1,000 risk).
  - **Risk Mode 2**: Fixed `$ Risk` (e.g. $500).
  - **Risk Mode 3**: Fixed `Lot Size` (e.g. 1.5 Lots).
  - Automatically calculates lot size based on Stop Loss pip distance.
- **Keyboard Execution Shortcuts**: `Shift + B` (Buy Market), `Shift + S` (Sell Market), `Shift + C` (Close All Positions).

---

### 8.2 Interactive Chart Order Lines & Confirmation Modal
#### Visual Description
- **Chart Order Lines**: Horizontal dashed lines on the chart: Blue Entry Line, Emerald Take Profit Line, Rose Stop Loss Line.
- **Drag Handles**: Interactive handles on order lines allow dragging SL or TP directly on the chart canvas.
- **Modification Modal (`hydrateOrderLineModificationConfirmation`)**: Slide-in confirmation modal showing updated SL price, revised pip distance, updated $ Risk, and Risk:Reward change before confirming modification.

---

### 8.3 Open Positions & Pending Orders Panel (`PositionPanel.tsx`, `PendingOrders.tsx`)
#### Visual Description
- Tabbed table panel located at bottom or side of workspace.
- **Live PnL Display**: Green/Red glowing PnL values in both currency (`+$450.00`) and R-multiples (`+2.25R`).

#### Functional Description
- **One-Click Actions**:
  - **Close 100%**: Immediately liquidates open position at current replay market price.
  - **Partial Scale Out**: Close 25%, 50%, or 75% of lot size.
  - **Move SL to Break-Even (BE)**: Sets Stop Loss price to exact entry price + spread offset.
  - **Reverse Position**: Closes current position and opens opposite side with same lot size.

---

### 8.4 Execution Tape (`ExecutionTape.tsx`)
#### Visual Description
- Real-time scrolling event feed showing filled orders, execution slippage, commission deductions, and partial closes.

---

## 9. Trade Log, Review & Slide-Over Drawer

**Files**: [TradeLog.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/components/TradeLog.tsx), [TradeDetailDrawer.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/components/TradeDetailDrawer.tsx), [FilteredTradeReview.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/components/FilteredTradeReview.tsx)

> `[VIDEO SCENE PROMPT 8.0]`: *Trader clicks a winning trade in the Trade Log. A slide-over detail drawer smoothly expands, showing a high-res chart snapshot, bar-by-bar trade replay, and execution statistics.*

```
+-----------------------------------------------------------------------------------+
| TRADE LOG TABLE                                                                   |
|-----------------------------------------------------------------------------------|
| #  DATE/TIME       SYM    SIDE  LOTS  ENTRY    EXIT     PNL ($)   R-MULT  STRATEGY  |
| 1  2024-01-15 14:35 EURUSD LONG  1.00  1.08500  1.09000  +$500.00  +2.50R  Liquidity |
| 2  2024-01-16 09:15 EURUSD SHORT 0.50  1.08900  1.09100  -$100.00  -1.00R  Breakout  |
+-----------------------------------------------------------------------------------+
   | (Click trade row opens Slide-Over Drawer)
   V
+-----------------------------------------------------------------------------------+
| TRADE DETAIL DRAWER (Trade #1 - EURUSD LONG)                            [ X ]     |
|-----------------------------------------------------------------------------------|
| [ CHART SNAPSHOT IMAGE WITH ENTRY/EXIT ARROWS ]                                  |
|-----------------------------------------------------------------------------------|
|  Net PnL: +$500.00    |  R-Multiple: +2.50R   |  Hold Time: 45 mins               |
|  Execution: 5/5 Star  |  Mistake Tag: None    |  Playbook: Liquidity Sweep        |
|-----------------------------------------------------------------------------------|
|  [ BAR-BY-BAR TRADE REPLAY ] [|<] [ PLAY ] [>|]  (Replays trade candles only)     |
+-----------------------------------------------------------------------------------+
```

### Visual & Functional Breakdown

1. **Trade Log Table (`TradeLog.tsx`)**:
   - Displays all historical completed trades.
   - Sortable columns: Trade ID, Timestamp, Symbol, Direction (Long/Short), Volume, Entry Price, Exit Price, Net PnL ($), R-Multiple, Duration, Strategy Tag, Mistake Tag.
2. **Slide-Over Trade Detail Drawer (`TradeDetailDrawer.tsx`)**:
   - Slide-over drawer panel from right side of screen.
   - **Chart Snapshot**: Automatic high-resolution screenshot image with entry buy arrow and exit sell arrow.
   - **Dedicated Trade Replay Engine**: Replay only the specific candles during which that single trade was active.
   - **Metrics Breakdown**: Gross PnL, Net PnL, Commission, MAE (Max Adverse Excursion), MFE (Max Favorable Excursion), R-Multiple efficiency.
3. **Filtered Trade Review (`FilteredTradeReview.tsx`)**:
   - Multi-select filters by Strategy, Session Time of Day (London/NY/Asia), Setup Score, or Error Tag.

---

## 10. Trade Journal, Playbook & Strategy Engine

**Files**: [JournalEntryModal.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/components/JournalEntryModal.tsx), [PlaybookBoard.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/components/PlaybookBoard.tsx)

> `[VIDEO SCENE PROMPT 9.0]`: *Showcase of the Trade Journal modal and Playbook builder. User tags a trade with "FOMO Entry", assigns a 3-star rating, writes rich text notes, and tracks strategy win-rate.*

```
+-----------------------------------------------------------------------------------+
| TRADE JOURNAL ENTRY MODAL                                               [ X ]     |
|-----------------------------------------------------------------------------------|
|  Strategy Tag:  [ Liquidity Sweep + MSS  v ]    Discipline Rating: [ * * * * * ]  |
|  Mistake Tags:  [ FOMO Entry x ] [ Moved Stop Loss x ]  [ + Add Custom Tag ]      |
|-----------------------------------------------------------------------------------|
|  RICH TEXT JOURNAL NARRATIVE EDITOR                                               |
|  [Bold] [Italic] [Underline] [List] [Quote] [Attach Image]                        |
|  "Entered after liquidity sweep of Asia High. Executed well but took partials    |
|   slightly too early due to minor impatience."                                    |
|-----------------------------------------------------------------------------------|
|  [ SAVE JOURNAL ENTRY ]                                                           |
+-----------------------------------------------------------------------------------+
```

### Visual & Functional Breakdown

1. **Trade Journal Entry Modal (`JournalEntryModal.tsx`)**:
   - **Strategy Selector**: Tag trades with custom playbook strategy names.
   - **Mistake Tagging System**: Select from pre-defined or custom error tags (*"FOMO Entry"*, *"Chased Price"*, *"Moved Stop Loss"*, *"Early Exit"*, *"Over-leveraged"*).
   - **Discipline & Emotional Rating**: 1 to 5 Star interactive rating selector.
   - **Rich Text Editor**: Full WYSIWYG editor supporting text formatting, bullet lists, blockquotes, and screenshot attachments.
2. **Playbook Board (`PlaybookBoard.tsx`)**:
   - Strategy rulebook builder. Create setup categories, define entry/exit rules, and attach verification checklists.
   - Calculates aggregate win-rate, total R-multiple generated, and profit factor per strategy rulebook.

---

## 11. Executive Dashboard & Advanced Analytics

**Files**: [ResultsPanel.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/components/ResultsPanel.tsx), [EquityCurve.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/components/EquityCurve.tsx), [MetricsBar.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/components/MetricsBar.tsx), [ReportsPanel.tsx](file:///Users/speketi/Projects/EdgeLab/frontend/src/components/ReportsPanel.tsx)

> `[VIDEO SCENE PROMPT 10.0]`: *Full screen reveal of the Executive Performance Dashboard. The glowing Visx equity curve trends upward with green profit peaks while performance heatmaps illuminate high-win rate trading hours.*

```
+-----------------------------------------------------------------------------------+
| EXECUTIVE PERFORMANCE DASHBOARD                                                   |
|-----------------------------------------------------------------------------------|
| [ METRICS BAR ]                                                                   |
| NET PROFIT: +$24,500  | WIN RATE: 68.4% | PROFIT FACTOR: 2.45 | EXPECTANCY: +1.85R |
| TOTAL TRADES: 84     | MAX DD: -4.2%   | SHARPE RATIO: 2.18 | AVG R-MULT: +1.42R |
|-----------------------------------------------------------------------------------|
| INTERACTIVE EQUITY & DRAWDOWN CURVE (Visx Engine)                                  |
|  $125k |                                            /---\                         |
|  $115k |                     /---\        /--------/     \                        |
|  $105k |          /---------/     \------/                \                       |
|  $100k |_________/                                         \_____ (Peak Equity)   |
|        [ Drawdown Shading Area: -4.2% Max DD ]                                    |
|-----------------------------------------------------------------------------------|
| [ HOURLY / DAILY PERFORMANCE HEATMAP ]     | [ WIN / LOSS DISTRIBUTION ]          |
| MON  TUE  WED  THU  FRI                    |  Win R:  |||||||||||| (+3.0R Avg)    |
| [08:00] [ High Win Rate: 82% Green ]       |  Loss R: |||| (-1.0R Fixed)          |
+-----------------------------------------------------------------------------------+
```

### Key Performance Analytics Breakdown

1. **Executive Metrics Bar (`MetricsBar.tsx`)**:
   - **Net Profit ($)**: Total net PnL after commissions and fees.
   - **Profit Factor**: Gross Profit divided by Gross Loss (e.g. `2.45`).
   - **Win Rate (%)**: Percentage of winning trades (e.g. `68.4%`).
   - **Expectancy**: Expected return per trade in R-multiples (e.g. `+1.85R`).
   - **Sharpe & Sortino Ratios**: Risk-adjusted performance metrics.
   - **Max Drawdown ($ and %)**: Peak-to-trough equity decline.
2. **Interactive Equity & Drawdown Curve (`EquityCurve.tsx`)**:
   - Visx-powered high-performance area and line chart.
   - **Peak Equity Benchmark**: Dashed line representing all-time high balance.
   - **Drawdown Depth Shading**: Translucent red shaded region highlighting drawdowns.
   - **Trade Hover Markers**: Hover over any data point to display exact trade details and balance.
3. **Deep Analytics Reports (`ReportsPanel.tsx`)**:
   - **Hourly/Daily Performance Heatmaps (`BacklitHeatmapCells`)**: Matrix identifying optimal trading sessions and hours.
   - **Win/Loss R-Multiple Histograms**: Distribution of trade outcomes in R.
   - **Hold-Time Correlation Scatter Plot**: Trade duration vs profitability.
   - **Mistake Cost Analysis**: Quantifies exact dollar cost of trade mistakes (e.g. *"FOMO entries cost -$3,200 total"*).

---

## 12. Auxiliary Power Tools & System Settings

### 12.1 Macro Economic Calendar
- **Integration**: Live Forex Factory economic news sync.
- **Visual Display**: Red/Orange/Yellow high-impact event markers overlaid on replay timeline (e.g. CPI, NFP, FOMC Interest Rate Decision).

### 12.2 Position Size Calculator Tool
- **Standalone Tool**: Quick lot-size calculator for Forex, Crypto, and Indices based on stop loss pips, account currency, and risk percentage.

### 12.3 Multi-Account Manager (`journalAccounts`)
- **Portfolio Management**: Manage multiple virtual trading accounts (e.g., "$100k Prop Challenge", "$50k Live Account") within a unified dashboard.

### 12.4 Platform Settings & Preferences (`globalSettings`)
- **Custom Hotkeys Manager**: Re-bind execution shortcuts for Buy, Sell, Close All, Replay Step, and Timeframe switching.
- **Commission & Fee Settings**: Set default commission modes per instrument asset class.
- **Theme & Color Customizer (`ThemedColorPicker`)**: Customize chart background, candle colors, order line styles, and UI accent colors.

---

## Summary Scripting Cheat Sheet for Video Production

| Video Scene | Primary Screen / Component | Key Visual Highlight to Capture | Script Voiceover Key Points |
| :--- | :--- | :--- | :--- |
| **Scene 1** | Landing Page & Hero Demo | Glowing dark hero section with mini live chart | "Welcome to EdgeLab—the tick-accurate backtesting platform built for serious traders." |
| **Scene 2** | Session Gateway | Dataset catalog & risk parameters modal | "Select from millions of M1 candles, set your prop firm balance, and configure realistic commissions." |
| **Scene 3** | Workspace & Charting | Multi-pane 4-chart layout with indicators | "Analyze market structure across multiple synchronized timeframes with zero forward bias." |
| **Scene 4** | Drawing Suite & Fib | Fibonacci retracement & Long Position box | "Draw precision supply/demand zones and project instant Risk:Reward ratios right on your chart." |
| **Scene 5** | Replay Controller | Speed slider moving from 1x to 10x replay | "Speed up tick replay, step bar-by-bar, or time-travel to any date in trading history." |
| **Scene 6** | Order Ticket Terminal | Buying market & dragging SL order line | "Execute market, limit, or stop orders with auto-calculated lot sizing and drag-and-drop stop losses." |
| **Scene 7** | Trade Detail Drawer | Slide-over drawer with bar replay & PnL | "Review past trades with automatic chart snapshots and dedicated bar-by-bar trade replays." |
| **Scene 8** | Journal & Playbook | Rich text journal & error tagging | "Tag mistakes like FOMO entries and validate your playbook rules with 5-star discipline scores." |
| **Scene 9** | Executive Dashboard | Glowing Visx equity curve & heatmaps | "Track your equity growth, profit factor, drawdown, and hourly performance heatmaps in real-time." |

---
*Guide compiled for EdgeLab Beta Launch Video Production & Product Marketing.*
