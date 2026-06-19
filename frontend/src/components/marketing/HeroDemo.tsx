import { startTransition, useEffect, useState } from "react";
import { EquityCurve } from "../EquityCurve";
import { ExecutionTape } from "../ExecutionTape";
import { MetricsBar } from "../MetricsBar";
import { PlaybookBoard } from "../PlaybookBoard";
import type { Execution, Metrics, Playbook, Trade } from "../../lib/api";

type DemoScenario = {
  id: string;
  label: string;
  metrics: Metrics;
  note: string;
  playbooks: Playbook[];
  trades: Trade[];
  executions: Execution[];
};

function buildMetrics(netPnl: number, winRate: number, totalTrades: number, values: number[]): Metrics {
  return {
    net_pnl: netPnl,
    win_rate: winRate,
    total_trades: totalTrades,
    profit_factor: 1.84,
    max_drawdown: -412,
    sharpe_ratio: 1.42,
    average_r: 0.68,
    best_trade: 532,
    worst_trade: -184,
    longest_win_streak: 4,
    longest_loss_streak: 2,
    equity_curve: values.map((equity, index) => ({
      timestamp: `2026-06-${String(index + 2).padStart(2, "0")}T09:30:00Z`,
      equity,
    })),
    strategy_performance: [
      {
        strategy_name: "London Break",
        trades: Math.max(6, Math.round(totalTrades * 0.46)),
        net_pnl: netPnl * 0.58,
        win_rate: Math.min(0.78, winRate + 0.04),
        average_r: 0.74,
      },
      {
        strategy_name: "NY Reversal",
        trades: Math.max(4, Math.round(totalTrades * 0.32)),
        net_pnl: netPnl * 0.29,
        win_rate: Math.max(0.36, winRate - 0.05),
        average_r: 0.49,
      },
    ],
    side_breakdown: [
      {
        side: "LONG",
        trades: Math.max(1, Math.round(totalTrades * 0.57)),
        net_pnl: netPnl * 0.64,
        win_rate: Math.min(0.82, winRate + 0.03),
      },
      {
        side: "SHORT",
        trades: Math.max(1, totalTrades - Math.round(totalTrades * 0.57)),
        net_pnl: netPnl * 0.36,
        win_rate: Math.max(0.3, winRate - 0.02),
      },
    ],
    calendar: values.slice(-6).map((equity, index, collection) => {
      const previous = index === 0 ? values[Math.max(0, values.length - 7)] ?? equity : collection[index - 1];
      return {
        date: `2026-06-${String(index + 10).padStart(2, "0")}`,
        pnl: equity - previous,
        trades: Math.max(1, Math.round(totalTrades / 6)),
      };
    }),
  };
}

const PLAYBOOKS: Playbook[] = [
  {
    id: 1,
    name: "London Break",
    description: "Hold until structure fails or take-profit prints.",
    rules: null,
    created_at: "2026-06-01T00:00:00Z",
  },
  {
    id: 2,
    name: "NY Reversal",
    description: "Fade extension only after sweep and reclaim.",
    rules: null,
    created_at: "2026-06-01T00:00:00Z",
  },
  {
    id: 3,
    name: "Trend Continuation",
    description: "Join pullback only when momentum confirms.",
    rules: null,
    created_at: "2026-06-01T00:00:00Z",
  },
];

