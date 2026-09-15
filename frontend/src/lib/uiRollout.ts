export type UiRouteGroup = "shell" | "journal" | "settings" | "chart" | "public";

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

/** Server overrides win; the kill switch provides a reversible fallback without changing routes or data. */
export function resolveUiRollout(config: UiRolloutConfig = {}): Readonly<Record<UiRouteGroup, boolean>> {
  const groups = Object.keys(UI_ROLLOUT_FLAGS) as UiRouteGroup[];
  return Object.freeze(Object.fromEntries(groups.map((group) => [
    group,
    config.killSwitch ? false : config.overrides?.[group] ?? config.defaults?.[group] ?? true,
  ])) as Record<UiRouteGroup, boolean>);
}

export function routeGroup(pathname: string): UiRouteGroup {
  if (!pathname.startsWith("/app")) return "public";
  if (pathname.includes("/journal") || pathname.includes("/reports")) return "journal";
  if (pathname.includes("/settings")) return "settings";
  if (/\/(live|replay|chart|quant|order-flow)(\/|$)/.test(pathname)) return "chart";
  return "shell";
}

export function rolloutStorageKey(workspaceId: string) {
  return `edgelab.ui-rollout.v2.${encodeURIComponent(workspaceId)}`;
}
