import { X } from "lucide-react";
import { FormEvent, useState } from "react";
import type { Trade } from "../lib/api";
import { formatPrice } from "../lib/format";
import { useBacktestStore } from "../store/backtestStore";

type Props = {
  trade: Trade;
  onClose: () => void;
};

const mistakeOptions = ["FOMO", "Early Exit", "Late Entry", "Moved Stop", "Oversized"];

export function JournalEntryModal({ trade, onClose }: Props) {
  const updateJournal = useBacktestStore((state) => state.updateJournal);
  const [notes, setNotes] = useState(trade.notes ?? "");
  const [strategy, setStrategy] = useState(trade.strategy_name ?? "");
  const [emotion, setEmotion] = useState(trade.emotional_state ?? "");
  const [screenshotUrl, setScreenshotUrl] = useState(trade.screenshot_url ?? "");
  const [tags, setTags] = useState<string[]>(trade.mistake_tags);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    await updateJournal(trade.id, {
      notes: notes || null,
      strategy_name: strategy || null,
      emotional_state: emotion || null,
      screenshot_url: screenshotUrl || null,
      mistake_tags: tags,
    });
    setSaving(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 backdrop-blur-sm">
      <form
        className="w-full max-w-2xl rounded-md border border-white/10 bg-ink-900 shadow-panel"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="flex h-14 items-center justify-between border-b border-white/10 px-5">
          <div>
            <h2 className="text-base font-semibold text-white">Journal Entry</h2>
            <p className="text-xs text-slate-500">
              #{trade.id} · {formatPrice(trade.entry_price)}
            </p>
          </div>
          <button className="icon-button" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <label className="form-field">
            <span>Strategy</span>
            <input
              className="input-control h-10"
              onChange={(event) => setStrategy(event.target.value)}
              value={strategy}
            />
          </label>
          <label className="form-field">
            <span>Emotional State</span>
            <input
              className="input-control h-10"
              onChange={(event) => setEmotion(event.target.value)}
              value={emotion}
            />
          </label>
          <label className="form-field sm:col-span-2">
            <span>Screenshot URL</span>
            <input
              className="input-control h-10"
              onChange={(event) => setScreenshotUrl(event.target.value)}
              value={screenshotUrl}
            />
          </label>

          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
              Mistake Tags
            </legend>
            <div className="flex flex-wrap gap-2">
              {mistakeOptions.map((option) => {
                const active = tags.includes(option);
                return (
                  <button
                    key={option}
                    className={`rounded px-3 py-2 text-xs font-semibold transition ${
                      active
                        ? "bg-rose-300/10 text-rose-100"
                        : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
                    }`}
                    onClick={() =>
                      setTags((current) =>
                        current.includes(option)
                          ? current.filter((tag) => tag !== option)
                          : [...current, option],
                      )
                    }
                    type="button"
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <label className="form-field sm:col-span-2">
            <span>Notes</span>
            <textarea
              className="input-control min-h-32 py-3"
              onChange={(event) => setNotes(event.target.value)}
              value={notes}
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
          <button className="control-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="control-button border-cyan-300/30 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20"
            disabled={saving}
            type="submit"
          >
            {saving ? "Saving" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
