import { Image, Plus, RefreshCw, Save, X } from "lucide-react";
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Execution, Trade } from "../lib/api";
import { formatDateTime, formatPrice } from "../lib/format";
import {
  loadStrategyMistakeTags,
  mergeTags,
  parseTagInput,
  persistStrategyMistakeTags,
  strategyTagScope,
} from "../lib/mistakeTags";
import { tradeStrategyName } from "../lib/strategy";
import { createTradeSnapshotDataUrl } from "../lib/tradeSnapshot";
import { useBacktestStore } from "../store/backtestStore";

type Props = {
  trade: Trade;
  executions: Execution[];
  onClose: () => void;
  onJournal: (trade: Trade) => void;
  strategyScope?: string | null;
};

export function TradeDetailDrawer({
  trade,
  executions,
  onClose,
  onJournal,
  strategyScope,
}: Props) {
  const updateJournal = useBacktestStore((state) => state.updateJournal);
  const [tags, setTags] = useState<string[]>(trade.mistake_tags);
  const [savedTags, setSavedTags] = useState<string[]>(trade.mistake_tags);
  const [customTag, setCustomTag] = useState("");
  const [savingTags, setSavingTags] = useState(false);
  const [snapshotUrl, setSnapshotUrl] = useState(trade.screenshot_url ?? "");
  const [snapshotStatus, setSnapshotStatus] = useState<
    "idle" | "loading" | "ready" | "saving" | "saved" | "error"
  >(trade.screenshot_url ? "ready" : "idle");
  const tagsRef = useRef(tags);
  const effectiveStrategyName = tradeStrategyName(trade, {
    name: null,
    strategy_name: strategyScope ?? null,
  });
  const activeStrategyScope = strategyTagScope(effectiveStrategyName);
  const [strategyTagOptions, setStrategyTagOptions] = useState<string[]>(() =>
    loadStrategyMistakeTags(activeStrategyScope),
  );
  const tradeExecutions = executions.filter(
    (execution) => execution.offset >= trade.entry_offset && (!trade.exit_offset || execution.offset <= trade.exit_offset),
  );
  const hasTagChanges = useMemo(
    () => tags.join("\u0000") !== savedTags.join("\u0000"),
    [savedTags, tags],
  );

  useEffect(() => {
    tagsRef.current = tags;
  }, [tags]);

  useEffect(() => {
    setTags(trade.mistake_tags);
    setSavedTags(trade.mistake_tags);
    setCustomTag("");
  }, [trade.id, trade.mistake_tags]);

  useEffect(() => {
    setStrategyTagOptions(loadStrategyMistakeTags(activeStrategyScope));
  }, [activeStrategyScope]);

  useEffect(() => {
    let cancelled = false;
    setSnapshotUrl(trade.screenshot_url ?? "");
    if (trade.screenshot_url) {
      setSnapshotStatus("ready");
      return () => {
        cancelled = true;
      };
    }

    async function generateAndSaveSnapshot() {
      setSnapshotStatus("loading");
      try {
        const snapshot = await createTradeSnapshotDataUrl(trade);
        if (cancelled) {
          return;
        }
        setSnapshotUrl(snapshot);
        setSnapshotStatus("saving");
        await updateJournal(trade.id, {
          notes: trade.notes ?? null,
          strategy_name: effectiveStrategyName,
          emotional_state: trade.emotional_state ?? null,
          screenshot_url: snapshot,
          mistake_tags: tagsRef.current,
        });
        if (!cancelled) {
          setSnapshotStatus("saved");
        }
      } catch {
        if (!cancelled) {
          setSnapshotStatus("error");
        }
      }
    }

    void generateAndSaveSnapshot();
    return () => {
      cancelled = true;
    };
  }, [effectiveStrategyName, trade.id, trade.screenshot_url, updateJournal]);

  async function regenerateSnapshot() {
    setSnapshotStatus("loading");
    try {
      const snapshot = await createTradeSnapshotDataUrl(trade);
      setSnapshotUrl(snapshot);
      setSnapshotStatus("saving");
      await updateJournal(trade.id, {
        notes: trade.notes ?? null,
        strategy_name: effectiveStrategyName,
        emotional_state: trade.emotional_state ?? null,
        screenshot_url: snapshot,
        mistake_tags: tagsRef.current,
      });
      setSnapshotStatus("saved");
    } catch {
      setSnapshotStatus("error");
    }
  }

  function addTags(value: string) {
    const nextTags = parseTagInput(value);
    if (nextTags.length === 0) {
      return;
    }
    persistStrategyMistakeTags(activeStrategyScope, nextTags);
    setStrategyTagOptions((current) => mergeTags(current, nextTags));
    setTags((current) => mergeTags(current, nextTags));
    setCustomTag("");
  }

  function removeTag(tag: string) {
    setTags((current) => current.filter((currentTag) => currentTag !== tag));
  }

  function handleCustomTagKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    addTags(customTag);
  }

  async function saveTags() {
    const nextTags = [...tags];
    setSavingTags(true);
    try {
      await updateJournal(trade.id, {
        notes: trade.notes ?? null,
        strategy_name: trade.strategy_name ?? null,
        emotional_state: trade.emotional_state ?? null,
        screenshot_url: trade.screenshot_url ?? null,
        mistake_tags: nextTags,
      });
      persistStrategyMistakeTags(activeStrategyScope, nextTags);
      setSavedTags(nextTags);
    } finally {
      setSavingTags(false);
    }
  }

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
          <Metric label="Entry Date/Time" value={formatDateTime(trade.entry_time)} />
          <Metric label="Exit Date/Time" value={formatDateTime(trade.exit_time)} />
          <Metric label="Entry" value={formatPrice(trade.entry_price)} />
          <Metric label="Exit" value={formatPrice(trade.exit_price)} />
          <Metric label="PnL" value={money(trade.realized_pnl)} tone={trade.realized_pnl >= 0 ? "text-emerald-300" : "text-rose-300"} />
          <Metric label="R" value={trade.r_multiple?.toFixed(2) ?? "—"} />
          <Metric label="Qty" value={trade.quantity.toLocaleString()} />
          <Metric label="Remaining" value={trade.remaining_quantity.toLocaleString()} />
        </div>

        <div className="rounded-md bg-ink-950 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                <Image size={14} />
                Trade Snapshot
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Entry to exit, with surrounding context candles.
              </p>
            </div>
            <button
              className="control-button h-9"
              disabled={snapshotStatus === "loading" || snapshotStatus === "saving"}
              onClick={() => void regenerateSnapshot()}
              type="button"
            >
              <RefreshCw
                className={
                  snapshotStatus === "loading" || snapshotStatus === "saving"
                    ? "animate-spin"
                    : ""
                }
                size={14}
              />
              {snapshotStatus === "saving" ? "Saving" : "Regenerate"}
            </button>
          </div>
          {snapshotUrl ? (
            <img
              alt="Generated trade snapshot"
              className="w-full rounded-md border border-white/10"
              src={snapshotUrl}
            />
          ) : (
            <div className="grid h-44 place-items-center rounded-md bg-black/25 text-sm text-slate-500">
              {snapshotStatus === "error"
                ? "Snapshot could not be generated"
                : "Generating snapshot"}
            </div>
          )}
          <div className="mt-2 text-xs text-slate-500">
            {snapshotStatus === "saved"
              ? "Snapshot preserved with this trade."
              : snapshotStatus === "ready"
                ? "Snapshot already preserved."
                : snapshotStatus === "error"
                  ? "Use regenerate after market data is available."
                  : "Preparing snapshot."}
          </div>
        </div>

        <div className="rounded-md bg-ink-950 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Journal</h3>
            <button className="control-button h-8" onClick={() => onJournal(trade)} type="button">
              Edit
            </button>
          </div>
          <p className="whitespace-pre-wrap text-sm text-slate-300">{trade.notes || "No notes yet"}</p>
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <button
                  key={tag}
                  className="inline-flex items-center gap-1 rounded bg-rose-300/10 px-2 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-300/20"
                  onClick={() => removeTag(tag)}
                  type="button"
                >
                  {tag}
                  <X size={12} />
                </button>
              ))}
              {tags.length === 0 && (
                <span className="rounded bg-white/5 px-2 py-1 text-xs text-slate-500">
                  No mistake tags
                </span>
              )}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
              <input
                className="input-control h-10"
                onChange={(event) => setCustomTag(event.target.value)}
                onKeyDown={handleCustomTagKeyDown}
                placeholder="Custom mistake tag"
                value={customTag}
              />
              <button
                className="control-button h-10"
                disabled={!customTag.trim()}
                onClick={() => addTags(customTag)}
                type="button"
              >
                <Plus size={16} />
                Add
              </button>
              <button
                className="control-button h-10 border-cyan-300/30 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20"
                disabled={!hasTagChanges || savingTags}
                onClick={() => void saveTags()}
                type="button"
              >
                <Save size={16} />
                {savingTags ? "Saving" : "Save"}
              </button>
            </div>
            {strategyTagOptions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {strategyTagOptions.map((tag) => {
                  const active = tags.includes(tag);
                  return (
                    <button
                      className={`rounded px-2 py-1 text-xs font-semibold transition ${
                        active
                          ? "bg-rose-300/10 text-rose-100"
                          : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
                      }`}
                      key={tag}
                      onClick={() =>
                        setTags((current) =>
                          current.includes(tag)
                            ? current.filter((currentTag) => currentTag !== tag)
                            : [...current, tag],
                        )
                      }
                      type="button"
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
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
