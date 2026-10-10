import { useEffect, useRef } from "react";
import { Edit3 } from "lucide-react";
import type { Trade } from "../lib/api";
import { formatDateTime, formatMoney, formatPrice } from "../lib/format";

export type TradeLogContext = {
  currency?: string;
  instrument: string;
  instrumentDetail?: string;
  strategy: string;
};

type Props = {
  currency?: string;
  trades: Trade[];
  onEdit?: (trade: Trade) => void;
  onInspect: (trade: Trade) => void;
  onScrollTopChange?: (scrollTop: number) => void;
  onScrollTopRestored?: () => void;
  restoreScrollTop?: number | null;
  tradeContext?: (trade: Trade) => TradeLogContext;
};

export function TradeLog({
  currency = "USD",
  tradeContext,
  trades,
  onInspect,
  onScrollTopChange,
  onScrollTopRestored,
  restoreScrollTop,
}: Props) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (restoreScrollTop == null) {
      return;
    }
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }
    const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    scrollContainer.scrollTop = Math.min(restoreScrollTop, maxScrollTop);
    onScrollTopRestored?.();
  }, [onScrollTopRestored, restoreScrollTop, trades.length]);

  return (
    <section className="min-w-0 rounded-md border border-[var(--ui-border-subtle)] bg-[var(--ui-surface)] shadow-panel">
      <div className="flex h-12 items-center justify-between border-b border-[var(--ui-border-subtle)] px-4">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Trade Log</h2>
        <span className="text-xs text-[var(--text-secondary)]">{trades.length} entries</span>
      </div>

      <div
        aria-label="Trade log table"
        role="region"
        tabIndex={0}
        className="max-h-[476px] overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ui-focus)]"
        onScroll={(event) => onScrollTopChange?.(event.currentTarget.scrollTop)}
        ref={scrollContainerRef}
      >
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="sticky top-0 bg-[var(--ui-surface)] text-xs uppercase tracking-[0.16em] text-[var(--text-secondary)]">
            <tr>
              <th className="px-4 py-3 font-medium">Instrument</th>
              <th className="px-4 py-3 font-medium">Entry</th>
              <th className="px-3 py-3 font-medium">Exit</th>
              <th className="px-3 py-3 font-medium">Side</th>
              <th className="px-3 py-3 font-medium">PnL</th>
              <th className="px-3 py-3 font-medium">Commission</th>
              <th className="px-3 py-3 font-medium">Fees</th>
              <th className="px-3 py-3 font-medium">R</th>
              <th className="px-3 py-3 font-medium">Strategy</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => {
              const context = tradeContext?.(trade);
              const rowCurrency = context?.currency ?? currency;
              return (
                <tr key={trade.id} className="border-t border-[var(--ui-border-subtle)] text-[var(--text-primary)]">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[var(--text-primary)]">
                      {context?.instrument ?? `Session #${trade.session_id}`}
                    </div>
                    {context?.instrumentDetail && (
                      <div className="text-xs text-[var(--text-secondary)]">
                        {context.instrumentDetail}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-[var(--text-primary)]">
                      {formatPrice(trade.entry_price)}
                    </div>
                    <div className="text-xs text-[var(--text-secondary)]">
                      {formatDateTime(trade.entry_time)}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-medium text-[var(--text-primary)]">
                      {formatPrice(trade.exit_price)}
                    </div>
                    <div className="text-xs text-[var(--text-secondary)]">
                      {formatDateTime(trade.exit_time)}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`rounded px-2 py-1 text-xs font-semibold ${
                        trade.side === "LONG"
                          ? "bg-[var(--profit-soft)] text-[var(--profit-text)]"
                          : "bg-[var(--loss-soft)] text-[var(--loss-text)]"
                      }`}
                    >
                      {trade.side}
                    </span>
                    <div className="mt-1 text-xs text-[var(--text-secondary)]">{trade.status}</div>
                  </td>
                  <td
                    className={`px-3 py-3 font-semibold ${
                      (trade.realized_pnl ?? 0) >= 0 ? "text-[var(--profit-text)]" : "text-[var(--loss-text)]"
                    }`}
                  >
                    {trade.realized_pnl == null ? "—" : formatMoney(trade.realized_pnl, rowCurrency)}
                  </td>
                  <td className="px-3 py-3 text-[var(--text-primary)]">
                    {formatMoney(trade.commission_amount ?? 0, rowCurrency)}
                  </td>
                  <td className="px-3 py-3 text-[var(--text-primary)]">
                    {formatMoney(trade.fee_amount ?? 0, rowCurrency)}
                  </td>
                  <td className="px-3 py-3 text-[var(--text-primary)]">
                    {trade.r_multiple == null ? "—" : trade.r_multiple.toFixed(2)}
                  </td>
                  <td className="px-3 py-3 text-[var(--text-primary)]">
                    {context?.strategy ?? trade.strategy_name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      className="control-button h-10"
                      onClick={() => onInspect(trade)}
                      type="button"
                    >
                      <Edit3 size={15} />
                      Review
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {trades.length === 0 && (
          <div className="grid h-44 place-items-center text-sm text-[var(--text-secondary)]">
            No trades yet
          </div>
        )}
      </div>
    </section>
  );
}
