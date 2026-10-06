export const SETTINGS_CATEGORY_IDS = [
  "global",
  "journal",
  "backtest",
  "chart",
  "appearance",
  "data-providers",
  "account",
  "ai",
  "privacy-security",
  "storage",
] as const;

export type SettingsCategoryId = (typeof SETTINGS_CATEGORY_IDS)[number];

export function settingsCategoryForPath(pathname: string): SettingsCategoryId | null {
  const match = /^\/app\/settings(?:\/([^/]+))?\/?$/.exec(pathname);
  if (!match) return null;
  const category = match[1] ?? "global";
  return SETTINGS_CATEGORY_IDS.includes(category as SettingsCategoryId) ? category as SettingsCategoryId : null;
}

export type SettingsControl = {
  category: SettingsCategoryId;
  description: string;
  id: string;
  keywords: string[];
  label: string;
};

export type SettingsCategory = {
  description: string;
  id: SettingsCategoryId;
  label: string;
};

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  { id: "global", label: "Global", description: "Regional behavior and workspace-wide defaults." },
  { id: "journal", label: "Journal", description: "Capture defaults and reusable review notes." },
  { id: "backtest", label: "Backtest", description: "Order sizing, costs, and replay safeguards." },
  { id: "chart", label: "Chart", description: "Chart presentation and saved visual defaults." },
  { id: "appearance", label: "Appearance", description: "Interface density and staged palette preview." },
  { id: "data-providers", label: "Data & providers", description: "Dataset paths, refresh health, and broker sync." },
  { id: "account", label: "Account", description: "Signed-in identity and this browser session." },
  { id: "ai", label: "AI", description: "Model-routing availability and data boundaries." },
  { id: "privacy-security", label: "Privacy & security", description: "Diagnostics, credentials, sharing, and permissions." },
  { id: "storage", label: "Storage", description: "Portable exports, validated imports, and deletion controls." },
];

export const SETTINGS_CONTROLS: SettingsControl[] = [
  control("global", "regional-format", "Language, time zone, and number format", "Effective browser and workspace region settings.", ["locale", "currency", "date", "time"]),
  control("journal", "journal-defaults", "Journal capture defaults", "Default currency, broker, entry type, and account requirement.", ["trade diary", "taken", "missed", "account"]),
  control("journal", "note-template", "Review note template", "Template inserted when starting a new review note.", ["notebook", "notes", "review", "template"]),
  control("backtest", "sizing-mode", "Order sizing mode", "Choose fixed quantity or percent-risk sizing.", ["quantity", "position size", "risk"]),
  control("backtest", "default-quantity", "Default quantity", "Quantity used to prefill new fixed-size orders.", ["contracts", "lots", "units"]),
  control("backtest", "default-risk", "Default risk", "Percent used to prefill risk-sized orders.", ["percent", "risk per trade"]),
  control("backtest", "risk-basis", "Risk balance basis", "Calculate percent risk from current or initial balance.", ["current balance", "initial balance", "equity"]),
  control("backtest", "trading-costs", "Commissions and fees", "Default cost modes and values for new replay sessions.", ["brokerage", "commission", "fee", "cost"]),
  control("backtest", "line-confirmation", "Chart-line confirmation", "Require confirmation before a chart line changes an order.", ["order line", "safety", "confirm"]),
  control("chart", "chart-preset", "Chart visual preset", "Stage chart defaults and save them for the next workspace load.", ["grid", "text", "time format", "colors", "theme"]),
  control("appearance", "settings-density", "Settings density", "Adjust spacing in this settings workspace.", ["compact", "comfortable", "spacing"]),
  control("appearance", "palette-preview", "Palette preview", "Preview chart and interface colors before applying.", ["color", "theme", "chart"]),
  control("data-providers", "dataset-root", "Dataset root", "Folder scanned for local market-data files.", ["csv", "folder", "path", "market data"]),
  control("data-providers", "dataset-refresh", "Dataset refresh", "Rescan local files and inspect the last refresh result.", ["rescan", "sync", "health"]),
  control("data-providers", "asset-calibration", "Instrument calibration", "Currency, time zone, and P&L multiplier per instrument.", ["symbol", "multiplier", "timezone"]),
  control("data-providers", "broker-connections", "Broker connections", "Credential readiness and supported import capabilities.", ["integration", "provider", "sync", "secret", "api key"]),
  control("account", "account-identity", "Account identity", "The user currently signed in to EdgeLab.", ["email", "profile", "user"]),
  control("account", "current-session", "Current session", "Review or end this browser session.", ["device", "sign out", "logout"]),
  control("ai", "ai-routing", "AI model routing", "Availability and data handling for AI-assisted features.", ["model", "assistant", "conversation", "retention"]),
  control("privacy-security", "diagnostic-sharing", "Diagnostic sharing", "Choose whether feedback starts with browser diagnostics enabled.", ["feedback", "logs", "privacy"]),
  control("privacy-security", "credential-vault", "Credential handling", "Server vault metadata and revocation controls.", ["secret", "token", "api key", "encryption"]),
  control("privacy-security", "workspace-sharing", "Workspace sharing", "Recipient-bound snapshot access rules.", ["share", "recipient", "snapshot"]),
  control("privacy-security", "device-permissions", "Device and code permissions", "Microphone and generated-code availability.", ["microphone", "code", "permission"]),
  control("storage", "export-data", "Export EdgeLab data", "Download a portable JSON bundle of account-owned application data.", ["backup", "download", "json"]),
  control("storage", "import-data", "Import EdgeLab data", "Validate and preview a bundle before replacing stored data.", ["restore", "upload", "backup", "json"]),
];

