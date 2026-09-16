import { useEffect, useMemo, useState } from "react";
import { CriticalStateSurface } from "@/components/ui/CriticalStateSurface";

const STALE_AFTER_MS = 2 * 60 * 1000;

type LiveFeedHealthSurfaceProps = {
  connectionStatus: "connecting" | "error" | "idle" | "live";
  feedError: string | null;
  sourceLabel: string;
  tickerUpdatedAt?: number | null;
  onRetry: () => void;
};

type LiveFeedIssue = "connecting" | "offline" | "stale" | "unsupported" | null;

function resolveLiveFeedIssue(
  connectionStatus: LiveFeedHealthSurfaceProps["connectionStatus"],
  feedError: string | null,
  tickerUpdatedAt: number | null | undefined,
  now: number,
): LiveFeedIssue {
  if (connectionStatus === "connecting") return "connecting";
  if (feedError && /not supported|unsupported|\b400\b|\b404\b|\b451\b/i.test(feedError)) return "unsupported";
  if (connectionStatus === "error") return "offline";
  if (connectionStatus === "live" && tickerUpdatedAt && now - tickerUpdatedAt > STALE_AFTER_MS) return "stale";
  return null;
}

export function LiveFeedHealthSurface({
  connectionStatus,
  feedError,
  sourceLabel,
  tickerUpdatedAt,
  onRetry,
}: LiveFeedHealthSurfaceProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (connectionStatus !== "live" || !tickerUpdatedAt) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [connectionStatus, tickerUpdatedAt]);

  const issue = useMemo(
    () => resolveLiveFeedIssue(connectionStatus, feedError, tickerUpdatedAt, now),
    [connectionStatus, feedError, now, tickerUpdatedAt],
  );

  if (!issue) return null;
  if (issue === "connecting") {
    return (
      <CriticalStateSurface
        actionLabel={null}
        detail={`Establishing a verified ${sourceLabel} stream. Existing chart history remains visible while live prices are paused.`}
        state="loading"
        title="Connecting live feed"
      />
    );
  }
  if (issue === "unsupported") {
    return (
      <CriticalStateSurface
        detail={`${sourceLabel} cannot stream this instrument. Choose a supported market; existing chart history has not been replaced.`}
        onAction={onRetry}
        state="unsupported"
        title="Instrument not supported"
      />
    );
  }
  if (issue === "offline") {
    return (
      <CriticalStateSurface
        detail={`${feedError ?? `${sourceLabel} is unreachable.`} Existing chart history remains visible and is not live.`}
        onAction={onRetry}
        state="offline"
        title="Live feed offline"
      />
    );
  }
  return (
    <CriticalStateSurface
      detail={`The ${sourceLabel} stream has stopped advancing. Existing prices remain visible but must not be treated as current.`}
      onAction={onRetry}
      state="stale"
      timestamp={new Date(tickerUpdatedAt ?? now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      title="Market data is stale"
    />
  );
}
