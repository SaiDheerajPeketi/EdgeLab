/** Canonical product terms. Navigation and recovery copy should source these names. */
export const PRODUCT_TERMS = Object.freeze({
  account: "account",
  journal: "Journal",
  layout: "chart layout",
  live: "Live",
  replay: "Replay",
  report: "report",
  session: "session",
  settings: "settings",
  workspace: "workspace",
});

export function humanizeProductStatus(value: string) {
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  return ({
    connected: "Connected",
    disconnected: "Disconnected",
    error: "Needs attention",
    failed: "Needs attention",
    loading: "Loading…",
    offline: "Offline",
    pending: "Pending",
    stale: "Delayed",
    success: "Complete",
    syncing: "Syncing…",
    unsupported: "Not supported",
  } as Record<string, string>)[normalized] ?? normalized.replaceAll("-", " ").replace(/^./, (letter) => letter.toUpperCase());
}
