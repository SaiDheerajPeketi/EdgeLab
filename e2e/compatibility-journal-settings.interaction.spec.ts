import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { betaSessionResponse, certifyUiState, gotoStable, installDeterminism } from "./support/app";
import {
  initialJournalBlob, initialJournalDefaults, initialNoteTemplate, installJournalSettingsFixture,
  journalDefaultsCanary, journalSettingsPatchPath, journalSettingsStoragePath, noteTemplateCanary, noteTemplateStoragePath,
} from "./support/compatibility-journal-settings";

test.use({ video: "off" });
type State = Awaited<ReturnType<typeof installJournalSettingsFixture>>;
const paths = ["/app/journal/settings", "/app/settings/journal"] as const;
const currency = (page: Page) => page.getByLabel("Currency", { exact: true });
const broker = (page: Page) => page.getByLabel("Broker label", { exact: true });
const entry = (page: Page) => page.getByRole("combobox", { name: "Default entry type", exact: true });
const requireAccount = (page: Page) => page.getByRole("switch", { name: "Require account for taken trades", exact: true });
const template = (page: Page) => page.getByRole("textbox", { name: "Review note template", exact: true });
const apply = (page: Page) => page.getByRole("button", { name: /^(Apply journal defaults|Retry journal defaults|Applying journal defaults…|Saving journal defaults…)$/ });
const saveTemplate = (page: Page) => page.getByRole("button", { name: /^(Save note template|Retry note template|Saving note template…)$/ });
const boundary = (page: Page, path: string) => page.locator(`[data-route-group="${path.startsWith("/app/journal/") ? "journal" : "settings"}"]`);
const savedStatus = (page: Page, text: string) => page.getByRole("status").filter({ hasText: new RegExp(`^${text}$`) });

async function fillDefaults(page: Page, value = journalDefaultsCanary) {
  await broker(page).fill(value.default_broker);
  await currency(page).fill(value.default_currency);
  await entry(page).selectOption(value.default_entry_type);
  await requireAccount(page).setChecked(value.require_account_for_taken_trades);
}
async function expectDefaults(page: Page, value = journalDefaultsCanary) {
  await expect(broker(page)).toHaveValue(value.default_broker);
  await expect(currency(page)).toHaveValue(value.default_currency);
  await expect(entry(page)).toHaveValue(value.default_entry_type);
  if (value.require_account_for_taken_trades) await expect(requireAccount(page)).toBeChecked();
  else await expect(requireAccount(page)).not.toBeChecked();
}
async function switchRenderer(page: Page, state: State, path: string, fallback: boolean, hot = false) {
  state.fallback = fallback;
  if (hot) await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  else await page.reload({ waitUntil: "domcontentloaded" });
  await expect(boundary(page, path)).toHaveAttribute("data-ui-version", fallback ? "fallback" : "v2");
}
async function draft(page: Page, owner: number, surface: string) {
  return page.evaluate(({ owner, surface }) => JSON.parse(sessionStorage.getItem(`edgelab.navigation-surfaces.v3.user-${owner}`) ?? "{}")[surface]?.draft?.value ?? {}, { owner, surface });
}
async function effectiveTemplate(page: Page) {
  return page.evaluate(async () => {
    const modulePath = "/src/lib/serverStorage.ts";
    const { getCachedAppStorageItem } = await import(modulePath);
    return getCachedAppStorageItem("notebook-template.v1", "unconfirmed");
  });
}
async function capture(page: Page, path: string, version: string, info: TestInfo) {
  if (process.env.EDGELAB_JOURNAL_SETTINGS_CAPTURE !== "1" || !["desktop", "mobile"].includes(info.project.name) || path !== paths[0]) return;
  await page.evaluate(() => { window.scrollTo(0, 0); const workspace = document.querySelector<HTMLElement>("#workspace-content"); if (workspace) workspace.scrollTop = 0; });
  const output = `.impeccable/review/compatibility-journal-settings-${version}-${info.project.name}.png`;
  const image = await page.screenshot({ path: output, animations: "disabled", fullPage: false });
  const geometry = await page.evaluate(() => {
    const workspace = document.querySelector<HTMLElement>("#workspace-content");
    return { scrollY, documentHeight: document.documentElement.scrollHeight,
      workspace: workspace ? { clientHeight: workspace.clientHeight, scrollHeight: workspace.scrollHeight, scrollTop: workspace.scrollTop } : null };
  });
  const metadata = {
    path: output, url: page.url(), version, viewport: page.viewportSize(), width: image.readUInt32BE(16), height: image.readUInt32BE(20),
    project: info.project.name, captureMode: "native viewport from document and workspace top", ...geometry,
  };
  const metadataPath = ".impeccable/review/compatibility-journal-settings-capture-metadata.json";
  const prior = JSON.parse(await readFile(metadataPath, "utf8").catch(() => "{\"captures\":[]}"));
  const captures = prior.captures.filter((item: { project: string; version: string }) => item.project !== metadata.project || item.version !== metadata.version);
  await writeFile(metadataPath, JSON.stringify({ captures: [...captures, metadata] }, null, 2));
  await info.attach("journal-settings-review-capture", { contentType: "application/json", body: Buffer.from(JSON.stringify(metadata)) });
}

