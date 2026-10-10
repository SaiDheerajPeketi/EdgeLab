import { getStoredAuthSession, hasWorkspaceAccess, subscribeAuthSession } from "./authSession";
import { applySettingsPreferences, applyWorkspaceAppTheme, hydrateSettingsPreferences, loadSettingsPreferences, sanitizeSettingsPreferences, settingsPreferencesStorageKey } from "./settingsPreferences";

/** Scope the account's presentation to the workspace; body/fullscreen portals inherit it. */
export function startWorkspaceTheme() {
  const root = document.documentElement;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  let identity = "";
  let stopped = false;
  root.dataset.workspaceTheme = "active";
  function syncOwner() {
    const session = getStoredAuthSession();
    const next = session && hasWorkspaceAccess(session) ? `${session.user.id}:${session.token}` : "";
    if (!next) {
      identity = "";
      delete root.dataset.appTheme;
      delete root.dataset.appThemePreference;
      return;
    }
    if (next === identity) return;
    identity = next;
    applySettingsPreferences(loadSettingsPreferences());
    // The storage layer guards account/epoch changes before persisting or applying.
    void hydrateSettingsPreferences().catch(() => { /* Keep the current account's local appearance when offline. */ });
  }
  const unsubscribe = subscribeAuthSession(syncOwner);
  const systemChanged = () => {
    if (!stopped && root.dataset.appThemePreference === "system") applyWorkspaceAppTheme("system");
  };
  const saved = (event: Event) => {
    if (identity && !stopped) applySettingsPreferences(sanitizeSettingsPreferences((event as CustomEvent).detail));
  };
  const stored = (event: StorageEvent) => {
    if (identity && event.key === settingsPreferencesStorageKey()) applySettingsPreferences(loadSettingsPreferences());
  };
  media.addEventListener("change", systemChanged);
  window.addEventListener("edgelab:settings-preferences", saved);
  window.addEventListener("storage", stored);
  syncOwner();
  return () => {
    stopped = true;
    unsubscribe();
    media.removeEventListener("change", systemChanged);
    window.removeEventListener("edgelab:settings-preferences", saved);
    window.removeEventListener("storage", stored);
    delete root.dataset.workspaceTheme;
    delete root.dataset.appTheme;
    delete root.dataset.appThemePreference;
  };
}
