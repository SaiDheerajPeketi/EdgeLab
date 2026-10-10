import { getStoredAuthSession } from "./authSession";
import { loadAppStorageItem, saveAppStorageItemConfirmed } from "./serverStorage";
import { appDataSessionKey, assertAppDataAccess, captureAppDataAccess, type AppDataAccess } from "./appDataBarrier";

export type SettingsDensity = "comfortable" | "compact";
export type AppTheme = "dark" | "light" | "system";

export type SettingsPreferences = {
  appTheme: AppTheme;
  density: SettingsDensity;
  includeDiagnosticsByDefault: boolean;
};

export const DEFAULT_SETTINGS_PREFERENCES: SettingsPreferences = {
  appTheme: "dark",
  density: "comfortable",
  includeDiagnosticsByDefault: true,
};

const SETTINGS_PREFERENCES_KEY = "settings-center.v1";

export function settingsPreferencesStorageKey() {
  const user = getStoredAuthSession()?.user;
  const owner = user?.id ? `user-${user.id}` : user?.email ? `user-${encodeURIComponent(user.email.toLowerCase())}` : "anonymous";
  return appDataSessionKey(`edgelab.${SETTINGS_PREFERENCES_KEY}.${owner}`, owner);
}

export function sanitizeSettingsPreferences(value: unknown): SettingsPreferences {
  const candidate = value && typeof value === "object" ? value as Partial<SettingsPreferences> : {};
  return {
    appTheme: candidate.appTheme === "light" || candidate.appTheme === "system" ? candidate.appTheme : "dark",
    density: candidate.density === "compact" ? "compact" : "comfortable",
    includeDiagnosticsByDefault:
      typeof candidate.includeDiagnosticsByDefault === "boolean"
        ? candidate.includeDiagnosticsByDefault
        : DEFAULT_SETTINGS_PREFERENCES.includeDiagnosticsByDefault,
  };
}

export function loadSettingsPreferences(): SettingsPreferences {
  if (typeof window === "undefined") return DEFAULT_SETTINGS_PREFERENCES;
  try {
    assertAppDataAccess(captureAppDataAccess());
    const raw = window.localStorage.getItem(settingsPreferencesStorageKey());
    return raw ? sanitizeSettingsPreferences(JSON.parse(raw)) : DEFAULT_SETTINGS_PREFERENCES;
  } catch {
    return DEFAULT_SETTINGS_PREFERENCES;
  }
}

export function resolveAppTheme(preference: AppTheme, systemDark: boolean): "dark" | "light" {
  return preference === "system" ? systemDark ? "dark" : "light" : preference;
}

export function applyWorkspaceAppTheme(preference: AppTheme) {
  if (typeof document === "undefined" || document.documentElement.dataset.workspaceTheme !== "active") return;
  document.documentElement.dataset.appThemePreference = preference;
  document.documentElement.dataset.appTheme = resolveAppTheme(preference, typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

export function applySettingsPreferences(value: SettingsPreferences) {
  if (typeof document === "undefined") return;
  const preferences = sanitizeSettingsPreferences(value);
  document.documentElement.dataset.density = preferences.density;
  applyWorkspaceAppTheme(preferences.appTheme);
}

export async function hydrateSettingsPreferences(): Promise<SettingsPreferences> {
  const access = captureAppDataAccess();
  assertAppDataAccess(access);
  const local = loadSettingsPreferences();
  const remote = sanitizeSettingsPreferences(
    await loadAppStorageItem<SettingsPreferences>(SETTINGS_PREFERENCES_KEY, local),
  );
  persistLocal(remote, access);
  return remote;
}

export async function saveSettingsPreferences(
  value: SettingsPreferences,
  { requireServerPersistence = false }: { requireServerPersistence?: boolean } = {},
) {
  const access = captureAppDataAccess();
  assertAppDataAccess(access, true);
  const sanitized = sanitizeSettingsPreferences(value);
  persistLocal(sanitized, access);
  const result = await saveAppStorageItemConfirmed(SETTINGS_PREFERENCES_KEY, sanitized);
  if (requireServerPersistence && !result.serverPersisted) {
    throw new Error("Settings could not be saved to the server.");
  }
  return sanitized;
}

export function cacheSettingsPreferences(value: SettingsPreferences, access: AppDataAccess | null = captureAppDataAccess()) {
  if (typeof window === "undefined") return;
  assertAppDataAccess(access);
  const key = access ? appDataSessionKey(`edgelab.${SETTINGS_PREFERENCES_KEY}.${access.owner}`, access.owner) : settingsPreferencesStorageKey();
  window.localStorage.setItem(key, JSON.stringify(sanitizeSettingsPreferences(value)));
}

function persistLocal(value: SettingsPreferences, access: AppDataAccess | null = captureAppDataAccess()) {
  cacheSettingsPreferences(value, access);
  applySettingsPreferences(value);
  window.dispatchEvent(new CustomEvent("edgelab:settings-preferences", { detail: value }));
}
