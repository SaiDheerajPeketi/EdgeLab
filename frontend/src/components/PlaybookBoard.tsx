import { BookOpenCheck, ClipboardCheck, Tags } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Playbook, Trade } from "../lib/api";
import { formatMoney } from "../lib/format";

type Props = {
  playbooks: Playbook[];
  trades: Trade[];
};

export function PlaybookBoard({ playbooks, trades }: Props) {
  const closed = trades.filter((trade) => trade.status === "CLOSED");
  const tagged = trades.filter((trade) => trade.mistake_tags.length > 0);
  const reviewQueue = trades.filter(
    (trade) => trade.status === "CLOSED" && !trade.notes,
  );

  return (
    <section className="terminal-panel p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">Playbook Control</h2>
          <p className="text-xs text-slate-500">Rules, review queue, and mistake tracking</p>
        </div>
        <BookOpenCheck size={18} className="text-cyan-200" />
      </div>

      <div className="grid min-w-0 gap-3 sm:grid-cols-3">
        <BoardStat icon={ClipboardCheck} label="Review Queue" value={String(reviewQueue.length)} />
        <BoardStat icon={Tags} label="Tagged Trades" value={String(tagged.length)} />
        <BoardStat
          icon={BookOpenCheck}
          label="Closed PnL"
          value={formatMoney(closed.reduce((sum, trade) => sum + trade.realized_pnl, 0))}
        />
      </div>

      <div className="mt-4 grid min-w-0 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {playbooks.map((playbook) => {
          const playbookTrades = trades.filter((trade) => trade.playbook_id === playbook.id);
          const pnl = playbookTrades.reduce((sum, trade) => sum + trade.realized_pnl, 0);
          return (
            <div key={playbook.id} className="min-w-0 rounded-md border border-white/10 bg-black/20 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm font-semibold text-white">{playbook.name}</span>
                <span className={pnl >= 0 ? "text-emerald-300" : "text-rose-300"}>
                  {formatMoney(pnl)}
                </span>
              </div>
              <div className="mt-2 text-xs text-slate-500">
                {playbookTrades.length} trades · {playbook.description || "No rule notes yet"}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function BoardStat({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-md bg-black/20 px-3 py-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-slate-500">
        <Icon size={14} />
        {label}
      </div>
      <div className="mt-2 truncate text-lg font-semibold text-white">{value}</div>
    </div>
  );
}
