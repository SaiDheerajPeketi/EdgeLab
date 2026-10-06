export const UI_ROUTE_GROUPS = ["shell", "journal", "settings", "chart", "public"] as const;
export const UI_COMPATIBILITY_VIEWPORTS = ["mobile", "tablet", "desktop", "tradingDesktop"] as const;

export type UiRouteGroup = (typeof UI_ROUTE_GROUPS)[number];

export type CompatibilityRoute = { href: string; label: string };
export type CompatibilityParityKind = "read-only" | "shared-domain" | "writable";
export type CompatibilityRouteParity = {
  routePath: string;
  kind: CompatibilityParityKind;
  sessionSource: "auth-session" | "route-session";
  draftKey: string | null;
  savedDataRead: "public-route" | "workspace-storage" | "canonical-trades" | "journal-accounts" | "journal-daily-notes" | "settings-preferences" | "journal-settings" | "backtest-settings" | "chart-settings" | "replay-layout";
  primaryAction: "navigate" | "refresh-journal" | "save-trade-review" | "create-journal-account" | "save-daily-note" | "save-settings" | "save-journal-settings" | "save-backtest-settings" | "save-chart-settings" | "restore-replay-layout";
  actionExemption: string | null;
  requiredViewports: typeof UI_COMPATIBILITY_VIEWPORTS;
  testCaseId: "public-read-continuity" | "shell-session-continuity" | "journal-canonical-refresh" | "journal-trade-review" | "journal-account-create" | "journal-daily-note-save" | "journal-day-review" | "settings-draft-save" | "journal-settings-save" | "backtest-settings-save" | "chart-settings-save" | "chart-replay-layout";
  canarySpec?: string;
  reasonSource: string;
};
type CompatibilityGroupParity = Omit<CompatibilityRouteParity, "actionExemption" | "routePath">;

/** Every concrete product deep link that can be served by a compatibility renderer. */
export const UI_COMPATIBILITY_PATHS: Readonly<Record<UiRouteGroup, readonly string[]>> = Object.freeze({
  public: ["/", "/pricing", "/privacy", "/terms", "/auth/signin"],
  shell: ["/app"],
  journal: [
    "/app/journal", "/app/journal/dashboard", "/app/journal/accounts", "/app/journal/trades",
    "/app/journal/analytics", "/app/journal/notes", "/app/journal/calendar",
    "/app/journal/reports", "/app/journal/settings", "/app/reports",
  ],
  settings: [
    "/app/settings", "/app/settings/global", "/app/settings/journal", "/app/settings/backtest",
    "/app/settings/chart", "/app/settings/appearance", "/app/settings/data-providers",
    "/app/settings/account", "/app/settings/ai", "/app/settings/privacy-security", "/app/settings/storage",
  ],
  chart: ["/shared", "/app/live", "/app/replay", "/app/order-flow", "/app/quant"],
});

const GROUP_PARITY: Readonly<Record<UiRouteGroup, CompatibilityGroupParity>> = Object.freeze({
  public: { kind: "read-only", sessionSource: "route-session", draftKey: null, savedDataRead: "public-route", primaryAction: "navigate", requiredViewports: UI_COMPATIBILITY_VIEWPORTS, testCaseId: "public-read-continuity", reasonSource: "frontend/src/routes/AppRoutes.tsx" },
  shell: { kind: "read-only", sessionSource: "auth-session", draftKey: null, savedDataRead: "workspace-storage", primaryAction: "navigate", requiredViewports: UI_COMPATIBILITY_VIEWPORTS, testCaseId: "shell-session-continuity", reasonSource: "frontend/src/components/compatibility/CompatibilityRouteRenderer.tsx#ShellCompatibility" },
  journal: { kind: "shared-domain", sessionSource: "auth-session", draftKey: null, savedDataRead: "canonical-trades", primaryAction: "refresh-journal", requiredViewports: UI_COMPATIBILITY_VIEWPORTS, testCaseId: "journal-canonical-refresh", reasonSource: "frontend/src/lib/journalApi.ts#listCanonicalTrades" },
  settings: { kind: "writable", sessionSource: "auth-session", draftKey: "edgelab.compatibility.settings-draft.v1", savedDataRead: "settings-preferences", primaryAction: "save-settings", requiredViewports: UI_COMPATIBILITY_VIEWPORTS, testCaseId: "settings-draft-save", reasonSource: "frontend/src/lib/settingsPreferences.ts#saveSettingsPreferences" },
  chart: { kind: "shared-domain", sessionSource: "auth-session", draftKey: null, savedDataRead: "replay-layout", primaryAction: "restore-replay-layout", requiredViewports: UI_COMPATIBILITY_VIEWPORTS, testCaseId: "chart-replay-layout", reasonSource: "frontend/src/lib/api.ts#getLatestBacktest" },
});

