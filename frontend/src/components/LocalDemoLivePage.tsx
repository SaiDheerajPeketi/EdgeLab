import { useEffect, useRef, useState, type ReactNode } from "react";
import { getBars, type BacktestSession, type Candle } from "../lib/api";
import { assertAppDataAccess, captureAppDataAccess } from "../lib/appDataBarrier";
import { isLocalDemoSession, localDemoReplaySessions } from "../lib/localDemoPreview";
import { getStoredAuthSession, subscribeAuthSession } from "../lib/authSession";
import { ThemedSelect } from "./ThemedSelect";
import { loadAppStorageItem } from "../lib/serverStorage";

export function LocalDemoLivePage({ sessions, renderChart }: { sessions: BacktestSession[]; renderChart: (bars: Candle[], session: BacktestSession) => ReactNode }) {
  const options = localDemoReplaySessions(sessions);
  const [id, setId] = useState<number | null>(options[0]?.id ?? null);
  const selected = options.find(session => session.id === id) ?? options[0] ?? null;
  const [data, setData] = useState<{ id: number; bars: Candle[] } | null>(null);
  const [count, setCount] = useState(360);
  const [playing, setPlaying] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const version = ++generation.current;
    let active = true;
    setData(null); setError(null); setCount(360);
    const access = captureAppDataAccess();
    const owns = () => { try { assertAppDataAccess(access); return active && version === generation.current && isLocalDemoSession(getStoredAuthSession()?.user); } catch { return false; } };
    const invalidate = () => { active = false; generation.current++; setData(null); setRetry(value => value + 1); };
    // Entitlement/profile refreshes keep the same owner and source. Only an
    // actual identity/token/data-generation transition retires its candles.
    const stop = subscribeAuthSession(() => { if (!owns()) invalidate(); });
    window.addEventListener("edgelab:auth-session-change", invalidate);
    const dataChanged = () => { if (!owns()) invalidate(); };
    window.addEventListener("edgelab:app-data-state-change", dataChanged);
    if (selected && isLocalDemoSession(getStoredAuthSession()?.user)) {
      // Source prices/timestamps come from this owned replay's dataset, not a live provider.
      const offset = Math.max(selected.start_offset, selected.current_offset - 360);
      // Hydrate before mounting the studio: its initial cache and autosave must
      // see the owned saved layout rather than overwrite it with defaults.
      void Promise.all([
        getBars(offset, 1200, selected.id),
        loadAppStorageItem("live-chart-layout.v1", null),
        loadAppStorageItem("live-chart-layouts.v1", []),
        loadAppStorageItem("active-live-chart-layout.v1", null),
      ]).then(([result]) => {
        if (!owns()) return;
        setData({ id: selected.id, bars: result.bars }); setCount(Math.min(360, result.bars.length));
      }).catch(() => { if (owns()) setError("Demo candles could not be loaded. Check the local preview API and retry."); });
    }
    return () => { active = false; generation.current++; stop(); window.removeEventListener("edgelab:auth-session-change", invalidate); window.removeEventListener("edgelab:app-data-state-change", dataChanged); };
  }, [selected?.id, retry]);
  const bars = data && selected && data.id === selected.id ? data.bars : [];
  useEffect(() => {
    if (!playing || bars.length < 2) return;
    const timer = window.setInterval(() => setCount(current => current >= bars.length ? Math.min(360, bars.length) : current + 1), 1500);
    return () => window.clearInterval(timer);
  }, [playing, bars]);
  return <section className="space-y-4 p-3 sm:p-5" aria-label="Synthetic Live demo">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-xl font-semibold text-[var(--text-primary)]">Live / Demo chart</h1><p className="mt-1 max-w-[70ch] text-sm text-[var(--text-secondary)]">Recorded synthetic prices. This preview animates your demo replay data; no exchange is connected.</p></div><a href="/app/replay" className="inline-flex min-h-11 items-center rounded px-3 text-sm text-[var(--text-accent)] underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]">Open Replay</a></header>
    {!selected ? <p role="status" className="text-sm text-[var(--text-secondary)]">No seeded replay is available. Start the disposable preview API with its demo database.</p> : <><div className="flex flex-wrap items-center gap-2"><div className="min-w-0 flex-1 sm:max-w-md"><ThemedSelect ariaLabel="Demo replay source" value={String(selected.id)} onChange={value => setId(Number(value))} options={options.map(session => ({ value: String(session.id), label: session.name }))} /></div><button type="button" onClick={() => setPlaying(value => !value)} className="min-h-11 rounded border border-[var(--ui-border-strong)] px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]">{playing ? "Pause demo" : "Play demo"}</button><button type="button" onClick={() => setCount(Math.min(360, bars.length))} className="min-h-11 rounded border border-[var(--ui-border-strong)] px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]">Restart demo</button></div>{error ? <div role="alert" className="text-sm text-[var(--loss-text)]">{error}<button type="button" onClick={() => setRetry(value => value + 1)} className="ml-2 min-h-11 underline">Retry demo</button></div> : !data ? <p role="status">Loading demo candles…</p> : !bars.length ? <p role="status">No candles are available in this demo session.</p> : renderChart(bars.slice(0, count), selected)}</>}
  </section>;
}
