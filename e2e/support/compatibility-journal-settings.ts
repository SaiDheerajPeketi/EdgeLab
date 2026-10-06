import { expect, type Page } from "@playwright/test";
import { betaSessionResponse, installDeterminism, seedApprovedSession } from "./app";

export const journalSettingsStoragePath = "/api/app-storage/edgelab/live-journal.v1";
export const noteTemplateStoragePath = "/api/app-storage/edgelab/notebook-template.v1";
export const journalSettingsPatchPath = "/api/journal/settings";
export const initialJournalDefaults = { default_broker: "Seed broker", default_currency: "USD", default_entry_type: "TAKEN", require_account_for_taken_trades: true };
export const journalDefaultsCanary = { default_broker: "Rollback desk", default_currency: "EUR", default_entry_type: "MISSED", require_account_for_taken_trades: false };
export const initialNoteTemplate = "Seed review\nEntry: {entry}";
export const noteTemplateCanary = "  Review before: {entry}\nReview after: {exit}  \n\n";
export const initialJournalBlob = {
  schemaVersion: 1, accounts: [{ id: "legacy-account", name: "Preserved desk" }], trades: [], tags: [], dailyNotes: [],
  settings: { ...initialJournalDefaults, default_timezone: "Europe/Berlin", unknownSetting: "keep me" },
  unknownTopLevel: { marker: ["preserved", 12] },
};

type JournalBlob = typeof initialJournalBlob;
type Write = { owner: number; method: string; path: string; body: Record<string, unknown> };
export async function installJournalSettingsFixture(page: Page, { setup = true }: { setup?: boolean } = {}) {
  if (setup) {
    await installDeterminism(page, { rollout: "fallback" });
    await seedApprovedSession(page);
  }
  const state = {
    fallback: true, owner: betaSessionResponse.user.id,
    failRead: false, failDefaults: false, failTemplate: false,
    defaultsGate: null as Promise<void> | null, templateGate: null as Promise<void> | null,
    reads: [] as Array<{ owner: number; path: string }>, writes: [] as Write[],
    journals: new Map<number, JournalBlob>([[betaSessionResponse.user.id, structuredClone(initialJournalBlob)]]),
    templates: new Map<number, string>([[betaSessionResponse.user.id, initialNoteTemplate]]),
  };
  await page.route("**/api/ui/rollout", (route) => route.fulfill({ json: {
    revision: state.fallback ? "journal-settings-fallback" : "journal-settings-modern", kill_switch: state.fallback,
    flags: { shell: true, journal: true, settings: true, chart: true, public: true },
  } }));
  for (const storagePath of [journalSettingsStoragePath, noteTemplateStoragePath]) {
    await page.route(`**${storagePath}`, async (route) => {
      const owner = state.owner;
      const method = route.request().method();
      if (method === "GET") {
        state.reads.push({ owner, path: storagePath });
        if (state.failRead) { await route.fulfill({ status: 500, json: { detail: "Settings read unavailable" } }); return; }
      } else {
        expect(storagePath).toBe(noteTemplateStoragePath);
        expect(method).toBe("PUT");
        const body = route.request().postDataJSON() as { value: string };
        state.writes.push({ owner, method, path: storagePath, body });
        if (state.templateGate) await state.templateGate;
        if (state.failTemplate) { await route.fulfill({ status: 500, json: { detail: "Template storage unavailable" } }); return; }
        state.templates.set(owner, body.value);
      }
      await route.fulfill({ json: { namespace: "edgelab", key: storagePath.split("/").at(-1), updated_at: "2026-09-15T10:30:00.000Z",
        value: storagePath === journalSettingsStoragePath ? state.journals.get(owner) ?? null : state.templates.get(owner) ?? null } });
    });
  }
  await page.route(`**${journalSettingsPatchPath}`, async (route) => {
    const owner = state.owner;
    expect(route.request().method()).toBe("PATCH");
    const body = route.request().postDataJSON() as Partial<typeof initialJournalDefaults>;
    state.writes.push({ owner, method: "PATCH", path: journalSettingsPatchPath, body });
    if (state.defaultsGate) await state.defaultsGate;
    if (state.failDefaults) { await route.fulfill({ status: 500, json: { detail: "Journal settings storage unavailable" } }); return; }
    const current = state.journals.get(owner) ?? structuredClone(initialJournalBlob);
    const value = { ...current, settings: { ...current.settings, ...body, default_broker: body.default_broker?.trim() || current.settings.default_broker } };
    if (body.default_broker != null && !body.default_broker.trim()) value.settings.default_broker = "Manual";
    state.journals.set(owner, value);
    await route.fulfill({ json: { namespace: "edgelab", key: "live-journal.v1", updated_at: "2026-09-15T10:30:00.000Z", value } });
  });
  return state;
}
