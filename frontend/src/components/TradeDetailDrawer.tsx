import { X } from "lucide-react";
import type { Execution, Trade } from "../lib/api";
import { formatPrice } from "../lib/format";

type Props = {
  trade: Trade;
  executions: Execution[];
  onClose: () => void;
  onJournal: (trade: Trade) => void;
};

export function TradeDetailDrawer({ trade, executions, onClose, onJournal }: Props) {
  const tradeExecutions = executions.filter(
    (execution) => execution.offset >= trade.entry_offset && (!trade.exit_offset || execution.offset <= trade.exit_offset),
  );

  return (
    <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-xl overflow-auto border-l border-white/10 bg-ink-900 shadow-panel">
      <div className="sticky top-0 flex h-14 items-center justify-between border-b border-white/10 bg-ink-900 px-5">
        <div>
          <h2 className="text-base font-semibold text-white">Trade #{trade.id}</h2>
          <p className="text-xs text-slate-500">{trade.side} · {trade.status}</p>
        </div>
        <button className="icon-button" onClick={onClose} type="button">
          <X size={18} />
        </button>
      </div>

      <div className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Metric label="Entry" value={formatPrice(trade.entry_price)} />
          <Metric label="Exit" value={formatPrice(trade.exit_price)} />
          <Metric label="PnL" value={money(trade.realized_pnl)} tone={trade.realized_pnl >= 0 ? "text-emerald-300" : "text-rose-300"} />
          <Metric label="R" value={trade.r_multiple?.toFixed(2) ?? "—"} />
          <Metric label="Qty" value={trade.quantity.toLocaleString()} />
          <Metric label="Remaining" value={trade.remaining_quantity.toLocaleString()} />
        </div>

        <div className="rounded-md bg-ink-950 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Journal</h3>
            <button className="control-button h-8" onClick={() => onJournal(trade)} type="button">
              Edit
            </button>
          </div>
          <p className="whitespace-pre-wrap text-sm text-slate-300">{trade.notes || "No notes yet"}</p>
          {trade.mistake_tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {trade.mistake_tags.map((tag) => (
                <span key={tag} className="rounded bg-rose-300/10 px-2 py-1 text-xs text-rose-100">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-md bg-ink-950 p-3">
          <h3 className="mb-2 text-sm font-semibold text-white">Executions</h3>
          <div className="space-y-2">
            {tradeExecutions.map((execution) => (
              <div key={execution.id} className="flex justify-between text-sm">
                <span className={execution.side === "BUY" ? "text-emerald-300" : "text-rose-300"}>{execution.side}</span>
                <span>{execution.quantity.toLocaleString()} @ {formatPrice(execution.price)}</span>
              </div>
            ))}
            {tradeExecutions.length === 0 && <div className="text-sm text-slate-500">No executions linked</div>}
          </div>
        </div>

        {trade.screenshot_url && (
          <img
            alt="Trade screenshot"
            className="w-full rounded-md border border-white/10"
            src={trade.screenshot_url}
          />
        )}
      </div>
    </aside>
  );
}

function Metric({ label, value, tone = "text-slate-100" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md bg-ink-950 px-3 py-2">
      <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}
