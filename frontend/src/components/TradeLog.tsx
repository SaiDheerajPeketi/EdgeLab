import { Edit3 } from "lucide-react";
import type { Trade } from "../lib/api";
import { formatDateTime, formatMoney, formatPrice } from "../lib/format";

type Props = {
  currency?: string;
  trades: Trade[];
  onEdit: (trade: Trade) => void;
  onInspect: (trade: Trade) => void;
};

export function TradeLog({ currency = "USD", trades, onEdit, onInspect }: Props) {
  return (
    <section className="min-w-0 rounded-md border border-white/10 bg-ink-850 shadow-panel">
      <div className="flex h-12 items-center justify-between border-b border-white/10 px-4">
        <h2 className="text-sm font-semibold text-white">Trade Log</h2>
        <span className="text-xs text-slate-400">{trades.length} entries</span>
      </div>

      <div className="max-h-[476px] overflow-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="sticky top-0 bg-ink-850 text-xs uppercase tracking-[0.16em] text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Entry</th>
              <th className="px-3 py-3 font-medium">Exit</th>
              <th className="px-3 py-3 font-medium">Side</th>
              <th className="px-3 py-3 font-medium">PnL</th>
              <th className="px-3 py-3 font-medium">R</th>
              <th className="px-3 py-3 font-medium">Strategy</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => (
              <tr key={trade.id} className="border-t border-white/10 text-slate-300">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-100">
                    {formatPrice(trade.entry_price)}
                  </div>
                  <div className="text-xs text-slate-500">
                    {formatDateTime(trade.entry_time)}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <div className="font-medium text-slate-100">
                    {formatPrice(trade.exit_price)}
                  </div>
                  <div className="text-xs text-slate-500">
                    {formatDateTime(trade.exit_time)}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <span
                    className={`rounded px-2 py-1 text-xs font-semibold ${
                      trade.side === "LONG"
                        ? "bg-emerald-300/10 text-emerald-200"
                        : "bg-rose-300/10 text-rose-200"
                    }`}
                  >
                    {trade.side}
                  </span>
                  <div className="mt-1 text-xs text-slate-500">{trade.status}</div>
                </td>
                <td
                  className={`px-3 py-3 font-semibold ${
                    (trade.realized_pnl ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"
                  }`}
                >
                  {trade.realized_pnl == null ? "—" : formatMoney(trade.realized_pnl, currency)}
                </td>
                <td className="px-3 py-3 text-slate-200">
                  {trade.r_multiple == null ? "—" : trade.r_multiple.toFixed(2)}
                </td>
                <td className="px-3 py-3 text-slate-300">
                  {trade.strategy_name || "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    className="icon-button"
                    onClick={() => onEdit(trade)}
                    title="Edit backtest review"
                    type="button"
                  >
                    <Edit3 size={16} />
                  </button>
                  <button
                    className="control-button ml-2 h-10"
                    onClick={() => onInspect(trade)}
                    type="button"
                  >
                    Review
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {trades.length === 0 && (
          <div className="grid h-44 place-items-center text-sm text-slate-500">
            No trades yet
          </div>
        )}
      </div>
    </section>
  );
}