const ROUTE_PARITY: Readonly<Record<string, Partial<CompatibilityGroupParity>>> = {
  ...Object.fromEntries(["/app/settings/chart", "/app/settings/appearance"].map((path) => [path, {
    kind: "writable" as const, draftKey: "settings:chart-defaults;settings:preferences", savedDataRead: "chart-settings" as const,
    primaryAction: "save-chart-settings" as const, testCaseId: "chart-settings-save" as const,
    reasonSource: "frontend/src/components/settings/useChartSettings.ts", canarySpec: "e2e/compatibility-chart-settings.interaction.spec.ts",
  }])),
  ...Object.fromEntries(["/app/journal/settings", "/app/settings/journal"].map((path) => [path, {
    kind: "writable" as const, draftKey: "settings:journal-defaults;settings:note-template", savedDataRead: "journal-settings" as const,
    primaryAction: "save-journal-settings" as const, testCaseId: "journal-settings-save" as const,
    reasonSource: "frontend/src/components/settings/useJournalSettings.ts", canarySpec: "e2e/compatibility-journal-settings.interaction.spec.ts",
  }])),
  "/app/settings/backtest": {
    kind: "writable", draftKey: "settings:backtest-defaults", savedDataRead: "backtest-settings",
    primaryAction: "save-backtest-settings", testCaseId: "backtest-settings-save",
    reasonSource: "frontend/src/components/settings/useBacktestSettings.ts", canarySpec: "e2e/compatibility-backtest-settings.interaction.spec.ts",
  },
  "/app/journal/dashboard": {
    kind: "writable", draftKey: "journal:daily-note:{date}:{accountId|shared}", savedDataRead: "journal-daily-notes",
    primaryAction: "save-daily-note", testCaseId: "journal-daily-note-save", reasonSource: "frontend/src/lib/journalApi.ts#upsertJournalDailyNote",
    canarySpec: "e2e/compatibility-journal-dashboard.interaction.spec.ts",
  },
  "/app/journal/analytics": {
    kind: "writable", draftKey: "journal:review:{tradeId}",
    primaryAction: "save-trade-review", testCaseId: "journal-trade-review",
    reasonSource: "frontend/src/lib/journalApi.ts#updateCanonicalTradeReview",
    canarySpec: "e2e/compatibility-journal-analytics.interaction.spec.ts",
  },
  "/app/journal/reports": {
    kind: "writable", draftKey: "journal:review:{tradeId}",
    primaryAction: "save-trade-review", testCaseId: "journal-trade-review",
    reasonSource: "frontend/src/lib/journalApi.ts#updateCanonicalTradeReview",
    canarySpec: "e2e/compatibility-journal-analytics.interaction.spec.ts",
  },
  "/app/journal/notes": {
    kind: "writable", draftKey: "journal:daily-note:{date}:{accountId|shared}", savedDataRead: "journal-daily-notes",
    primaryAction: "save-daily-note", testCaseId: "journal-daily-note-save", reasonSource: "frontend/src/lib/journalApi.ts#upsertJournalDailyNote",
    canarySpec: "e2e/compatibility-journal-notes.interaction.spec.ts",
  },
  "/app/journal/calendar": {
    kind: "writable", draftKey: "journal:daily-note:{date}:{accountId|shared}", savedDataRead: "journal-daily-notes",
    primaryAction: "save-daily-note", testCaseId: "journal-day-review", reasonSource: "frontend/src/lib/journalApi.ts#upsertJournalDailyNote",
    canarySpec: "e2e/compatibility-journal-notes.interaction.spec.ts",
  },
  "/app/journal/trades": {
    primaryAction: "save-trade-review", testCaseId: "journal-trade-review",
    reasonSource: "frontend/src/lib/journalApi.ts#updateCanonicalTradeReview",
    canarySpec: "e2e/compatibility-journal.interaction.spec.ts",
  },
  "/app/journal/accounts": {
    savedDataRead: "journal-accounts", primaryAction: "create-journal-account", testCaseId: "journal-account-create",
    reasonSource: "frontend/src/lib/journalApi.ts#createJournalAccount",
    canarySpec: "e2e/compatibility-journal.interaction.spec.ts",
  },
};