const SCENARIOS: DemoScenario[] = [
  {
    id: "replay",
    label: "Replay session",
    note: "Actual EdgeLab metrics, curve, tape, and playbook widgets.",
    metrics: buildMetrics(1426, 0.581, 31, [0, 112, 260, 208, 442, 615, 588, 756, 921, 1108, 1264, 1426]),
    executions: [
      {
        id: 11,
        session_id: 7,
        order_id: 201,
        side: "BUY",
        timestamp: "2026-06-12T09:42:00Z",
        offset: 42,
        price: 4281.25,
        quantity: 2,
        realized_pnl: 0,
        position_side_after: "LONG",
        position_quantity_after: 2,
        created_at: "2026-06-12T09:42:00Z",
      },
      {
        id: 12,
        session_id: 7,
        order_id: 202,
        side: "SELL",
        timestamp: "2026-06-12T09:58:00Z",
        offset: 58,
        price: 4289.75,
        quantity: 1,
        realized_pnl: 174,
        position_side_after: "LONG",
        position_quantity_after: 1,
        created_at: "2026-06-12T09:58:00Z",
      },
      {
        id: 13,
        session_id: 7,
        order_id: 203,
        side: "SELL",
        timestamp: "2026-06-12T10:06:00Z",
        offset: 66,
        price: 4295.5,
        quantity: 1,
        realized_pnl: 286,
        position_side_after: "FLAT",
        position_quantity_after: 0,
        created_at: "2026-06-12T10:06:00Z",
      },
    ],
    trades: [
      {
        id: 101,
        session_id: 7,
        status: "CLOSED",
        side: "LONG",
        entry_time: "2026-06-12T09:42:00Z",
        entry_offset: 42,
        entry_price: 4281.25,
        quantity: 2,
        remaining_quantity: 0,
        stop_loss: 4276.5,
        take_profit: 4296,
        exit_time: "2026-06-12T10:06:00Z",
        exit_offset: 66,
        exit_price: 4295.5,
        gross_pnl: 460,
        realized_pnl: 460,
        r_multiple: 2.2,
        commission_mode: "NONE",
        commission_value: 0,
        commission_amount: 0,
        fee_mode: "NONE",
        fee_value: 0,
        fee_amount: 0,
        strategy_name: "London Break",
        playbook_id: 1,
        notes: "Held structure clean. Exit followed plan.",
        mistake_tags: [],
        emotional_state: "calm",
        screenshot_url: null,
      },
      {
        id: 102,
        session_id: 7,
        status: "CLOSED",
        side: "SHORT",
        entry_time: "2026-06-12T11:18:00Z",
        entry_offset: 118,
        entry_price: 4302.1,
        quantity: 1,
        remaining_quantity: 0,
        stop_loss: 4308.4,
        take_profit: 4290.2,
        exit_time: "2026-06-12T11:36:00Z",
        exit_offset: 136,
        exit_price: 4293.6,
        gross_pnl: 168,
        realized_pnl: 168,
        r_multiple: 1.4,
        commission_mode: "NONE",
        commission_value: 0,
        commission_amount: 0,
        fee_mode: "NONE",
        fee_value: 0,
        fee_amount: 0,
        strategy_name: "NY Reversal",
        playbook_id: 2,
        notes: null,
        mistake_tags: ["late partial"],
        emotional_state: "focused",
        screenshot_url: null,
      },
      {
        id: 103,
        session_id: 7,
        status: "CLOSED",
        side: "LONG",
        entry_time: "2026-06-13T09:51:00Z",
        entry_offset: 51,
        entry_price: 4275.4,
        quantity: 1,
        remaining_quantity: 0,
        stop_loss: 4270.9,
        take_profit: 4284.9,
        exit_time: "2026-06-13T10:05:00Z",
        exit_offset: 65,
        exit_price: 4272.8,
        gross_pnl: -52,
        realized_pnl: -52,
        r_multiple: -0.6,
        commission_mode: "NONE",
        commission_value: 0,
        commission_amount: 0,
        fee_mode: "NONE",
        fee_value: 0,
        fee_amount: 0,
        strategy_name: "Trend Continuation",
        playbook_id: 3,
        notes: "Chased too close to highs.",
        mistake_tags: ["late entry"],
        emotional_state: "impatient",
        screenshot_url: null,
      },
    ],
    playbooks: PLAYBOOKS,
  },
  {
    id: "journal",
    label: "Journal review",
    note: "Review queue, tags, and closed-trade context stay on same desk.",
    metrics: buildMetrics(986, 0.544, 24, [0, 85, 142, 318, 276, 344, 478, 632, 590, 728, 814, 986]),
    executions: [
      {
        id: 21,
        session_id: 8,
        order_id: 301,
        side: "SELL",
        timestamp: "2026-06-14T13:02:00Z",
        offset: 32,
        price: 191.4,
        quantity: 300,
        realized_pnl: 0,
        position_side_after: "SHORT",
        position_quantity_after: 300,
        created_at: "2026-06-14T13:02:00Z",
      },
      {
        id: 22,
        session_id: 8,
        order_id: 302,
        side: "BUY",
        timestamp: "2026-06-14T13:18:00Z",
        offset: 48,
        price: 190.3,
        quantity: 300,
        realized_pnl: 330,
        position_side_after: "FLAT",
        position_quantity_after: 0,
        created_at: "2026-06-14T13:18:00Z",
      },
      {
        id: 23,
        session_id: 8,
        order_id: 303,
        side: "BUY",
        timestamp: "2026-06-14T14:10:00Z",
        offset: 100,
        price: 190.85,
        quantity: 200,
        realized_pnl: -94,
        position_side_after: "FLAT",
        position_quantity_after: 0,
        created_at: "2026-06-14T14:10:00Z",
      },
    ],
    trades: [
      {
        id: 201,
        session_id: 8,
        status: "CLOSED",
        side: "SHORT",
        entry_time: "2026-06-14T13:02:00Z",
        entry_offset: 32,
        entry_price: 191.4,
        quantity: 300,
        remaining_quantity: 0,
        stop_loss: 192.05,
        take_profit: 190.1,
        exit_time: "2026-06-14T13:18:00Z",
        exit_offset: 48,
        exit_price: 190.3,
        gross_pnl: 330,
        realized_pnl: 330,
        r_multiple: 1.8,
        commission_mode: "NONE",
        commission_value: 0,
        commission_amount: 0,
        fee_mode: "NONE",
        fee_value: 0,
        fee_amount: 0,
        strategy_name: "NY Reversal",
        playbook_id: 2,
        notes: null,
        mistake_tags: ["slow partial"],
        emotional_state: "steady",
        screenshot_url: null,
      },
      {
        id: 202,
        session_id: 8,
        status: "CLOSED",
        side: "LONG",
        entry_time: "2026-06-14T14:03:00Z",
        entry_offset: 93,
        entry_price: 190.52,
        quantity: 200,
        remaining_quantity: 0,
        stop_loss: 190.1,
        take_profit: 191.45,
        exit_time: "2026-06-14T14:10:00Z",
        exit_offset: 100,
        exit_price: 190.05,
        gross_pnl: -94,
        realized_pnl: -94,
        r_multiple: -1.1,
        commission_mode: "NONE",
        commission_value: 0,
        commission_amount: 0,
        fee_mode: "NONE",
        fee_value: 0,
        fee_amount: 0,
        strategy_name: "Trend Continuation",
        playbook_id: 3,
        notes: "Forced long against flow.",
        mistake_tags: ["countertrend"],
        emotional_state: "frustrated",
        screenshot_url: null,
      },
      {
        id: 203,
        session_id: 8,
        status: "CLOSED",
        side: "SHORT",
        entry_time: "2026-06-15T10:10:00Z",
        entry_offset: 28,
        entry_price: 192.2,
        quantity: 150,
        remaining_quantity: 0,
        stop_loss: 192.85,
        take_profit: 191.4,
        exit_time: "2026-06-15T10:24:00Z",
        exit_offset: 42,
        exit_price: 191.55,
        gross_pnl: 98,
        realized_pnl: 98,
        r_multiple: 1.1,
        commission_mode: "NONE",
        commission_value: 0,
        commission_amount: 0,
        fee_mode: "NONE",
        fee_value: 0,
        fee_amount: 0,
        strategy_name: "NY Reversal",
        playbook_id: 2,
        notes: "Better patience this pass.",
        mistake_tags: [],
        emotional_state: "focused",
        screenshot_url: null,
      },
    ],
    playbooks: PLAYBOOKS,
  },
  {
    id: "analytics",
    label: "Analytics pass",
    note: "Metrics stay tied to executions and playbook context, not separate dashboards.",
    metrics: buildMetrics(1874, 0.603, 37, [0, 164, 298, 552, 488, 736, 924, 1160, 1318, 1514, 1688, 1874]),
    executions: [
      {
        id: 31,
        session_id: 9,
        order_id: 401,
        side: "BUY",
        timestamp: "2026-06-16T08:48:00Z",
        offset: 18,
        price: 1.0842,
        quantity: 120000,
        realized_pnl: 0,
        position_side_after: "LONG",
        position_quantity_after: 120000,
        created_at: "2026-06-16T08:48:00Z",
      },
      {
        id: 32,
        session_id: 9,
        order_id: 402,
        side: "SELL",
        timestamp: "2026-06-16T09:06:00Z",
        offset: 36,
        price: 1.0861,
        quantity: 120000,
        realized_pnl: 228,
        position_side_after: "FLAT",
        position_quantity_after: 0,
        created_at: "2026-06-16T09:06:00Z",
      },
      {
        id: 33,
        session_id: 9,
        order_id: 403,
        side: "SELL",
        timestamp: "2026-06-16T11:11:00Z",
        offset: 101,
        price: 1.0878,
        quantity: 100000,
        realized_pnl: 142,
        position_side_after: "FLAT",
        position_quantity_after: 0,
        created_at: "2026-06-16T11:11:00Z",
      },
    ],
    trades: [
      {
        id: 301,
        session_id: 9,
        status: "CLOSED",
        side: "LONG",
        entry_time: "2026-06-16T08:48:00Z",
        entry_offset: 18,
        entry_price: 1.0842,
        quantity: 120000,
        remaining_quantity: 0,
        stop_loss: 1.0828,
        take_profit: 1.0864,
        exit_time: "2026-06-16T09:06:00Z",
        exit_offset: 36,
        exit_price: 1.0861,
        gross_pnl: 228,
        realized_pnl: 228,
        r_multiple: 1.5,
        commission_mode: "NONE",
        commission_value: 0,
        commission_amount: 0,
        fee_mode: "NONE",
        fee_value: 0,
        fee_amount: 0,
        strategy_name: "London Break",
        playbook_id: 1,
        notes: "Stayed with opening range expansion.",
        mistake_tags: [],
        emotional_state: "clear",
        screenshot_url: null,
      },
      {
        id: 302,
        session_id: 9,
        status: "CLOSED",
        side: "SHORT",
        entry_time: "2026-06-16T10:43:00Z",
        entry_offset: 83,
        entry_price: 1.0886,
        quantity: 100000,
        remaining_quantity: 0,
        stop_loss: 1.0894,
        take_profit: 1.0871,
        exit_time: "2026-06-16T11:11:00Z",
        exit_offset: 101,
        exit_price: 1.0878,
        gross_pnl: 80,
        realized_pnl: 80,
        r_multiple: 0.8,
        commission_mode: "NONE",
        commission_value: 0,
        commission_amount: 0,
        fee_mode: "NONE",
        fee_value: 0,
        fee_amount: 0,
        strategy_name: "NY Reversal",
        playbook_id: 2,
        notes: null,
        mistake_tags: ["early cover"],
        emotional_state: "calm",
        screenshot_url: null,
      },
      {
        id: 303,
        session_id: 9,
        status: "CLOSED",
        side: "LONG",
        entry_time: "2026-06-17T09:12:00Z",
        entry_offset: 22,
        entry_price: 1.0834,
        quantity: 100000,
        remaining_quantity: 0,
        stop_loss: 1.0826,
        take_profit: 1.0858,
        exit_time: "2026-06-17T09:38:00Z",
        exit_offset: 48,
        exit_price: 1.0859,
        gross_pnl: 250,
        realized_pnl: 250,
        r_multiple: 2.1,
        commission_mode: "NONE",
        commission_value: 0,
        commission_amount: 0,
        fee_mode: "NONE",
        fee_value: 0,
        fee_amount: 0,
        strategy_name: "Trend Continuation",
        playbook_id: 3,
        notes: "Clean pullback continuation.",
        mistake_tags: [],
        emotional_state: "steady",
        screenshot_url: null,
      },
    ],
    playbooks: PLAYBOOKS,
  },
];

