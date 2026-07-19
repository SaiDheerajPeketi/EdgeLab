import React, { useEffect } from "react";
import "@fontsource-variable/syne";
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "../../../frontend/src/styles.css";
import { SessionGateway } from "../../../frontend/src/components/SessionGateway";
import { ResultsPanel } from "../../../frontend/src/components/ResultsPanel";
import { PlaybookBoard } from "../../../frontend/src/components/PlaybookBoard";
import { TradeLog } from "../../../frontend/src/components/TradeLog";
import { OrderTicket } from "../../../frontend/src/components/OrderTicket";
import { PositionPanel } from "../../../frontend/src/components/PositionPanel";
import { ReplayController } from "../../../frontend/src/components/ReplayController";
import { TradingChart } from "../../../frontend/src/components/TradingChart";
import {
  EconomicCalendarPage,
  JournalWorkspacePage,
  PositionSizeCalculatorPage,
} from "../../../frontend/src/components/EdgeLabWorkspace";
import { DEFAULT_CHART_VISUAL_SETTINGS } from "../../../frontend/src/lib/chartSettings";
import { useBacktestStore } from "../../../frontend/src/store/backtestStore";
import {
  backtestState,
  candles,
  datasets,
  economicCalendar,
  journalController,
  metrics,
  playbooks,
  sessions,
  strategySummaries,
  trades,
} from "./mock-app-data";

export const ACTUAL_COMPONENT_SCENES = [
  {
    id: "session-gateway",
    title: "Session gateway",
    sourceComponents: ["SessionGateway"],
    render: () => <SessionGatewayScene />,
  },
  {
    id: "replay-engine-workspace",
    title: "Replay engine workspace",
    sourceComponents: ["TradingChart", "ReplayController"],
    render: () => <ReplayEngineScene />,
  },
  {
    id: "trade-journal-notes",
    title: "Trade journal / notes",
    sourceComponents: ["JournalWorkspacePage"],
    render: () => <JournalScene />,
  },
  {
    id: "playbooks",
    title: "Playbooks",
    sourceComponents: ["PlaybookBoard"],
    render: () => <PlaybooksScene />,
  },
  {
    id: "analytics-reports-dashboard",
    title: "Analytics / reports dashboard",
    sourceComponents: ["ResultsPanel"],
    render: () => <AnalyticsScene />,
  },
  {
    id: "position-order-tools",
    title: "Position / order tools",
    sourceComponents: ["OrderTicket", "PositionPanel", "TradeLog"],
    render: () => <PositionToolsScene />,
  },
  {
    id: "position-sizing-calculator",
    title: "Position sizing calculator",
    sourceComponents: ["PositionSizeCalculatorPage"],
    render: () => <PositionSizingScene />,
  },
  {
    id: "economic-calendar",
    title: "Economic calendar",
    sourceComponents: ["EconomicCalendarPage"],
    render: () => <EconomicCalendarScene />,
  },
];