export const UI_COMPATIBILITY_ROUTE_PARITY: Readonly<Record<string, CompatibilityRouteParity>> = Object.freeze(
  Object.fromEntries(Object.entries(UI_COMPATIBILITY_PATHS).flatMap(([group, paths]) => paths.map((routePath) => {
    const contract = { ...GROUP_PARITY[group as UiRouteGroup], ...ROUTE_PARITY[routePath] };
    return [routePath, {
      ...contract,
      actionExemption: contract.primaryAction === "navigate" ? "Read-only route has no mutating parity action." : null,
      routePath,
    }];
  }))),
);

export const UI_COMPATIBILITY_ROUTES: Readonly<Record<UiRouteGroup, readonly CompatibilityRoute[]>> = Object.freeze({
  public: [{ href: "/", label: "Home" }, { href: "/pricing", label: "Pricing" }, { href: "/auth/signin", label: "Sign in" }],
  shell: [{ href: "/app", label: "Workspace" }, { href: "/app/live", label: "Live" }, { href: "/app/journal/dashboard", label: "Journal" }, { href: "/app/settings/global", label: "Settings" }],
  journal: [{ href: "/app/journal/dashboard", label: "Overview" }, { href: "/app/journal/trades", label: "Trades" }, { href: "/app/journal/notes", label: "Notes" }, { href: "/app/journal/calendar", label: "Calendar" }, { href: "/app/journal/accounts", label: "Accounts" }, { href: "/app/reports", label: "Reports" }],
  settings: [{ href: "/app/settings/global", label: "Global" }, { href: "/app/settings/chart", label: "Chart" }, { href: "/app/settings/data-providers#settings/data-providers/broker-connections", label: "Data & providers" }],
  chart: [{ href: "/app/live", label: "Live" }, { href: "/app/replay", label: "Replay" }, { href: "/app/order-flow", label: "Order flow" }],
});

export const UI_ROLLOUT_FLAGS: Record<UiRouteGroup, string> = {
  shell: "ui.shell.v2",
  journal: "ui.journal.v2",
  settings: "ui.settings.v2",
  chart: "ui.chart.v2",
  public: "ui.public.v2",
};

export type UiRolloutConfig = {
  defaults?: Partial<Record<UiRouteGroup, boolean>>;
  overrides?: Partial<Record<UiRouteGroup, boolean>>;
  killSwitch?: boolean;
};

export type UiRolloutServerResponse = {
  revision: string;
  kill_switch: boolean;
  flags: Record<UiRouteGroup, boolean>;
};

type UiRolloutSnapshot = {
  response: UiRolloutServerResponse;
  savedAt: number;
  version: 1;
};

type UiRolloutSnapshotStorage = Pick<Storage, "removeItem" | "setItem">;

export const UI_ROLLOUT_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const SHELL_DEPENDENTS: readonly UiRouteGroup[] = ["journal", "settings", "chart"];

/** Server overrides win; the kill switch provides a reversible fallback without changing routes or data. */
export function resolveUiRollout(config: UiRolloutConfig = {}): Readonly<Record<UiRouteGroup, boolean>> {
  const killSwitch = config.killSwitch === true;
  const resolved = Object.fromEntries(UI_ROUTE_GROUPS.map((group) => {
    const override = config.overrides?.[group];
    const fallback = config.defaults?.[group];
    const enabled = typeof override === "boolean"
      ? override
      : typeof fallback === "boolean"
        ? fallback
        : true;
    return [group, killSwitch ? false : enabled];
  })) as Record<UiRouteGroup, boolean>;

  // Authenticated surfaces use the shared shell. Keeping this dependency in
  // one resolver prevents a child route from rendering a mixed v1/v2 tree.
  if (!resolved.shell) {
    SHELL_DEPENDENTS.forEach((group) => { resolved[group] = false; });
  }

  return Object.freeze(resolved);
}