export function HeroDemo() {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const scenario = SCENARIOS[scenarioIndex] ?? SCENARIOS[0];

  useEffect(() => {
    const timer = window.setInterval(() => {
      startTransition(() => {
        setScenarioIndex((current) => (current + 1) % SCENARIOS.length);
      });
    }, 4600);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[#081019]/92 p-4 shadow-[0_36px_90px_rgba(0,0,0,0.45)] backdrop-blur-xl">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/50 to-transparent" />

      <div className="rounded-[24px] border border-white/10 bg-black/25 px-4 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-100/70">
              Live surface preview
            </div>
            <div className="mt-2 text-2xl font-semibold text-white">{scenario.label}</div>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-400">{scenario.note}</p>
          </div>
          <div className="rounded-full border border-cyan-300/15 bg-cyan-300/10 px-4 py-2 text-xs uppercase tracking-[0.18em] text-cyan-50">
            Real EdgeLab widgets
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {SCENARIOS.map((item, index) => (
            <button
              key={item.id}
              className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${
                index === scenarioIndex
                  ? "border-cyan-300/25 bg-cyan-300/12 text-cyan-50"
                  : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-cyan-300/20 hover:text-cyan-50"
              }`}
              onClick={() => {
                startTransition(() => {
                  setScenarioIndex(index);
                });
              }}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <MetricsBar metrics={scenario.metrics} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.06fr)_minmax(280px,0.94fr)]">
        <EquityCurve metrics={scenario.metrics} />
        <ExecutionTape executions={scenario.executions} />
      </div>

      <div className="mt-4">
        <PlaybookBoard playbooks={scenario.playbooks} trades={scenario.trades} />
      </div>
    </div>
  );
}
