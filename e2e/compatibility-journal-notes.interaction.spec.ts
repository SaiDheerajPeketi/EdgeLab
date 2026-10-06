import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { betaSessionResponse, certifyUiState, gotoStable, installDeterminism } from "./support/app";
import { installJournalFixture, noteCanary, noteDate, seedAccount, seedNotes, seedTrade, tradeId } from "./support/compatibility-journal";

test.use({ video: "off" });
type JournalState = Awaited<ReturnType<typeof installJournalFixture>>;
const editor = (page: Page) => page.getByRole("textbox", { name: "Daily note", exact: true });
const dateControl = (page: Page) => page.getByLabel("Date", { exact: true });
const scopeControl = (page: Page) => page.getByRole("combobox", { name: "Note scope", exact: true });
const save = (page: Page) => page.getByRole("button", { name: /^(Save note|Retry save|Saving…)$/ });
const notePath = (surface: "notes" | "calendar", date = noteDate, account: number | null = seedAccount.id) =>
  `/app/journal/${surface}#journal/${surface}?date=${date}${account == null ? "" : `&account=${account}`}`;
const saved = (state: JournalState, date = noteDate, account: number | null = seedAccount.id) =>
  state.notes.find((note) => note.note_date === date && note.account_id === account);
const noteWrite = (body = noteCanary, date = noteDate, account: number | null = seedAccount.id) => ({
  method: "PUT", path: `/api/journal/daily-notes/${date}`, body: { account_id: account, body },
});
async function switchRenderer(page: Page, state: JournalState, fallback: boolean) {
  state.fallback = fallback;
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-route-group="journal"]')).toHaveAttribute("data-ui-version", fallback ? "fallback" : "v2");
}
async function expectContext(page: Page, surface: string, date = noteDate, account: number | null = seedAccount.id, trade: number | null = null) {
  const url = new URL(page.url());
  expect(url.pathname).toBe(`/app/journal/${surface}`);
  expect(url.hash.split("?")[0]).toBe(`#journal/${surface}`);
  const query = new URLSearchParams(url.hash.split("?")[1]);
  expect(query.get("date")).toBe(date);
  expect(query.get("account")).toBe(account == null ? null : String(account));
  expect(query.get("trade")).toBe(trade == null ? null : String(trade));
}
async function sameTabHash(page: Page, surface: "notes" | "calendar", date: string, account: number | null) {
  await page.evaluate((hash) => { location.hash = hash; }, notePath(surface, date, account).split("#")[1].replace(/^/, "#"));
  await expect(dateControl(page)).toHaveValue(date);
  await expect(scopeControl(page)).toHaveValue(account == null ? "all" : String(account));
}
async function acknowledgeSave(page: Page) {
  await expect(editor(page)).toBeEnabled();
  await expect(save(page)).toBeDisabled();
}
async function capture(page: Page, surface: string, version: string, testInfo: TestInfo, variant?: string) {
  const project = testInfo.project.name;
  if (process.env.EDGELAB_NOTES_CAPTURE !== "1" || !["desktop", "mobile"].includes(project)) return;
  const only = process.env.EDGELAB_NOTES_CAPTURE_ONLY;
  if (only && !only.split(",").includes(`${surface}-${variant ?? version}-${project}`)) return;
  await page.evaluate(({ surface, version }) => {
    window.scrollTo(0, 0);
    const workspace = document.querySelector<HTMLElement>("#workspace-content");
    if (version !== "modern" || !workspace) return;
    workspace.scrollTop = 0;
    if (surface === "notes") {
      const section = document.querySelector('[aria-label="Daily note"]')?.closest("section");
      if (section) {
        if (workspace.scrollHeight > workspace.clientHeight + 1) workspace.scrollTop += section.getBoundingClientRect().top - workspace.getBoundingClientRect().top - 16;
        else window.scrollTo(0, Math.max(0, section.getBoundingClientRect().top + window.scrollY - 16));
      }
    }
  }, { surface, version });
  if (version === "modern" && surface === "calendar") {
    await expect(page.getByRole("heading", { name: "Day review", exact: true }).last()).toBeInViewport();
    await expect(page.getByRole("button", { name: "Previous month", exact: true })).toBeInViewport();
    await expect(page.getByRole("button", { name: noteDate, exact: true })).toBeInViewport();
  }
  if (version === "modern" && surface === "notes") {
    await expect(dateControl(page)).toBeInViewport();
    await expect(editor(page)).toBeInViewport();
    await expect(save(page)).toBeInViewport();
  }
  const path = `.impeccable/review/compatibility-journal-${surface}-${variant ?? version}-${project}.png`;
  const pixels = await page.screenshot({ animations: "disabled", fullPage: version === "fallback", path });
  const state = await page.evaluate(() => {
    const workspace = document.querySelector<HTMLElement>("#workspace-content");
    const bounds = (element: Element | null) => element ? {
      top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom,
      left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
    } : null;
    return {
      url: location.href, viewport: { width: innerWidth, height: innerHeight }, windowScrollY: scrollY,
      documentHeight: document.documentElement.scrollHeight,
      workspace: workspace ? { clientHeight: workspace.clientHeight, scrollHeight: workspace.scrollHeight, scrollTop: workspace.scrollTop, bounds: bounds(workspace) } : null,
      editor: bounds(document.querySelector('[aria-label="Daily note"]') ?? document.querySelector("textarea")),
      body: document.querySelector<HTMLTextAreaElement>('[aria-label="Daily note"], textarea')?.value ?? null,
    };
  });
  await testInfo.attach("daily-note-review-capture", {
    contentType: "application/json",
    body: Buffer.from(JSON.stringify({ path, dimensions: { width: pixels.readUInt32BE(16), height: pixels.readUInt32BE(20) }, surface, version, variant, project, ...state })),
  });
}

