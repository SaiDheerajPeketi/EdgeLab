export const UI_ROUTE_GROUPS = ["shell", "journal", "settings", "chart", "public"] as const;

export type UiRouteGroup = (typeof UI_ROUTE_GROUPS)[number];

export type CompatibilityRoute = { href: string; label: string };
export type CompatibilityParityKind = "read-only" | "shared-domain" | "writable";
export type CompatibilityRouteParity = {
  kind: CompatibilityParityKind;
  sessionSource: "auth-session" | "route-session";
  draftKey: string | null;
  savedDataRead: "public-route" | "workspace-storage" | "canonical-trades" | "settings-preferences" | "replay-layout";
  primaryAction: "navigate" | "refresh-journal" | "save-settings" | "restore-replay-layout";
  requiredViewports: readonly ["mobile", "desktop"];
  testCaseId: "public-read-continuity" | "shell-session-continuity" | "journal-canonical-refresh" | "settings-draft-save" | "chart-replay-layout";
  reasonSource: string;
};

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

const GROUP_PARITY: Readonly<Record<UiRouteGroup, CompatibilityRouteParity>> = Object.freeze({
  public: { kind: "read-only", sessionSource: "route-session", draftKey: null, savedDataRead: "public-route", primaryAction: "navigate", requiredViewports: ["mobile", "desktop"], testCaseId: "public-read-continuity", reasonSource: "frontend/src/routes/AppRoutes.tsx" },
  shell: { kind: "read-only", sessionSource: "auth-session", draftKey: null, savedDataRead: "workspace-storage", primaryAction: "navigate", requiredViewports: ["mobile", "desktop"], testCaseId: "shell-session-continuity", reasonSource: "frontend/src/components/compatibility/CompatibilityRouteRenderer.tsx#ShellCompatibility" },
  journal: { kind: "shared-domain", sessionSource: "auth-session", draftKey: "journal-route-context", savedDataRead: "canonical-trades", primaryAction: "refresh-journal", requiredViewports: ["mobile", "desktop"], testCaseId: "journal-canonical-refresh", reasonSource: "frontend/src/lib/journalApi.ts#listCanonicalTrades" },
  settings: { kind: "writable", sessionSource: "auth-session", draftKey: "edgelab.compatibility.settings-draft.v1", savedDataRead: "settings-preferences", primaryAction: "save-settings", requiredViewports: ["mobile", "desktop"], testCaseId: "settings-draft-save", reasonSource: "frontend/src/lib/settingsPreferences.ts#saveSettingsPreferences" },
  chart: { kind: "shared-domain", sessionSource: "auth-session", draftKey: "active-live-chart-layout.v1", savedDataRead: "replay-layout", primaryAction: "restore-replay-layout", requiredViewports: ["mobile", "desktop"], testCaseId: "chart-replay-layout", reasonSource: "frontend/src/lib/api.ts#getLatestBacktest" },
});

export const UI_COMPATIBILITY_ROUTE_PARITY: Readonly<Record<string, CompatibilityRouteParity>> = Object.freeze(
  Object.fromEntries(Object.entries(UI_COMPATIBILITY_PATHS).flatMap(([group, paths]) => paths.map((path) => [path, GROUP_PARITY[group as UiRouteGroup]]))),
);

export const UI_COMPATIBILITY_ROUTES: Readonly<Record<UiRouteGroup, readonly CompatibilityRoute[]>> = Object.freeze({
  public: [{ href: "/", label: "Home" }, { href: "/pricing", label: "Pricing" }, { href: "/auth/signin", label: "Sign in" }],
  shell: [{ href: "/app", label: "Workspace" }, { href: "/app/live", label: "Live" }, { href: "/app/journal/dashboard", label: "Journal" }, { href: "/app/settings/global", label: "Settings" }],
  journal: [{ href: "/app/journal/dashboard", label: "Overview" }, { href: "/app/journal/trades", label: "Trades" }, { href: "/app/reports", label: "Reports" }],
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
