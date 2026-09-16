import { ArrowLeft, BarChart3, Check, CopyPlus, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { EdgeLabWordmark } from "../components/brand/EdgeLabBrand";
import { ApiError, openWorkspaceShare, type WorkspaceShareOpen } from "../lib/api";
import { saveAppStorageItemConfirmed } from "../lib/serverStorage";
import {
  createWorkspaceShareCopyArtifact,
  workspaceShareCopyStorageKey,
  workspaceShareScopeLabel,
  type WorkspaceShareCandle,
  type WorkspaceShareMetrics,
} from "../lib/workspaceShare";

export function SharedWorkspacePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<WorkspaceShareOpen | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "copying">("loading");
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [copyError, setCopyError] = useState("");
  const [requestVersion, setRequestVersion] = useState(0);
  const token = useMemo(() => {
    try {
      return decodeURIComponent(location.hash.replace(/^#/, ""));
    } catch {
      return "";
    }
  }, [location.hash]);

  useEffect(() => {
    const previousTitle = document.title;
    const previousReferrer = document.querySelector<HTMLMetaElement>('meta[name="referrer"]');
    const createdReferrer = !previousReferrer;
    const referrer = previousReferrer ?? document.createElement("meta");
    const previousReferrerContent = referrer.content;
    if (createdReferrer) {
      referrer.name = "referrer";
      document.head.append(referrer);
    }
    referrer.content = "no-referrer";
    document.title = "Shared workspace · EdgeLab";
    return () => {
      document.title = previousTitle;
      if (createdReferrer) referrer.remove();
      else referrer.content = previousReferrerContent;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setSnapshot(null);
    setStatus("loading");
    setError(null);
    setCopyError("");
    void openWorkspaceShare(token)
      .then((response) => {
        if (!active) return;
        setSnapshot(response);
        setStatus("ready");
      })
      .catch((cause) => {
        if (!active) return;
        setSnapshot(null);
        const isAccessFailure = cause instanceof ApiError && [401, 403, 404].includes(cause.status);
        setError(cause instanceof ApiError && cause.status === 410
          ? {
              message: "This workspace link has expired or was revoked. Ask the owner for a new snapshot.",
              retryable: false,
            }
          : isAccessFailure
            ? {
                message: "This snapshot is unavailable to your EdgeLab account. Check the link or ask the owner to share it with your sign-in email.",
                retryable: false,
              }
            : {
                message: "The sharing service did not respond, so this snapshot could not be opened. Check your connection and try again.",
                retryable: true,
              });
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [requestVersion, token]);

  async function openAsCopy() {
    if (!snapshot) return;
    setStatus("copying");
    setCopyError("");
    try {
      const artifact = createWorkspaceShareCopyArtifact(snapshot.title, snapshot.payload);
      const storageKey = workspaceShareCopyStorageKey(artifact.id);
      const persistence = await saveAppStorageItemConfirmed(storageKey, artifact);
      if (!persistence.localPersisted && !persistence.serverPersisted) {
        throw new Error("The copy was not persisted.");
      }
      const params = new URLSearchParams({ workspaceCopy: artifact.id });
      if (!persistence.serverPersisted) {
        params.set("copyPersistence", "local");
      }
      navigate(`/app?${params.toString()}`);
    } catch {
      setCopyError("The copy could not be saved on this device or to your account. The source snapshot is still open; try again.");
      setStatus("ready");
    }
  }

  return (
    <div className="min-h-screen bg-edgelab-base text-edgelab-text-primary">
      <a className="fixed left-3 top-3 z-50 -translate-y-20 rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-[#041217] outline-none transition focus:translate-y-0 focus:ring-2 focus:ring-white" href="#shared-workspace-content">Skip to snapshot</a>
      <header className="border-b border-edgelab-border bg-edgelab-surface">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Link aria-label="EdgeLab home" className="outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" to="/"><EdgeLabWordmark markFrame="bare" showTagline={false} size="sm" /></Link>
          <div className="inline-flex items-center gap-2 rounded-full bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-100">
            <LockKeyhole aria-hidden="true" size={14} />Authenticated snapshot
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8" id="shared-workspace-content" tabIndex={-1}>
        {status === "loading" ? <SnapshotLoading /> : null}
        {status === "error" && error ? (
          <SnapshotError
            message={error.message}
            onRetry={error.retryable ? () => setRequestVersion((version) => version + 1) : undefined}
          />
        ) : null}
        {snapshot && (status === "ready" || status === "copying") ? (
          <div className="space-y-7">
            <section className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <Link className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-400 outline-none hover:text-cyan-100 focus-visible:ring-2 focus-visible:ring-cyan-300" to="/app"><ArrowLeft size={16} />Back to EdgeLab</Link>
                <h1 className="mt-5 break-words text-3xl font-semibold tracking-[-0.025em] text-white sm:text-4xl">{snapshot.title}</h1>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-400">
                  <span>{workspaceShareScopeLabel(snapshot.scope)}</span>
                  <span aria-hidden="true" className="h-1 w-1 rounded-full bg-slate-600" />
                  <span>Snapshot v{snapshot.snapshot_version}</span>
                  <span aria-hidden="true" className="h-1 w-1 rounded-full bg-slate-600" />
                  <time dateTime={snapshot.created_at}>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(snapshot.created_at))}</time>
                </div>
              </div>
              <button
                className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 text-sm font-semibold text-[#041217] outline-none transition hover:bg-cyan-200 focus-visible:ring-2 focus-visible:ring-cyan-100 disabled:cursor-wait disabled:opacity-60"
                disabled={status === "copying"}
                onClick={() => void openAsCopy()}
                type="button"
              >
                {status === "copying" ? <RefreshCw className="animate-spin motion-reduce:animate-none" size={18} /> : <CopyPlus size={18} />}
                {status === "copying" ? "Preparing copy…" : "Open as copy"}
              </button>
            </section>

            {copyError ? (
              <div className="flex flex-col gap-3 rounded-xl border border-rose-300/20 bg-rose-400/10 p-4 text-sm text-rose-100 sm:flex-row sm:items-center sm:justify-between" role="alert">
                <span>{copyError}</span>
                <button
                  className="min-h-10 shrink-0 rounded-lg border border-rose-200/20 px-3 font-semibold outline-none hover:bg-rose-300/10 focus-visible:ring-2 focus-visible:ring-rose-200"
                  onClick={() => void openAsCopy()}
                  type="button"
                >
                  Retry copy
                </button>
              </div>
            ) : null}

            <div className="flex items-start gap-3 rounded-xl bg-cyan-300/[0.07] p-4 text-sm text-cyan-50">
              <ShieldCheck aria-hidden="true" className="mt-0.5 shrink-0 text-cyan-300" size={18} />
              <p className="max-w-3xl leading-6">This is a read-only, sanitized snapshot. Credentials, orders, positions, executions, and journal records are not included. Opening it creates an independent workspace copy.</p>
            </div>

            {snapshot.payload.chart ? (
              <section aria-labelledby="shared-chart-title" className="overflow-hidden rounded-2xl bg-[#080d13] shadow-[0_24px_70px_rgba(0,0,0,0.38)]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-5">
                  <div>
                    <h2 className="text-base font-semibold text-white" id="shared-chart-title">{snapshot.payload.chart.symbol} · {snapshot.payload.chart.timeframe}</h2>
                    <p className="mt-1 text-xs text-slate-500">{snapshot.payload.chart.panes.length} chart pane{snapshot.payload.chart.panes.length === 1 ? "" : "s"} · {snapshot.payload.chart.paneLayout}</p>
                  </div>
                  <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400"><BarChart3 size={15} />Read-only market view</span>
                </div>
                <CandlestickPreview candles={snapshot.payload.chart.candles} />
              </section>
            ) : null}

            {snapshot.payload.panels ? <MetricsPanel snapshot={snapshot.payload.panels.metrics} /> : null}

            {snapshot.payload.workspace ? (
              <section aria-labelledby="workspace-copy-details" className="rounded-2xl bg-edgelab-surface p-5 shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
                <h2 className="text-base font-semibold text-white" id="workspace-copy-details">Workspace configuration</h2>
                <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
                  <Detail label="Layout" value={snapshot.payload.workspace.layoutName} />
                  <Detail label="Pane grid" value={snapshot.payload.workspace.paneLayout} />
                  <Detail label="Timezone" value={snapshot.payload.workspace.timezone ?? "Workspace default"} />
                </dl>
              </section>
            ) : null}
          </div>
        ) : null}
      </main>
    </div>
  );
}

function SnapshotLoading() {
  return <div aria-live="polite" className="grid min-h-[60vh] place-items-center" role="status"><div className="text-center"><RefreshCw className="mx-auto animate-spin text-cyan-300 motion-reduce:animate-none" size={24} /><p className="mt-4 text-sm text-slate-400">Opening secure snapshot…</p></div></div>;
}

function SnapshotError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const workspaceLinkClass = onRetry
    ? "inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 px-4 text-sm font-semibold text-slate-200 outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-cyan-100"
    : "inline-flex min-h-11 items-center gap-2 rounded-xl bg-cyan-300 px-4 text-sm font-semibold text-[#041217] outline-none hover:bg-cyan-200 focus-visible:ring-2 focus-visible:ring-cyan-100";
  return (
    <section aria-labelledby="shared-snapshot-error-title" className="mx-auto flex min-h-[60vh] max-w-2xl flex-col justify-center">
      <div className="grid h-12 w-12 place-items-center rounded-xl bg-rose-400/10 text-rose-200"><LockKeyhole size={21} /></div>
      <h1 className="mt-5 text-2xl font-semibold text-white" id="shared-snapshot-error-title">Snapshot unavailable</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400" role="alert">{message}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        {onRetry ? (
          <button className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-cyan-300 px-4 text-sm font-semibold text-[#041217] outline-none hover:bg-cyan-200 focus-visible:ring-2 focus-visible:ring-cyan-100" onClick={onRetry} type="button">
            <RefreshCw aria-hidden="true" size={16} />Try opening again
          </button>
        ) : null}
        <Link className={workspaceLinkClass} to="/app">Open your workspace</Link>
      </div>
    </section>
  );
}

function CandlestickPreview({ candles }: { candles: WorkspaceShareCandle[] }) {
  const geometry = useMemo(() => buildCandleGeometry(candles.slice(-90)), [candles]);
  if (geometry.items.length === 0) {
    return <div className="grid min-h-72 place-items-center px-5 text-sm text-slate-500">No candle data was included in this snapshot.</div>;
  }
  return (
    <div className="overflow-hidden p-3 sm:p-5">
      <svg aria-label={`Candlestick snapshot from ${geometry.low} to ${geometry.high}`} className="h-72 w-full" preserveAspectRatio="none" role="img" viewBox="0 0 1000 320">
        <g stroke="#1E293B" strokeWidth="1">
          {[40, 100, 160, 220, 280].map((y) => <line key={y} x1="0" x2="1000" y1={y} y2={y} />)}
        </g>
        {geometry.items.map((item) => (
          <g key={`${item.x}-${item.time}`}>
            <line stroke={item.up ? "#22C55E" : "#EF4444"} strokeWidth="2" x1={item.x} x2={item.x} y1={item.high} y2={item.low} />
            <rect fill={item.up ? "#22C55E" : "#EF4444"} height={Math.max(2, item.bottom - item.top)} rx="1" width={Math.max(2, geometry.width * 0.62)} x={item.x - geometry.width * 0.31} y={item.top} />
          </g>
        ))}
      </svg>
    </div>
  );
}

function buildCandleGeometry(candles: WorkspaceShareCandle[]) {
  const clean = candles.filter((candle) => [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite));
  const high = clean.length > 0 ? Math.max(...clean.map((candle) => candle.high)) : 0;
  const low = clean.length > 0 ? Math.min(...clean.map((candle) => candle.low)) : 0;
  const range = Math.max(high - low, 0.000001);
  const width = clean.length > 0 ? 960 / clean.length : 12;
  const y = (value: number) => 20 + ((high - value) / range) * 280;
  return {
    high, low, width,
    items: clean.map((candle, index) => ({
      x: 20 + index * width + width / 2,
      high: y(candle.high), low: y(candle.low), top: y(Math.max(candle.open, candle.close)), bottom: y(Math.min(candle.open, candle.close)),
      time: candle.time, up: candle.close >= candle.open,
    })),
  };
}

function MetricsPanel({ snapshot }: { snapshot: WorkspaceShareMetrics }) {
  const metrics = [
    ["Net P&L", new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, signDisplay: "exceptZero" }).format(snapshot.netPnl)],
    ["Win rate", `${snapshot.winRate.toFixed(1)}%`],
    ["Trades", snapshot.totalTrades.toLocaleString()],
    ["Max drawdown", snapshot.maxDrawdown.toFixed(2)],
    ["Profit factor", snapshot.profitFactor == null ? "—" : snapshot.profitFactor.toFixed(2)],
    ["Average R", snapshot.averageR == null ? "—" : snapshot.averageR.toFixed(2)],
  ];
  return <section aria-labelledby="shared-results-title"><div className="flex items-center gap-2"><Check className="text-cyan-300" size={17} /><h2 className="text-base font-semibold text-white" id="shared-results-title">Aggregate results</h2></div><dl className="mt-4 grid gap-px overflow-hidden rounded-2xl bg-white/10 sm:grid-cols-2 lg:grid-cols-3">{metrics.map(([label, value]) => <div className="bg-edgelab-surface px-4 py-5" key={label}><dt className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</dt><dd className="mt-2 font-data text-xl font-semibold tabular-nums text-white">{value}</dd></div>)}</dl></section>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</dt><dd className="mt-2 break-words text-slate-200">{value}</dd></div>;
}