export function routeGroup(pathname: string): UiRouteGroup {
  const path = normalizedPathname(pathname);
  if (path === "/shared") return "chart";
  if (path !== "/app" && !path.startsWith("/app/")) return "public";
  const section = path.split("/")[2] ?? "";
  if (section === "journal" || section === "reports") return "journal";
  if (section === "settings") return "settings";
  if (["live", "replay", "chart", "quant", "order-flow"].includes(section)) return "chart";
  return "shell";
}

export function compatibilityRouteIsMapped(pathname: string) {
  const path = normalizedPathname(pathname);
  return UI_COMPATIBILITY_PATHS[routeGroup(path)].includes(path);
}

export function compatibilityParityContract(pathname: string): CompatibilityRouteParity | null {
  return UI_COMPATIBILITY_ROUTE_PARITY[normalizedPathname(pathname)] ?? null;
}

/** Compatibility rendering changes presentation only; the active deep link remains authoritative. */
export function compatibilityDeepLink(location: { pathname: string; search?: string; hash?: string }) {
  const pathname = normalizedPathname(location.pathname);
  return `${pathname}${location.search ?? ""}${location.hash ?? ""}`;
}

export function rolloutStorageKey(scope = "deployment") {
  return `edgelab.ui-rollout.v2.${encodeURIComponent(scope)}`;
}

export function normalizeServerUiRollout(value: unknown): UiRolloutServerResponse | null {
  if (!isRecord(value) || typeof value.kill_switch !== "boolean") return null;
  const revision = typeof value.revision === "string" ? value.revision.trim() : "";
  if (!revision || revision.length > 128 || !isRecord(value.flags)) return null;
  const flags = {} as Record<UiRouteGroup, boolean>;
  for (const group of UI_ROUTE_GROUPS) {
    if (typeof value.flags[group] !== "boolean") return null;
    flags[group] = value.flags[group];
  }
  return { flags, kill_switch: value.kill_switch, revision };
}

export function resolveServerUiRollout(response: unknown) {
  const normalized = normalizeServerUiRollout(response);
  if (!normalized) return resolveUiRollout({ killSwitch: true });
  return resolveUiRollout({ killSwitch: normalized.kill_switch, overrides: normalized.flags });
}

export function serializeUiRolloutSnapshot(response: unknown, savedAt = Date.now()) {
  const normalized = normalizeServerUiRollout(response);
  if (!normalized || !Number.isFinite(savedAt)) return null;
  return JSON.stringify({ response: normalized, savedAt, version: 1 } satisfies UiRolloutSnapshot);
}

/** A rejected response must evict an older enabled snapshot before the next reload. */
export function persistUiRolloutSnapshot(
  storage: UiRolloutSnapshotStorage,
  response: unknown,
  savedAt = Date.now(),
) {
  const key = rolloutStorageKey();
  const snapshot = serializeUiRolloutSnapshot(response, savedAt);
  if (!snapshot) {
    try { storage.removeItem(key); } catch { /* Runtime fallback remains active. */ }
    return false;
  }
  try {
    storage.setItem(key, snapshot);
    return true;
  } catch {
    // Do not leave an older enabled snapshot behind when the new policy could
    // not be stored (for example because browser storage is full).
    try { storage.removeItem(key); } catch { /* Runtime fallback remains active. */ }
    return false;
  }
}

export function parseUiRolloutSnapshot(
  rawValue: string | null,
  now = Date.now(),
  maxAgeMs = UI_ROLLOUT_CACHE_MAX_AGE_MS,
): UiRolloutServerResponse | null {
  if (!rawValue || !Number.isFinite(now) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) return null;
  try {
    const snapshot = JSON.parse(rawValue) as Partial<UiRolloutSnapshot>;
    if (
      snapshot.version !== 1 ||
      typeof snapshot.savedAt !== "number" ||
      !Number.isFinite(snapshot.savedAt) ||
      snapshot.savedAt > now + 5 * 60 * 1_000 ||
      now - snapshot.savedAt > maxAgeMs
    ) return null;
    return normalizeServerUiRollout(snapshot.response);
  } catch {
    return null;
  }
}

function normalizedPathname(value: string) {
  const rawPath = value.split(/[?#]/, 1)[0] || "/";
  try {
    return new URL(rawPath, "https://edgelab.invalid").pathname.replace(/\/+$/, "") || "/";
  } catch {
    return "/";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
