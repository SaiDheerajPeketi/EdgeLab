import { AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";
import { EdgePulseLoader } from "./EdgePulseLoader";

type SessionGatewayUnavailableProps = {
  isRetrying: boolean;
  onRetry: () => void;
};

export function SessionGatewayUnavailable({
  isRetrying,
  onRetry,
}: SessionGatewayUnavailableProps) {
  return (
    <section
      aria-labelledby="session-gateway-unavailable-title"
      className="session-gateway"
    >
      <div className="session-gateway-hero !block">
        <div className="grid min-w-0 gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.48fr)] lg:gap-10">
          <div className="min-w-0">
            <div className="flex items-start gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-rose-300/10 text-rose-100">
                <AlertTriangle aria-hidden="true" size={21} />
              </span>
              <div className="min-w-0">
                <h1
                  className="text-3xl font-semibold tracking-[-0.025em] text-white xl:text-5xl"
                  id="session-gateway-unavailable-title"
                >
                  Saved sessions unavailable
                </h1>
                <p className="mt-3 max-w-2xl text-base leading-7 text-slate-300">
                  EdgeLab could not load your saved replay sessions. Nothing was deleted or
                  changed, and the workspace will stay here while you reconnect.
                </p>
              </div>
            </div>

            <div
              aria-live="assertive"
              className="mt-6 flex max-w-2xl items-start gap-3 rounded-lg bg-rose-300/10 px-4 py-3 text-sm leading-6 text-rose-100"
              role="alert"
            >
              <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={17} />
              <span>The session service did not respond. Check your connection, then retry.</span>
            </div>

            <button
              aria-busy={isRetrying}
              className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-cyan-200 px-5 py-3 text-sm font-semibold text-ink-950 transition-colors hover:bg-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100 disabled:cursor-wait disabled:opacity-65 sm:w-auto"
              disabled={isRetrying}
              onClick={onRetry}
              type="button"
            >
              {isRetrying ? (
                <EdgePulseLoader label="Retrying saved sessions" size="sm" />
              ) : (
                <RefreshCw aria-hidden="true" size={16} />
              )}
              {isRetrying ? "Retrying saved sessions…" : "Retry saved sessions"}
            </button>
          </div>

          <div className="min-w-0 border-t border-white/10 pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-1">
            <div className="flex items-center gap-3 text-cyan-100">
              <ShieldCheck aria-hidden="true" size={18} />
              <h2 className="text-base font-semibold text-white">Your work remains protected</h2>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              EdgeLab has not replaced the missing response with an empty account. Retrying will
              restore your saved sessions as soon as the service is available.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