for (const path of paths) {
  test(`${path} saves exact defaults and multiline template through fallback-modern-fallback`, async ({ page }, info) => {
    const state = await installJournalSettingsFixture(page);
    await gotoStable(page, path, { waitForNetworkIdle: false });
    await expect(boundary(page, path)).toHaveAttribute("data-ui-version", "fallback");
    await expectDefaults(page, initialJournalDefaults);
    await expect(template(page)).toHaveValue(initialNoteTemplate);
    await expect(page.getByLabel("Workspace density", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Settings density", { exact: true })).toHaveCount(0);
    await fillDefaults(page);
    await template(page).fill(noteTemplateCanary);
    await apply(page).click();
    await expect(savedStatus(page, "Journal defaults saved")).toBeVisible();
    await expect(template(page)).toHaveValue(noteTemplateCanary);
    await expect(saveTemplate(page)).toBeEnabled();
    await saveTemplate(page).click();
    await expect(savedStatus(page, "Note template saved")).toBeVisible();
    expect(state.writes).toEqual([
      { owner: state.owner, method: "PATCH", path: journalSettingsPatchPath, body: journalDefaultsCanary },
      { owner: state.owner, method: "PUT", path: noteTemplateStoragePath, body: { value: noteTemplateCanary } },
    ]);
    expect(state.journals.get(state.owner)).toEqual({ ...initialJournalBlob, settings: { ...initialJournalBlob.settings, ...journalDefaultsCanary } });
    expect(state.templates.get(state.owner)).toBe(noteTemplateCanary);
    await expect.poll(() => draft(page, state.owner, "settings:journal-defaults")).toEqual({});
    await expect.poll(() => draft(page, state.owner, "settings:note-template")).toEqual({});
    await certifyUiState(page);
    await capture(page, path, "fallback", info);
    for (const fallback of [false, true]) {
      const reads = state.reads.length;
      await switchRenderer(page, state, path, fallback);
      await expectDefaults(page);
      await expect(template(page)).toHaveValue(noteTemplateCanary);
      await expect(apply(page)).toBeDisabled();
      await expect(saveTemplate(page)).toBeDisabled();
      await expect.poll(() => state.reads.length).toBeGreaterThan(reads);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await certifyUiState(page);
      if (!fallback) await capture(page, path, "modern", info);
    }
    expect(state.reads.map(({ path }) => path)).toEqual(expect.arrayContaining([journalSettingsStoragePath, noteTemplateStoragePath]));
  });

  test(`${path} retries strict load failures and preserves independently validated reset drafts`, async ({ page }) => {
    const state = await installJournalSettingsFixture(page);
    state.failRead = true;
    await gotoStable(page, path, { waitForNetworkIdle: false });
    await expect(page.getByRole("button", { name: "Retry loading settings", exact: true })).toBeVisible();
    await expect(apply(page)).toBeDisabled();
    expect(state.writes).toEqual([]);
    state.failRead = false;
    await page.getByRole("button", { name: "Retry loading settings", exact: true }).click();
    await expectDefaults(page, initialJournalDefaults);
    await currency(page).fill("U1");
    await expect(currency(page)).toHaveAttribute("aria-invalid", "true");
    await expect(apply(page)).toBeDisabled();
    await template(page).fill(noteTemplateCanary);
    await saveTemplate(page).click();
    await expect(savedStatus(page, "Note template saved")).toBeVisible();
    await template(page).fill(" \n ");
    await expect(saveTemplate(page)).toBeDisabled();
    await page.getByRole("button", { name: /^Reset (?:Journal )?defaults$/ }).click();
    await expectDefaults(page, { default_broker: "", default_currency: "USD", default_entry_type: "TAKEN", require_account_for_taken_trades: false });
    expect(state.journals.get(state.owner)).toEqual(initialJournalBlob);
    await expect(template(page)).toHaveValue(" \n ");
    await switchRenderer(page, state, path, false);
    await expectDefaults(page, { default_broker: "", default_currency: "USD", default_entry_type: "TAKEN", require_account_for_taken_trades: false });
    await expect(template(page)).toHaveValue(" \n ");
    await apply(page).click();
    await expect(savedStatus(page, "Journal defaults saved")).toBeVisible();
    await expect(broker(page)).toHaveValue("Manual");
    expect(state.writes.at(-1)?.body).toEqual({ default_broker: "", require_account_for_taken_trades: false });
  });

  test(`${path} keeps rejected writes and locks held defaults across hot switches before later edits`, async ({ page }) => {
    const state = await installJournalSettingsFixture(page);
    state.failDefaults = true;
    state.failTemplate = true;
    await gotoStable(page, path, { waitForNetworkIdle: false });
    await fillDefaults(page);
    await template(page).fill(noteTemplateCanary);
    await apply(page).click();
    await expect(page.getByRole("alert").filter({ hasText: /defaults.*saved|settings.*saved/i })).toBeVisible();
    await saveTemplate(page).click();
    await expect(page.getByRole("alert").filter({ hasText: /template.*saved/i })).toBeVisible();
    expect(state.journals.get(state.owner)).toEqual(initialJournalBlob);
    expect(state.templates.get(state.owner)).toBe(initialNoteTemplate);
    expect(await effectiveTemplate(page)).toBe(initialNoteTemplate);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectDefaults(page);
    await expect(template(page)).toHaveValue(noteTemplateCanary);
    state.failDefaults = false;
    state.failTemplate = false;
    await switchRenderer(page, state, path, false);
    let release!: () => void;
    state.defaultsGate = new Promise<void>((resolve) => { release = resolve; });
    await apply(page).click();
    await expect.poll(() => state.writes.filter(({ method }) => method === "PATCH").length).toBe(2);
    await expect(apply(page)).toBeDisabled();
    await expect(currency(page)).toBeEnabled();
    await expect(broker(page)).toBeEnabled();
    await currency(page).fill(initialJournalDefaults.default_currency);
    await broker(page).fill("Later unsaved broker");
    await expect(template(page)).toBeEnabled();
    await switchRenderer(page, state, path, true, true);
    await expectDefaults(page, { ...journalDefaultsCanary, default_broker: "Later unsaved broker", default_currency: "USD" });
    await expect(currency(page)).toBeEnabled();
    await expect(apply(page)).toBeDisabled();
    await expect(template(page)).toBeEnabled();
    release();
    await expect(savedStatus(page, "Journal defaults saved")).toBeVisible();
    await expect(currency(page)).toBeEnabled();
    await expect(currency(page)).toHaveValue(initialJournalDefaults.default_currency);
    await switchRenderer(page, state, path, false, true);
    await expect(broker(page)).toHaveValue("Later unsaved broker");
    await expect(currency(page)).toHaveValue(initialJournalDefaults.default_currency);
    await expect(apply(page)).toBeEnabled();
    await saveTemplate(page).click();
    await expect(savedStatus(page, "Note template saved")).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(broker(page)).toHaveValue("Later unsaved broker");
    await expect(template(page)).toHaveValue(noteTemplateCanary);
    expect(state.writes.filter(({ method }) => method === "PATCH")).toHaveLength(2);
    expect(state.journals.get(state.owner)?.settings.default_broker).toBe(journalDefaultsCanary.default_broker);
  });

  test(`${path} holds template writes across hot switches and keeps an independent defaults edit`, async ({ page }) => {
    const state = await installJournalSettingsFixture(page);
    await gotoStable(page, path, { waitForNetworkIdle: false });
    await template(page).fill(noteTemplateCanary);
    let release!: () => void;
    state.templateGate = new Promise<void>((resolve) => { release = resolve; });
    await saveTemplate(page).click();
    await expect.poll(() => state.writes.length).toBe(1);
    await expect(saveTemplate(page)).toBeDisabled();
    await expect(template(page)).toBeEnabled();
    await template(page).fill(initialNoteTemplate);
    await expect(currency(page)).toBeEnabled();
    await broker(page).fill("Independent pending edit");
    await switchRenderer(page, state, path, false, true);
    await expect(template(page)).toBeEnabled();
    await expect(template(page)).toHaveValue(initialNoteTemplate);
    await expect(saveTemplate(page)).toBeDisabled();
    await expect(page.getByText("All explicit changes applied", { exact: true })).toHaveCount(0);
    await expect(broker(page)).toHaveValue("Independent pending edit");
    expect(state.templates.get(state.owner)).toBe(initialNoteTemplate);
    expect(await effectiveTemplate(page)).toBe(initialNoteTemplate);
    release();
    await expect(savedStatus(page, "Note template saved")).toBeVisible();
    await expect(template(page)).toHaveValue(initialNoteTemplate);
    await expect(saveTemplate(page)).toBeEnabled();
    await template(page).fill("Later unsaved template\n");
    await switchRenderer(page, state, path, true, true);
    await expect(template(page)).toHaveValue("Later unsaved template\n");
    await expect(broker(page)).toHaveValue("Independent pending edit");
    await expect(saveTemplate(page)).toBeEnabled();
    expect(state.writes).toHaveLength(1);
  });
}

test("journal settings drafts stay owner scoped across route aliases and hash focus changes", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Owner boundary and alias navigation covered once");
  await installDeterminism(page, { rollout: "fallback" });
  const state = await installJournalSettingsFixture(page, { setup: false });
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: {
    ...betaSessionResponse, token: `settings-owner-${state.owner}`, user: { ...betaSessionResponse.user, id: state.owner },
  } }));
  await gotoStable(page, "/", { waitForNetworkIdle: false });
  async function owner(id: number) {
    state.owner = id;
    await page.evaluate(async (session) => {
      const modulePath = "/src/lib/authSession.ts";
      const { setStoredAuthSession } = await import(modulePath);
      setStoredAuthSession(session);
    }, { createdAt: betaSessionResponse.created_at, expiresAt: betaSessionResponse.expires_at, token: `settings-owner-${id}`,
      user: { approved: true, betaPosition: null, email: betaSessionResponse.user.email, id, isBetaUser: true, name: betaSessionResponse.user.name, plan: "beta", provider: "google" } });
  }
  await owner(betaSessionResponse.user.id);
  await gotoStable(page, paths[0], { waitForNetworkIdle: false });
  await broker(page).fill("Owner one draft");
  await template(page).fill("Owner one template\n");
  await gotoStable(page, `${paths[1]}#settings/journal/note-template`, { waitForNetworkIdle: false });
  await expect(broker(page)).toHaveValue("Owner one draft");
  await expect(template(page)).toHaveValue("Owner one template\n");
  await expect(page).toHaveURL(/#settings\/journal\/note-template$/);
  await expect(template(page)).toBeFocused();
  await page.evaluate(() => { location.hash = "#settings/journal/journal-defaults"; });
  await expect(page.locator("#setting-journal-defaults").getByRole("button", { name: "Reset defaults", exact: true })).toBeFocused();
  await owner(betaSessionResponse.user.id + 1);
  await expect(broker(page)).not.toHaveValue("Owner one draft");
  await expect(template(page)).not.toHaveValue("Owner one template\n");
  await broker(page).fill("Owner two draft");
  await template(page).fill("Owner two template\n");
  await owner(betaSessionResponse.user.id);
  await expect(broker(page)).toHaveValue("Owner one draft");
  await expect(template(page)).toHaveValue("Owner one template\n");
  await owner(betaSessionResponse.user.id + 1);
  await expect(broker(page)).toHaveValue("Owner two draft");
  await expect(template(page)).toHaveValue("Owner two template\n");
  expect(state.writes).toEqual([]);
  await switchRenderer(page, state, paths[1], false, true);
  await page.evaluate(() => { location.hash = "#settings/journal/note-template"; });
  await expect(page.locator("#setting-note-template")).toBeFocused();

  // A completion captured for another owner must not clear the current owner's
  // draft, and returning to that owner must not leave a permanent pending lock.
  await owner(betaSessionResponse.user.id);
  let release!: () => void;
  state.defaultsGate = new Promise<void>((resolve) => { release = resolve; });
  await apply(page).click();
  await expect.poll(() => state.writes.length).toBe(1);
  await owner(betaSessionResponse.user.id + 1);
  await expect(broker(page)).toHaveValue("Owner two draft");
  await expect(apply(page)).toBeEnabled();
  release();
  await expect.poll(() => state.journals.get(betaSessionResponse.user.id)?.settings.default_broker).toBe("Owner one draft");
  await expect(broker(page)).toHaveValue("Owner two draft");
  await expect(template(page)).toHaveValue("Owner two template\n");
  await owner(betaSessionResponse.user.id);
  await expect(broker(page)).toHaveValue("Owner one draft");
  await expect(template(page)).toHaveValue("Owner one template\n");
  await expect(currency(page)).toBeEnabled();
  await expect(apply(page)).toBeDisabled();
  expect(state.writes).toHaveLength(1);
});
