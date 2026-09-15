export type UiAsyncState =
  | "empty"
  | "loading"
  | "partial"
  | "offline"
  | "stale"
  | "permission-denied"
  | "unsupported"
  | "error"
  | "retrying"
  | "success";

export type UiStateDescriptor = {
  title: string;
  detail: string;
  actionLabel: string | null;
  persistent: boolean;
  icon: "empty" | "progress" | "offline" | "warning" | "lock" | "error" | "success";
};

export const UI_STATE_DESCRIPTORS: Record<UiAsyncState, UiStateDescriptor> = {
  empty: { title: "Nothing here yet", detail: "Choose a source or create the first item.", actionLabel: "Get started", persistent: true, icon: "empty" },
  loading: { title: "Loading verified data", detail: "Existing content stays available while the next result arrives.", actionLabel: null, persistent: false, icon: "progress" },
  partial: { title: "Some data is still arriving", detail: "Visible results are complete through the stated timestamp.", actionLabel: "View details", persistent: true, icon: "warning" },
  offline: { title: "You are offline", detail: "Local work is preserved. Reconnect before refreshing live data.", actionLabel: "Try again", persistent: true, icon: "offline" },
  stale: { title: "Data is delayed", detail: "Showing the last verified snapshot with its timestamp.", actionLabel: "Reconnect", persistent: true, icon: "warning" },
  "permission-denied": { title: "Access is restricted", detail: "Your current role or plan does not allow this action.", actionLabel: "Review access", persistent: true, icon: "lock" },
  unsupported: { title: "Not supported by this provider", detail: "Choose a compatible provider or instrument.", actionLabel: "Choose provider", persistent: true, icon: "warning" },
  error: { title: "The action did not finish", detail: "Your valid input is preserved. Review the error and retry.", actionLabel: "Retry", persistent: true, icon: "error" },
  retrying: { title: "Retrying safely", detail: "No duplicate request will be created.", actionLabel: "Cancel retry", persistent: true, icon: "progress" },
  success: { title: "Completed", detail: "The latest verified state is now visible.", actionLabel: null, persistent: false, icon: "success" },
};

export type SaveStrategy = "immediate" | "debounced" | "explicit" | "revisioned";
export type SavePhase = "idle" | "dirty" | "saving" | "saved" | "conflict" | "error";

export function saveStrategyFor(kind: "toggle" | "text" | "number" | "slider" | "credential" | "import" | "destructive" | "workspace"): SaveStrategy {
  if (kind === "toggle") return "immediate";
  if (kind === "text" || kind === "number" || kind === "slider") return "debounced";
  if (kind === "workspace") return "revisioned";
  return "explicit";
}

export function saveStatusMessage(phase: SavePhase) {
  return ({ idle: "No pending changes", dirty: "Changes not saved", saving: "Saving changes…", saved: "Changes saved", conflict: "A newer version exists. Choose which version to keep.", error: "Could not save. Your changes are preserved; retry when ready." } satisfies Record<SavePhase, string>)[phase];
}

export type SearchableCommandEntity = {
  id: string;
  kind: "account" | "trade" | "note" | "workspace" | "safe-action";
  label: string;
  detail: string;
  keywords?: string;
  run: () => void;
};

export const UI_PERFORMANCE_BUDGETS = Object.freeze({
  publicInitialGzipKb: 180,
  appShellInitialGzipKb: 260,
  lazyChunkGzipKb: 180,
  lcpMs: 2500,
  inpMs: 200,
  cls: 0.1,
  routeResponseMs: 100,
  virtualizeRowsAbove: 200,
});

export const UI_SUPPORTED_VIEWPORTS = Object.freeze({
  mobile: { width: 390, minHeight: 720 },
  tablet: { width: 1024, minHeight: 768 },
  desktop: { width: 1440, minHeight: 900 },
  tradingDesktop: { width: 1920, minHeight: 1080 },
});

export const UI_INTERACTION_CONTRACT = Object.freeze({
  minimumCoarsePointerTargetPx: 44,
  maximumZoomPercent: 200,
  focusIndicatorWidthPx: 2,
  bodyTextContrast: 4.5,
  largeTextContrast: 3,
  routeFeedbackMs: 100,
});

export type SemanticFinancialState = {
  label: string;
  sign: "+" | "−" | "=" | "!";
  tone: "profit" | "loss" | "neutral" | "warning";
};

/** A textual channel is mandatory so financial meaning never depends on color. */
export function financialState(value: number | null, unavailableLabel = "Unavailable"): SemanticFinancialState {
  if (value == null || !Number.isFinite(value)) return { label: unavailableLabel, sign: "!", tone: "warning" };
  if (value > 0) return { label: `Profit +${value}`, sign: "+", tone: "profit" };
  if (value < 0) return { label: `Loss −${Math.abs(value)}`, sign: "−", tone: "loss" };
  return { label: "Unchanged 0", sign: "=", tone: "neutral" };
}

export function commandSearchScore(entity: Pick<SearchableCommandEntity, "label" | "detail" | "keywords">, query: string) {
  const tokens = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 1;
  const label = entity.label.toLocaleLowerCase();
  const haystack = `${label} ${entity.detail} ${entity.keywords ?? ""}`.toLocaleLowerCase();
  if (!tokens.every((token) => haystack.includes(token))) return 0;
  return tokens.reduce((score, token) => score + (label.startsWith(token) ? 4 : label.includes(token) ? 2 : 1), 0);
}