function control(
  category: SettingsCategoryId,
  id: string,
  label: string,
  description: string,
  keywords: string[],
): SettingsControl {
  return { category, description, id, keywords, label };
}

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function searchSettings(
  query: string,
  category: SettingsCategoryId | "all" = "all",
): SettingsControl[] {
  const normalized = normalizeSearch(query);
  const terms = normalized.split(" ").filter(Boolean);
  return SETTINGS_CONTROLS
    .filter((item) => category === "all" || item.category === category)
    .map((item) => {
      if (terms.length === 0) return { item, score: 1 };
      const label = normalizeSearch(item.label);
      const id = normalizeSearch(item.id);
      const categoryLabel = normalizeSearch(
        SETTINGS_CATEGORIES.find((candidate) => candidate.id === item.category)?.label ?? item.category,
      );
      const keywords = item.keywords.map(normalizeSearch);
      let score = 0;
      for (const term of terms) {
        if (label === term) score += 30;
        else if (label.startsWith(term)) score += 20;
        else if (label.includes(term)) score += 12;
        if (id.includes(term)) score += 7;
        if (categoryLabel.includes(term)) score += 5;
        if (keywords.some((keyword) => keyword === term)) score += 14;
        else if (keywords.some((keyword) => keyword.includes(term))) score += 8;
      }
      return { item, score };
    })
    .filter(({ score }) => terms.length === 0 || score > 0)
    .sort((left, right) => right.score - left.score || left.item.label.localeCompare(right.item.label))
    .map(({ item }) => item);
}

export function settingsDeepLink(category: SettingsCategoryId, controlId?: string) {
  return `#settings/${category}${controlId ? `/${encodeURIComponent(controlId)}` : ""}`;
}

export function parseSettingsDeepLink(hash: string): {
  category: SettingsCategoryId;
  controlId: string | null;
} | null {
  const match = hash.match(/^#settings\/([^/]+)(?:\/([^/]+))?$/);
  if (!match || !SETTINGS_CATEGORY_IDS.includes(match[1] as SettingsCategoryId)) return null;
  let controlId: string | null = null;
  if (match[2]) {
    try {
      controlId = decodeURIComponent(match[2]);
    } catch {
      return null;
    }
    if (!SETTINGS_CONTROLS.some((item) => item.category === match[1] && item.id === controlId)) {
      return null;
    }
  }
  return { category: match[1] as SettingsCategoryId, controlId };
}