export function ActualAppSceneFrame({ scene }) {
  seedBacktestStoreForCapture();
  useSeedBacktestStore();
  return (
    <section
      className="actual-scene-frame h-[2160px] w-[3840px] bg-[#05070a] text-slate-100"
      data-actual-component-scene={scene.id}
      data-source-components={scene.sourceComponents.join(",")}
    >
      <div className="flex h-full w-full flex-col gap-6 overflow-hidden p-14">
        <SceneHeader scene={scene} />
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-white/10 bg-[#071018] p-5 shadow-panel">
          {scene.render()}
        </div>
      </div>
    </section>
  );
}

export function seedBacktestStoreForCapture() {
  useBacktestStore.setState({
    bars: candles,
    barOffset: 0,
    datasets,
    state: backtestState,
    playbooks,
    resultSessions: sessions,
    resultTrades: trades,
    resultTradesLoaded: true,
    strategySummaries,
    isLoading: false,
    isLoadingMoreSessions: false,
    isPlaying: true,
    isStepping: false,
    speedMs: 80,
    error: null,
  });
}

function useSeedBacktestStore() {
  useEffect(() => {
    seedBacktestStoreForCapture();
  }, []);
}

function SceneHeader({ scene }) {
  return (
    <header className="flex items-end justify-between gap-8">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-cyan-200/70">
          Actual EdgeLab component capture
        </div>
        <h1 className="mt-4 font-display text-[76px] font-bold leading-none tracking-[-0.03em] text-white">
          {scene.title}
        </h1>
      </div>
      <div className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-5 py-2 text-[13px] font-bold uppercase tracking-[0.2em] text-cyan-100">
        3840 x 2160
      </div>
    </header>
  );
}

function SessionGatewayScene() {
  return (
    <SessionGateway
      datasets={datasets}
      isLoading={false}
      isLoadingMoreSessions={false}
      onCreatePlaybook={async (payload) => ({ id: 99, created_at: "2026-07-19T00:00:00Z", rules: null, ...payload })}
      onCreateSession={async () => {}}
      onDeleteSession={async () => {}}
      onLoadMoreSessions={async () => {}}
      onResumeSession={async () => {}}
      onUpdateSession={async () => sessions[0]}
      overrideInstrumentId="eurusd"
      overrideInstrumentMenuOpen
      overridePlaybookId="1"
      overrideResumingSessionId={101}
      overrideTimeframe="M15"
      playbooks={playbooks}
      session={sessions[0]}
      sessions={sessions}
      sessionsHasMore={false}
      strategySummaries={strategySummaries}
      trades={trades}
    />
  );
}

function ReplayEngineScene() {
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_440px] gap-5">
      <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-4">
        <TradingChart
          bars={candles}
          canUndoDrawingChange={false}
          chartSettings={DEFAULT_CHART_VISUAL_SETTINGS}
          chartStyle="candles"
          confirmOrderLineModifications={false}
          currency="USD"
          datasetTimeframe="M15"
          drawingTool="crosshair"
          drawings={[]}
          executions={backtestState.executions}
          indicatorInstances={[]}
          magnetMode="weak"
          neutralDrawingTool="crosshair"
          onAddDrawing={() => {}}
          onAmendOrder={() => {}}
          onClearDrawings={() => {}}
          onClosePositionFraction={() => {}}
          onDeleteDrawing={() => {}}
          onDrawingToolChange={() => {}}
          onMagnetModeChange={() => {}}
          onRemoveIndicator={() => {}}
          onSelectDrawing={() => {}}
          onToggleIndicatorVisibility={() => {}}
          onUndoDrawingChange={() => {}}
          onUpdateDrawing={() => {}}
          onUpdateIndicatorSettings={() => {}}
          onUpdatePosition={() => {}}
          orders={backtestState.orders}
          pnlMultiplier={100000}
          position={backtestState.position}
          selectedDrawingId={null}
          showOrderOverlays
          symbol="EURUSD"
          timeframe="M15"
          undoShortcutLabel="⌘Z"
        />
        <ReplayController
          isOrderPaneOpen
          onToggleOrderPane={() => {}}
          replayTimeframe="M15"
          replayTimeframeLabel="M15"
          replayTimeframeOptions={[{ label: "M1", value: "M1" }, { label: "M15", value: "M15" }, { label: "H1", value: "H1" }]}
        />
      </div>
      <div className="grid min-h-0 grid-rows-[auto_1fr] gap-4">
        <OrderTicket initialSide="BUY" playbooks={playbooks} />
        <PositionPanel currency="USD" position={backtestState.position} />
      </div>
    </div>
  );
}

function JournalScene() {
  return (
    <div className="h-full overflow-hidden">
      <JournalWorkspacePage
        journal={journalController}
        overrideFocusedJournalNoteTradeId={201}
        view="journalNotes"
      />
    </div>
  );
}

function PlaybooksScene() {
  return <PlaybookBoard playbooks={playbooks} trades={trades} />;
}

function AnalyticsScene() {
  return (
    <ResultsPanel
      activeSessionId={101}
      hideCsvAction
      metrics={metrics}
      sessions={sessions}
      trades={trades}
      view="overview"
    />
  );
}

function PositionToolsScene() {
  return (
    <div className="grid h-full min-h-0 grid-cols-[480px_minmax(0,1fr)] gap-5">
      <div className="grid gap-4">
        <OrderTicket initialSide="BUY" playbooks={playbooks} />
        <PositionPanel currency="USD" position={backtestState.position} />
      </div>
      <TradeLog
        tradeContext={() => ({ currency: "USD", instrument: "EURUSD", instrumentDetail: "M15 replay", strategy: "London Break" })}
        trades={trades}
        onInspect={() => {}}
      />
    </div>
  );
}

function PositionSizingScene() {
  return (
    <PositionSizeCalculatorPage
      overrideAccountSize="100000"
      overrideCopyTrigger={1}
      overrideInstrumentSymbol="EURUSD"
      overrideRiskPercent="0.75"
      overrideStopLossPips="26.7"
    />
  );
}

function EconomicCalendarScene() {
  return (
    <EconomicCalendarPage
      overrideCalendar={economicCalendar}
      overrideDetailEventTitle="Core CPI m/m"
      overrideImpactFilter="High"
    />
  );
}
