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
    sourceComponents: ["TradingChart", "ReplayController", "OrderTicket", "PositionPanel"],
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
      className="actual-scene-frame h-[2160px] w-[3840px] overflow-hidden bg-background text-foreground"
      data-actual-component-scene={scene.id}
      data-source-components={scene.sourceComponents.join(",")}
    >
      <div className="h-full w-full overflow-hidden p-10">
        {scene.render()}
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
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_520px] gap-5">
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
          undoShortcutLabel="Cmd+Z"
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
    <div className="grid h-full min-h-0 grid-cols-[560px_minmax(0,1fr)] gap-5">
      <div className="grid min-h-0 gap-4">
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