for (const surface of ["notes", "calendar"] as const) {
  test(`${surface} persists an exact scoped PUT through fallback-modern-fallback and shows working controls`, async ({ page }, testInfo) => {
    const state = await installJournalFixture(page);
    await gotoStable(page, notePath(surface), { waitForNetworkIdle: false });
    await expect(editor(page)).toHaveValue(seedNotes[1].body);
    await expect(dateControl(page)).toHaveValue(noteDate);
    await expect(scopeControl(page)).toHaveValue(String(seedAccount.id));
    await editor(page).fill(noteCanary);
    await save(page).click();
    await acknowledgeSave(page);
    expect(state.noteWrites).toEqual([noteWrite()]);
    expect(saved(state)?.body).toBe(noteCanary);
    await certifyUiState(page);
    await capture(page, surface, "fallback", testInfo);
    await switchRenderer(page, state, false);
    await expect(page.getByRole("heading", { name: surface === "notes" ? "Daily notes" : "Day review", exact: true }).last()).toBeVisible();
    await expect(editor(page)).toHaveValue(noteCanary);
    await expect(dateControl(page)).toHaveValue(noteDate);
    await expect(scopeControl(page)).toHaveValue(String(seedAccount.id));
    await certifyUiState(page);
    await capture(page, surface, "modern", testInfo);
    await switchRenderer(page, state, true);
    await expect(editor(page)).toHaveValue(noteCanary);
    await expect(save(page)).toBeDisabled();
    await expectContext(page, surface);
  });

  test(`${surface} preserves failed drafts across reload and locks a hot fallback until late canonical acknowledgement`, async ({ page }) => {
    const state = await installJournalFixture(page);
    state.failNote = true;
    await gotoStable(page, notePath(surface), { waitForNetworkIdle: false });
    await editor(page).fill(noteCanary);
    await save(page).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(editor(page)).toHaveValue(noteCanary);
    expect(saved(state)?.body).toBe(seedNotes[1].body);
    state.failNote = false;
    await switchRenderer(page, state, false);
    await expect(editor(page)).toHaveValue(noteCanary);
    let release!: () => void;
    state.noteGate = new Promise<void>((resolve) => { release = resolve; });
    await save(page).click();
    await expect.poll(() => state.noteWrites.length).toBe(2);
    const url = page.url();
    state.fallback = true;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.locator('[data-route-group="journal"]')).toHaveAttribute("data-ui-version", "fallback");
    await expect(editor(page)).toHaveValue(noteCanary);
    await expect(editor(page)).toBeDisabled();
    await expect(save(page)).toBeDisabled();
    expect(state.noteWrites).toHaveLength(2);
    release();
    await acknowledgeSave(page);
    expect(state.noteWrites).toEqual([noteWrite(), noteWrite()]);
    expect(saved(state)?.body).toBe(noteCanary);
    await expect(page).toHaveURL(url);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(editor(page)).toHaveValue(noteCanary);
    await expect(save(page)).toBeDisabled();
  });

  test(`${surface} loads the whole UTC day beyond500 trades with separate currency amounts`, async ({ page }) => {
    const state = await installJournalFixture(page);
    state.accounts.push({ ...seedAccount, id: seedAccount.id + 1, name: "Euro account", currency: "EUR" });
    state.tradePage = Array.from({ length: 519 }, (_, index) => ({
      ...structuredClone(seedTrade), id: 100_000 + index, symbol: `DAY${index}`,
      account_id: index % 2 ? seedAccount.id + 1 : seedAccount.id, currency: index % 2 ? "EUR" : "USD",
    }));
    state.tradePage.push(
      { ...structuredClone(seedTrade), id: 100_519, symbol: "UTCIN", entry_time: "2026-09-14T23:30:00-01:00" },
      { ...structuredClone(seedTrade), id: 100_520, symbol: "UTCEND", currency: "EUR", account_id: seedAccount.id + 1, entry_time: "2026-09-15T23:59:59.999Z" },
      { ...structuredClone(seedTrade), id: 100_521, symbol: "OFFBEFORE", entry_time: "2026-09-15T00:30:00+02:00" },
      { ...structuredClone(seedTrade), id: 100_522, symbol: "OFFAFTER", entry_time: "2026-09-15T23:30:00-02:00" },
    );
    await gotoStable(page, notePath(surface, noteDate, null), { waitForNetworkIdle: false });
    async function checkDayPages() {
      const actions = page.getByRole("button", { name: /^Open .* trade/ });
      const pages = page.getByRole("navigation", { name: "Day trade pages", exact: true });
      await expect(actions).toHaveCount(100);
      await expect(pages).toContainText("521 trades");
      let total = 0;
      for (let index = 0; index < 6; index++) {
        await expect(pages).toContainText(`Page ${index + 1} of 6`);
        await expect(actions).toHaveCount(index === 5 ? 21 : 100);
        total += await actions.count();
        if (index === 0) await expect(page.getByRole("button", { name: /^Open UTCEND trade/ })).toContainText(/€195/);
        await expect(page.getByRole("button", { name: /^Open OFF(BEFORE|AFTER) trade/ })).toHaveCount(0);
        expect(await page.locator("body").innerText()).not.toMatch(/[€$]\s?101,595(?:\.00)?/);
        if (index < 5) await pages.getByRole("button", { name: "Next day trades", exact: true }).click();
      }
      expect(total).toBe(521);
      await expect(page.getByRole("button", { name: /^Open UTCIN trade/ })).toContainText(/\$195/);
      await expect(pages.getByRole("button", { name: "Next day trades", exact: true })).toBeDisabled();
      await pages.getByRole("button", { name: "Previous day trades", exact: true }).click();
      await expect(pages).toContainText("Page 5 of 6");
      await expect(actions).toHaveCount(100);
    }
    await checkDayPages();
    expect(state.tradeReads.filter(({ start, end }) => start === noteDate && end === noteDate)).toEqual(expect.arrayContaining(
      [0, 200, 400].map((offset) => ({ start: noteDate, end: noteDate, account: null, offset, limit: 200 })),
    ));
    await switchRenderer(page, state, false);
    await checkDayPages();
  });

  test(`${surface} opens and closes its linked trade without losing note date, account, route or draft`, async ({ page }) => {
    const state = await installJournalFixture(page);
    await gotoStable(page, notePath(surface), { waitForNetworkIdle: false });
    await editor(page).fill("Unsaved reflection while reviewing its trade");
    await page.getByRole("button", { name: /^Open BTCUSDT trade/ }).click();
    await expectContext(page, surface, noteDate, seedAccount.id, tradeId);
    await expect(page.getByRole("heading", { name: "Review BTCUSDT", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close review", exact: true }).click();
    await expectContext(page, surface);
    await expect(editor(page)).toHaveValue("Unsaved reflection while reviewing its trade");
    await switchRenderer(page, state, false);
    await page.getByRole("button", { name: /^Open BTCUSDT trade/ }).click();
    await expectContext(page, surface, noteDate, seedAccount.id, tradeId);
    await page.getByRole("dialog").getByRole("button", { name: /^Close review and return to / }).click();
    await expectContext(page, surface);
    await expect(editor(page)).toHaveValue("Unsaved reflection while reviewing its trade");
  });
}

test("daily-note drafts stay independent by shared/account scope and date through same-tab hash changes and reloads", async ({ page }) => {
  const state = await installJournalFixture(page);
  await gotoStable(page, notePath("notes", noteDate, null), { waitForNetworkIdle: false });
  await page.getByRole("textbox", { name: "Search notes", exact: true }).fill("no saved note can match this");
  await expect(page.getByText("No saved notes match this search.", { exact: true })).toBeVisible();
  await expect(editor(page)).toHaveValue(seedNotes[0].body);
  await page.getByRole("textbox", { name: "Search notes", exact: true }).fill("");
  await editor(page).fill("Unsaved shared reflection");
  await scopeControl(page).selectOption(String(seedAccount.id));
  await expect(editor(page)).toHaveValue(seedNotes[1].body);
  await editor(page).fill("Unsaved account reflection");
  await dateControl(page).fill("2026-09-16");
  await expect(editor(page)).toHaveValue("");
  await editor(page).fill("Unsaved next-day account reflection");
  await sameTabHash(page, "notes", noteDate, null);
  await expect(editor(page)).toHaveValue("Unsaved shared reflection");
  await sameTabHash(page, "notes", noteDate, seedAccount.id);
  await expect(editor(page)).toHaveValue("Unsaved account reflection");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(editor(page)).toHaveValue("Unsaved account reflection");
  await switchRenderer(page, state, false);
  await expect(editor(page)).toHaveValue("Unsaved account reflection");
  await scopeControl(page).selectOption("all");
  await expect(editor(page)).toHaveValue("Unsaved shared reflection");
  await dateControl(page).fill("2026-09-16");
  await expect(editor(page)).toHaveValue("");
  await scopeControl(page).selectOption(String(seedAccount.id));
  await expect(editor(page)).toHaveValue("Unsaved next-day account reflection");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(editor(page)).toHaveValue("Unsaved next-day account reflection");
  expect(state.noteWrites).toEqual([]);
});

test("a saved note can be replaced by an empty body and by exactly200000 characters", async ({ page }) => {
  const state = await installJournalFixture(page);
  await gotoStable(page, notePath("notes", noteDate, null), { waitForNetworkIdle: false });
  await editor(page).fill("");
  await save(page).click();
  await acknowledgeSave(page);
  expect(state.noteWrites).toEqual([noteWrite("", noteDate, null)]);
  expect(saved(state, noteDate, null)?.body).toBe("");
  const limitBody = "x".repeat(200_000);
  await editor(page).fill(limitBody);
  await save(page).click();
  await acknowledgeSave(page);
  expect(state.noteWrites[1]).toEqual(noteWrite(limitBody, noteDate, null));
  expect(saved(state, noteDate, null)?.body).toBe(limitBody);
  await expect(editor(page)).toHaveAttribute("maxlength", "200000");
});

test("calendar exposes a UTC month and selects real dates without dropping the account context", async ({ page }) => {
  const state = await installJournalFixture(page);
  await gotoStable(page, notePath("calendar"), { waitForNetworkIdle: false });
  await switchRenderer(page, state, false);
  await expect(page.getByRole("heading", { name: "Day review", exact: true }).last()).toBeVisible();
  await expect(page.getByRole("button", { name: "2026-09-15", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Previous month", exact: true }).click();
  await expect(page.getByRole("button", { name: "2026-08-15", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next month", exact: true }).click();
  await page.getByRole("button", { name: "2026-09-16", exact: true }).click();
  await expect(dateControl(page)).toHaveValue("2026-09-16");
  await expect(scopeControl(page)).toHaveValue(String(seedAccount.id));
  await expect(editor(page)).toHaveValue("");
  await expectContext(page, "calendar", "2026-09-16");
});

test("mounted daily-note drafts and canonical bodies stay isolated when the signed-in owner changes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Owner boundary covered once; daily-note behavior covers all viewports");
  await installDeterminism(page, { rollout: "fallback" });
  const state = await installJournalFixture(page, { setup: false });
  let owner = betaSessionResponse.user.id;
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: {
    ...betaSessionResponse, token: `note-owner-${owner}`, user: { ...betaSessionResponse.user, id: owner },
  } }));
  await gotoStable(page, "/", { waitForNetworkIdle: false });
  async function changeOwner(id: number) {
    owner = id;
    state.notePage = id === betaSessionResponse.user.id ? null : [];
    await page.evaluate(async (session) => {
      const modulePath = "/src/lib/authSession.ts";
      const { setStoredAuthSession } = await import(modulePath);
      setStoredAuthSession(session);
    }, {
      createdAt: betaSessionResponse.created_at, expiresAt: betaSessionResponse.expires_at,
      token: `note-owner-${id}`, user: {
        approved: true, betaPosition: null, email: betaSessionResponse.user.email, id,
        isBetaUser: true, name: betaSessionResponse.user.name, plan: "beta", provider: "google",
      },
    });
  }
  await changeOwner(betaSessionResponse.user.id);
  await gotoStable(page, notePath("notes"), { waitForNetworkIdle: false });
  await editor(page).fill("Owner one unsaved note");
  await changeOwner(betaSessionResponse.user.id + 1);
  await expect(editor(page)).toHaveValue("");
  await editor(page).fill("Owner two unsaved note");
  await changeOwner(betaSessionResponse.user.id);
  await expect(editor(page)).toHaveValue("Owner one unsaved note");
  await changeOwner(betaSessionResponse.user.id + 1);
  await expect(editor(page)).toHaveValue("Owner two unsaved note");
  expect(state.noteWrites).toEqual([]);
});


test("saved-note load failure blocks blank overwrite, retains a recovered draft, and retries safely", async ({ page }) => {
  const state = await installJournalFixture(page);
  state.failNoteRead = true;
  await gotoStable(page, notePath("notes"), { waitForNetworkIdle: false });
  await expect(page.getByRole("alert")).toContainText("Daily notes could not be loaded");
  await expect(editor(page)).toHaveCount(0);
  await expect(save(page)).toHaveCount(0);
  expect(state.noteWrites).toEqual([]);
  state.failNoteRead = false;
  await page.getByRole("button", { name: "Retry notes", exact: true }).click();
  await expect(editor(page)).toHaveValue(seedNotes[1].body);
  await expect(editor(page)).toBeEnabled();
  await editor(page).fill("Retained draft after failed saved-data reload");
  state.failNoteRead = true;
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("alert")).toContainText("Daily notes could not be loaded");
  await expect(editor(page)).toHaveCount(0);
  await expect(save(page)).toHaveCount(0);
  expect(state.noteWrites).toEqual([]);
  state.failNoteRead = false;
  await page.getByRole("button", { name: "Retry notes", exact: true }).click();
  await expect(editor(page)).toBeEnabled();
  await expect(editor(page)).toHaveValue("Retained draft after failed saved-data reload");
  await save(page).click();
  await acknowledgeSave(page);
  expect(state.noteWrites).toEqual([noteWrite("Retained draft after failed saved-data reload")]);
});


test("late day pages and stale point reads retain a confirmed review moved to another UTC day", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One mounted cache race is sufficient across viewport-independent state.");
  const state = await installJournalFixture(page);
  state.fallback = false;
  state.tradePage = [structuredClone(seedTrade), ...Array.from({ length: 200 }, (_, index) => ({
    ...structuredClone(seedTrade), id: 110_000 + index, symbol: `OTHER${index}`,
  }))];
  let release!: () => void;
  state.tradeGate = new Promise<void>((resolve) => { release = resolve; });
  state.tradeGateOffset = 200;
  state.tradeGateDate = noteDate;
  await gotoStable(page, `${notePath("notes")}&trade=${tradeId}`, { waitForNetworkIdle: false });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect.poll(() => state.tradeReads.some(({ start, offset }) => start === noteDate && offset === 200)).toBe(true);
  await dialog.getByRole("switch", { name: "Trade reviewed", exact: true }).click();
  await dialog.getByRole("button", { name: "4 star rating", exact: true }).click();
  await dialog.getByLabel("Entry time", { exact: true }).fill("2026-09-16T09:00");
  await dialog.getByLabel("Exit time", { exact: true }).fill("2026-09-16T10:00");
  await dialog.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.reviews).toHaveLength(1);
  expect(state.reviews[0].body).toEqual({
    reviewed: true, rating: 4, entry_time: "2026-09-16T09:00:00.000Z", exit_time: "2026-09-16T10:00:00.000Z",
  });
  state.pointTrade = structuredClone(seedTrade);
  release();
  const pages = page.getByRole("navigation", { name: "Day trade pages", exact: true });
  await expect(pages).toContainText("200 trades");
  await expect(page.getByRole("button", { name: /^Open .* trade/ })).toHaveCount(100);
  await expect(page.getByRole("button", { name: /^Open BTCUSDT trade/ })).toHaveCount(0);
  await pages.getByRole("button", { name: "Next day trades", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Open .* trade/ })).toHaveCount(100);
  await expect(page.getByRole("button", { name: /^Open BTCUSDT trade/ })).toHaveCount(0);
  await dateControl(page).fill("2026-09-16");
  await page.getByRole("button", { name: /^Open BTCUSDT trade/ }).click();
  await expect(dialog.getByRole("switch", { name: "Trade reviewed", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(dialog.getByRole("button", { name: "4 star rating", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByLabel("Entry time", { exact: true })).toHaveValue("2026-09-16T09:00");
  await expectContext(page, "notes", "2026-09-16", seedAccount.id, tradeId);
});


test("an earlier dashboard reflection is recoverable without guessing its account or overwriting saved notes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Upgrade storage behavior is independent of viewport.");
  const state = await installJournalFixture(page);
  state.fallback = false;
  await gotoStable(page, notePath("notes"), { waitForNetworkIdle: false });
  const previous = { __schemaVersion: 1, value: { date: noteDate, body: "  Earlier account-unknown reflection\nRecover this unchanged.  " } };
  await page.evaluate(async (draft) => {
    const modulePath = "/src/lib/navigationState.ts";
    const { updateNavigationState } = await import(modulePath);
    updateNavigationState("journal:dashboard", { draft });
  }, previous);
  await gotoStable(page, "/app/journal/dashboard", { waitForNetworkIdle: false });
  await expect(page.getByRole("heading", { name: "Previous dashboard reflection", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Recovered reflection", exact: true })).toHaveValue(previous.value.body);
  await expect(page.getByRole("textbox", { name: "Recovered reflection", exact: true })).toHaveAttribute("readonly", "");
  await expect(page.getByRole("textbox", { name: "Session reflection", exact: true })).toHaveValue(seedNotes[1].body);
  expect(state.noteWrites).toEqual([]);
  const retained = await page.evaluate(async () => {
    const modulePath = "/src/lib/navigationState.ts";
    const { navigationStateFor } = await import(modulePath);
    return navigationStateFor("journal:dashboard")?.draft;
  });
  expect(retained).toEqual(previous);
});


test("modern invalid calendar dates and unknown accounts explain disabled saves and recover canonical text", async ({ page }, testInfo) => {
  const state = await installJournalFixture(page);
  await gotoStable(page, notePath("notes", "2026-02-30"), { waitForNetworkIdle: false });
  await switchRenderer(page, state, false);
  const invalid = page.getByRole("alert").filter({ hasText: "Choose a valid date and one of your accounts before saving." });
  const noteSection = page.locator('section[aria-labelledby="note-editor-heading"]');
  async function expectBlockedDay() {
    await expect(noteSection.getByText(/win rate/)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Trades on this date", exact: true })).toHaveCount(0);
    await expect(page.getByText("No trades on this date", { exact: true })).toHaveCount(0);
    await expect(page.getByText("The note is still valid as a planning or market-observation entry.", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Mar 2, 2026/ })).toHaveCount(0);
  }
  async function expectRestoredDay() {
    await expect(noteSection.getByText(/1 trade · 100\.0% win rate · 0\.0% reviewed/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Trades on this date", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Open BTCUSDT trade/ })).toBeVisible();
  }
  await expect(invalid).toBeVisible();
  await expect(editor(page)).toBeDisabled();
  await expect(save(page)).toBeDisabled();
  expect(state.noteWrites).toEqual([]);
  await expect(page.getByRole("heading", { name: "Select a valid date.", exact: true })).toBeVisible();
  await expectBlockedDay();
  await capture(page, "notes", "modern", testInfo, "invalid-scope");
  await dateControl(page).fill(noteDate);
  await expect(invalid).toHaveCount(0);
  await expect(editor(page)).toBeEnabled();
  await expect(editor(page)).toHaveValue(seedNotes[1].body);
  await expectRestoredDay();
  await page.evaluate((hash) => { location.hash = hash; }, notePath("notes", noteDate, 999_999).split("#")[1].replace(/^/, "#"));
  await expect(invalid).toBeVisible();
  await expect(editor(page)).toBeDisabled();
  await expect(save(page)).toBeDisabled();
  expect(state.noteWrites).toEqual([]);
  await expectBlockedDay();
  await scopeControl(page).selectOption(String(seedAccount.id));
  await expect(invalid).toHaveCount(0);
  await expect(editor(page)).toBeEnabled();
  await expect(editor(page)).toHaveValue(seedNotes[1].body);
  await expect(save(page)).toBeDisabled();
  await expectRestoredDay();
  await expectContext(page, "notes");
  expect(state.noteWrites).toEqual([]);
});
