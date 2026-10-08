import React from "react";
import { createRoot } from "react-dom/client";
import { SettingsCenter } from "../frontend/src/components/settings/SettingsCenter";
import { useJournalSettings } from "../frontend/src/components/settings/useJournalSettings";
import { useSettingsPreferences } from "../frontend/src/components/settings/useSettingsPreferences";
import { setStoredAuthSession } from "../frontend/src/lib/authSession";
import { settingsPreferencesStorageKey } from "../frontend/src/lib/settingsPreferences";
import { getCachedAppStorageItem } from "../frontend/src/lib/serverStorage";
const session = owner => ({ createdAt: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", token: "settings-ack87-owner-" + owner,
  user: { id: owner, email: "settings87-" + owner + "@example.test", name: "Settings tester", approved: true, betaPosition: 1,
    deploymentMode: "beta", workspaceAccess: true, accessExpiresAt: "2099-01-01T00:00:00Z", isBetaUser: true, plan: "beta", provider: "email" } });
const fixture = (window as any).settingsAckFixture = { current: null, captured: null,
  cache: key => getCachedAppStorageItem(key, "unconfirmed"),
  conflict: () => window.dispatchEvent(new StorageEvent("storage", { key: settingsPreferencesStorageKey(), newValue: JSON.stringify({ density: "compact", includeDiagnosticsByDefault: true }) })),
  capture: () => { const { journal, preferences } = fixture.current; fixture.captured = { journal: journal.saveJournal, note: journal.saveNote, preference: () => preferences.retry("includeDiagnosticsByDefault"), newer: preferences.useNewer }; },
  invokeCaptured: key => fixture.captured[key](),
  switchOwner: owner => setStoredAuthSession(session(owner)),
};
setStoredAuthSession(session(8701));
window.confirm = () => true;
function Probe() {
  const journal = useJournalSettings(), preferences = useSettingsPreferences();
  fixture.current = { journal, preferences };
  return null;
}
createRoot(document.querySelector("#root")).render(<><Probe /><SettingsCenter initialCategory="journal" datasets={null}
  journalDefaults={{ default_broker: "Seed broker", default_currency: "USD", default_entry_type: "TAKEN", require_account_for_taken_trades: true }}
  onGetDatasetRefreshStatus={async () => ({ running: false })} onRefreshDatasets={async () => ({ status: { running: false } })}
  onUpdateDatasetAsset={async () => {}} onUpdateDatasetSettings={async () => {}} onUpdateJournalDefaults={() => {}} /></>);
