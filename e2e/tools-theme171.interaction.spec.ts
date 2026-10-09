import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { liveViewportSetup } from "./chart-viewport151.support";

const baseline = process.env.EDGELAB_TOOLS_THEME171_BASELINE === "1";
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const seal = () => hash(fs.readdirSync("frontend/dist", { recursive: true }).map(String).filter(file => fs.statSync(path.join("frontend/dist", file)).isFile()).sort().map(file => file + ":" + hash(fs.readFileSync(path.join("frontend/dist", file)))).join("\n"));
const beforeSeal = seal(), errors = new WeakMap<Page, string[]>();
const hashes = () => Object.fromEntries(["e2e/tools-theme171.config.ts", "e2e/tools-theme171.interaction.spec.ts"].map(file => [file, hash(fs.readFileSync(file))]));
const beforeHashes = hashes();
const palettes = {
  light: { "--ui-surface": "#f2e8dc", "--ui-floating": "#f8f1e7", "--ui-inset": "#e0d5c5", "--ui-raised": "#d4c7b5", "--ui-hover": "#c1b39e", "--ui-selection": "#b6cce0", "--ui-border-subtle": "#887766", "--ui-border-strong": "#665544", "--ui-focus": "#704099", "--text-primary": "#18293a", "--text-secondary": "#405162", "--text-muted": "#526374", "--text-accent": "#493060", "--interaction": "#0b6072", "--interaction-hover": "#084f60", "--interaction-pressed": "#063e4a", "--on-interaction": "#ffffff", "--warning-text": "#704510", "--profit-text": "#175b37", "--loss-text": "#8c2034", "--profit-soft": "#d0e7d6", "--loss-soft": "#f4d7dc" },
  dark: { "--ui-surface": "#192532", "--ui-floating": "#223243", "--ui-inset": "#101922", "--ui-raised": "#283b4e", "--ui-hover": "#344b62", "--ui-selection": "#334c65", "--ui-border-subtle": "#718294", "--ui-border-strong": "#8e9faf", "--ui-focus": "#9cdcff", "--text-primary": "#edf4fa", "--text-secondary": "#ccd9e5", "--text-muted": "#a9bbcd", "--text-accent": "#a7dfff", "--interaction": "#9cdcff", "--interaction-hover": "#c2eaff", "--interaction-pressed": "#7fc7eb", "--on-interaction": "#101922", "--warning-text": "#ffcf88", "--profit-text": "#a0edbe", "--loss-text": "#ffb0c1", "--profit-soft": "#183e2a", "--loss-soft": "#492a34" },
};
type Palette = typeof palettes.light;
const rgb = (hex: string) => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
test.beforeEach(({ page }) => { errors.set(page, []); page.on("pageerror", error => errors.get(page)!.push(error.message)); });
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); expect(seal()).toBe(beforeSeal); expect(hashes()).toEqual(beforeHashes); });

async function geometry(target: Locator, ensureVisible = true) {
  if (ensureVisible) await target.scrollIntoViewIfNeeded();
  return target.evaluate((node: HTMLElement) => {
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    let background = style.backgroundColor;
    for (let parent = node.parentElement; /^rgba\(.+, 0\)$/.test(background) && parent; parent = parent.parentElement) background = getComputedStyle(parent).backgroundColor;
    return { background: style.backgroundColor, effectiveBackground: background, color: style.color, border: style.borderTopColor, shadow: style.boxShadow,
      x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height,
      viewport: { width: innerWidth, height: innerHeight }, reachable: hit === node || !!hit && node.contains(hit) };
  });
}
function contrast(color: string, background: string) {
  const luminance = (css: string) => {
    const components = css.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => { const x = value / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; });
    return .2126 * components[0] + .7152 * components[1] + .0722 * components[2];
  };
  const a = luminance(color), b = luminance(background); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
function readable(style: Awaited<ReturnType<typeof geometry>>) { expect(contrast(style.color, style.effectiveBackground)).toBeGreaterThanOrEqual(4.5); }
function contained(style: Awaited<ReturnType<typeof geometry>>) {
  expect(style.x).toBeGreaterThanOrEqual(-.01); expect(style.right).toBeLessThanOrEqual(style.viewport.width + .01);
  expect(style.y).toBeGreaterThanOrEqual(-.01); expect(style.bottom).toBeLessThanOrEqual(style.viewport.height + .01); expect(style.reachable, JSON.stringify(style)).toBe(true);
}
async function capture(page: Page, info: TestInfo, theme: string, name: string, evidence: unknown) {
  const folder = path.resolve(".artifacts/tools-theme171", baseline ? "baseline" : "final", info.project.name, theme); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `${name}.json`), JSON.stringify({ scope: "Actual production chart, Tools tabs and portal controls under explicit inherited semantic palettes. No verified app-wide theme chooser exists; this proves token inheritance, not preference persistence. HTTP/auth/storage/provider seams only.", beforeSeal, afterSeal: seal(), beforeHashes, afterHashes: hashes(), errors: errors.get(page), evidence }, null, 2));
  await page.screenshot({ path: path.join(folder, `${name}.png`) });
}
async function openMenu(control: Locator, page: Page, label: string, palette: Palette, touch: boolean) {
  await control.evaluate(node => node.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
  await control.page().evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await control.focus(); await control.press("ArrowDown");
  const menu = page.getByRole("listbox", { name: label, exact: true }); await expect(menu).toBeVisible();
  await control.page().evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const styles = { control: await geometry(control, false), menu: await geometry(menu, false), active: await geometry(page.locator(`[id=${JSON.stringify(await control.getAttribute("aria-activedescendant"))}]`), false) };
  expect(styles.control.color).toBe(rgb(palette["--text-primary"])); expect(styles.control.border).toBe(rgb(palette["--ui-focus"])); readable(styles.control); contained(styles.control);
  expect(styles.menu.background).toBe(rgb(palette["--ui-floating"])); expect(styles.menu.color).toBe(rgb(palette["--text-primary"])); readable(styles.menu); contained(styles.menu);
  expect(styles.active.background).toBe(rgb(palette["--ui-selection"])); expect(styles.active.color).toBe(rgb(palette["--text-primary"])); readable(styles.active);
  if (touch) expect(styles.control.height).toBeGreaterThanOrEqual(44);
  return { menu, styles };
}
async function choose(control: Locator, page: Page, label: string, option: string, palette: Palette, touch: boolean) {
  const { menu, styles } = await openMenu(control, page, label, palette, touch);
  await menu.getByRole("option", { name: option, exact: true }).click(); await expect(menu).toBeHidden(); await expect(control).toBeFocused(); return styles;
}
async function chartGeometry(page: Page) {
  return page.evaluate(async () => {
    const stage = document.querySelector<HTMLElement>(".chart-stage")!, key = Object.keys(stage).find(key => key.startsWith("__reactFiber$"));
    let chart: any, series: any;
    for (let fiber = key ? (stage as any)[key] : null, depth = 0; fiber && depth < 64; fiber = fiber.return, depth++) {
      for (let hook = fiber.memoizedState, count = 0; hook && count < 384; hook = hook.next, count++) {
        const ref = hook.memoizedState?.current;
        if (typeof ref?.timeScale === "function" && typeof ref?.addCandlestickSeries === "function") chart ??= ref;
        if (typeof ref?.seriesType === "function" && ref.seriesType() === "Candlestick") series ??= ref;
      }
    }
    if (!chart || !series) throw Error("Actual live chart geometry unavailable");
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return { width: chart.paneSize().width, height: stage.getBoundingClientRect().height, range: chart.timeScale().getVisibleLogicalRange(), count: series.data().length };
  });
}
async function stableChartGeometry(page: Page) {
  let previous = "", since = 0;
  await expect.poll(async () => {
    const current = await chartGeometry(page), serialized = JSON.stringify(current);
    if (current.count !== 600 || serialized !== previous) { previous = serialized; since = Date.now(); return false; }
    return Date.now() - since >= 200;
  }, { intervals: [50] }).toBe(true);
  return chartGeometry(page);
}

for (const [theme, palette] of Object.entries(palettes)) test(`${theme} Tools panels inherit semantic palettes and preserve real market/journal controls`, async ({ page }, info) => {
  test.skip(baseline && theme !== "light");
  const fixture = await liveViewportSetup(page), depthRequests: any[] = [], created: any[] = [], rules: any[] = [];
  const now = new Date().toISOString();
  const accounts = [81, 82].map((id, index) => ({ id, broker_account_id: null, source_type: "MANUAL", source_key: `theme171-${id}`, name: index ? "Research account" : "Primary Futures — Frankfurt Desk", provider: "EdgeLab", currency: "USD", timezone: "UTC", initial_balance: "25000", color: index ? "#4f46e5" : "#0891b2", notes: null, status: "ACTIVE", created_at: now, updated_at: now }));
  await page.route(/\/api\/(market-data\/(instruments|alerts|alert-events)|journal\/accounts)(?:[/?]|$)/, async route => {
    const request = route.request(), url = new URL(request.url()), endpoint = url.pathname.replace(/^\/api/, "");
    expect(request.headers().authorization).toMatch(/^Bearer .+/);
    if (endpoint === "/journal/accounts") return route.fulfill({ json: accounts });
    if (endpoint === "/market-data/instruments") return route.fulfill({ json: [{ id: 1, canonical_symbol: "BTCUSDT", display_name: "Bitcoin", asset_class: "crypto", instrument_type: "SPOT", exchange: "BINANCE", currency: "USD", timezone: "UTC", tick_size: ".01", active: true, identifiers: [{ provider: "BINANCE", provider_symbol: "BTCUSDT" }] }] });
    if (endpoint === "/market-data/instruments/1/order-book") {
      depthRequests.push(Object.fromEntries(url.searchParams)); return route.fulfill({ json: { instrument_id: 1, contract_id: null, provider: "BINANCE", sequence: 171, captured_at: now, status: "AVAILABLE", aggregation_tick_size: String(Number(url.searchParams.get("aggregation_ticks")) * .01), message: null,
        levels: [{ side: "ASK", price: "67521", size: "3", order_count: 4 }, { side: "BID", price: "67520", size: "2", order_count: 3 }] } });
    }
    if (endpoint === "/market-data/alert-events") return route.fulfill({ json: [] });
    if (endpoint === "/market-data/alerts") {
      if (request.method() === "POST") {
        const body = request.postDataJSON(); created.push(body);
        const rule = { id: 171, ...body, condition: { threshold: body.threshold }, enabled: true, last_value: null, last_evaluated_at: null, last_triggered_at: null, created_at: now, updated_at: now }; rules.push(rule); return route.fulfill({ json: rule });
      }
      return route.fulfill({ json: rules });
    }
    return route.fallback();
  });
  // Reload only to let the real Journal owner consume the two-account HTTP
  // fixture before first render; retain genuine session and chart initialization.
  await page.reload(); await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
  await page.evaluate(values => { for (const [key, value] of Object.entries(values)) document.body.style.setProperty(key, value); }, palette);
  const trigger = page.locator('[data-motion="workspace-panel-trigger"]'), pane = page.getByRole("complementary", { name: "Chart tools", exact: true });
  if (info.project.name === "desktop") {
    const before = await stableChartGeometry(page);
    await trigger.hover(); await expect(pane).toHaveAttribute("data-hover-preview", "true");
    await capture(page, info, theme, "hover-preview", { palette });
    if (!baseline) {
      await pane.getByRole("tab", { name: "Order book", exact: true }).click();
      const aggregate = pane.getByRole("combobox", { name: "Aggregate ticks", exact: true });
      const { menu, styles } = await openMenu(aggregate, page, "Aggregate ticks", palette, false);
      const menuId = await aggregate.getAttribute("aria-controls");
      expect(await pane.evaluate((node, id) => !node.contains(document.getElementById(id!)), menuId)).toBe(true);
      const five = menu.getByRole("option", { name: "5 ticks", exact: true }), box = await five.boundingBox();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2, { steps: 12 });
      await expect(pane).toHaveAttribute("data-hover-preview", "true"); await expect(aggregate).toBeFocused();
      await five.click(); await expect(menu).toBeHidden(); await expect(aggregate).toBeFocused();
      await expect(pane).toHaveAttribute("data-hover-preview", "true");
      await expect.poll(() => depthRequests.some(request => request.aggregation_ticks === "5")).toBe(true);
      const after = await chartGeometry(page);
      expect(after.width).toBe(before.width); expect(after.height).toBe(before.height); expect(after.count).toBe(before.count);
      expect(after.range.from).toBeCloseTo(before.range.from, 7); expect(after.range.to).toBeCloseTo(before.range.to, 7);
      await capture(page, info, theme, "hover-portal-continuity", { before, after, styles, menuOutsidePane: true, depthRequests });
      await pane.getByRole("tab", { name: "Journal", exact: true }).click();
    }
  }
  await trigger.click(); await expect(pane).toBeVisible(); await expect(trigger).toHaveCount(0);
  const journal = pane.getByRole("tabpanel", { name: "Journal", exact: true }), journalHeading = journal.getByRole("heading", { name: "Journal beside chart", exact: true });
  await expect(journalHeading).toBeVisible();
  const journalStyles = await geometry(journalHeading); await capture(page, info, theme, "journal", { journalStyles });
  if (!baseline) { expect(journalStyles.color).toBe(rgb(palette["--text-primary"])); readable(journalStyles); }
  const touch = info.project.name === "mobile", menus: any[] = [];
  if (!baseline) {
    const scope = journal.getByRole("combobox", { name: "Account scope", exact: true });
    menus.push({ scope: await choose(scope, page, "Account scope", "Selected accounts…", palette, touch) });
    await expect.poll(() => fixture.storage.get("journal-account-scope.v1")).toEqual({ mode: "selected", accountIds: [81, 82] });
    const research = journal.getByRole("checkbox", { name: "Research account", exact: true }); await expect(research).toBeChecked();
    const badge = research.locator(".."); const badgeStyles = await geometry(badge); readable(badgeStyles); expect(badgeStyles.color).toBe(rgb(palette["--text-accent"]));
    if (touch) expect(badgeStyles.height).toBeGreaterThanOrEqual(44);
    await capture(page, info, theme, "journal-selected-accounts", { menus, badgeStyles });
    await research.click(); await expect.poll(() => fixture.storage.get("journal-account-scope.v1")).toEqual({ mode: "selected", accountIds: [81] });
    await expect(scope).toContainText("Primary Futures — Frankfurt Desk");
  }
  await pane.getByRole("tab", { name: "Order book", exact: true }).click();
  const order = pane.getByRole("tabpanel", { name: "Order book", exact: true }), orderSection = order.locator('section[aria-labelledby="order-book-panel-title"]');
  await expect(order.getByText("Spread", { exact: true })).toBeVisible();
  const orderStyles = { section: await geometry(orderSection), heading: await geometry(order.getByRole("heading", { name: "Order Book · BTCUSDT", exact: true })) };
  await capture(page, info, theme, "order-book", orderStyles);
  if (!baseline) {
    expect(orderStyles.section.background).toBe(rgb(palette["--ui-surface"])); expect(orderStyles.heading.color).toBe(rgb(palette["--text-primary"])); readable(orderStyles.heading);
    menus.push({ aggregation: await choose(order.getByRole("combobox", { name: "Aggregate ticks", exact: true }), page, "Aggregate ticks", "5 ticks", palette, touch) });
    menus.push({ depth: await choose(order.getByRole("combobox", { name: "Depth", exact: true }), page, "Depth", "50 levels", palette, touch) });
    await expect.poll(() => depthRequests.some(request => request.aggregation_ticks === "5" && request.depth === "50")).toBe(true);
    const refresh = await geometry(order.getByRole("button", { name: "Refresh order book", exact: true })); if (touch) { expect(refresh.height).toBeGreaterThanOrEqual(44); expect(refresh.width).toBeGreaterThanOrEqual(44); }
    await capture(page, info, theme, "order-book-controls", { menus, depthRequests, refresh });
  }
  await pane.getByRole("tab", { name: "Alerts", exact: true }).click();
  const alerts = pane.getByRole("tabpanel", { name: "Alerts", exact: true }), alertSection = alerts.locator('section[aria-labelledby="alerts-panel-title"]');
  await expect(alerts.getByRole("button", { name: "Create alert", exact: true })).toBeEnabled();
  const alertStyles = { section: await geometry(alertSection), heading: await geometry(alerts.getByRole("heading", { name: "Alerts · BTCUSDT", exact: true })) };
  await capture(page, info, theme, "alerts", alertStyles);
  if (baseline) {
    // Preserve three concrete failures against the same final semantic oracle.
    expect.soft(journalStyles.color, "Journal heading must inherit primary text").toBe(rgb(palette["--text-primary"]));
    expect.soft(orderStyles.section.background, "Order Book must inherit surface").toBe(rgb(palette["--ui-surface"]));
    expect.soft(alertStyles.section.background, "Alerts must inherit surface").toBe(rgb(palette["--ui-surface"]));
    return;
  }
  expect(alertStyles.section.background).toBe(rgb(palette["--ui-surface"])); expect(alertStyles.heading.color).toBe(rgb(palette["--text-primary"])); readable(alertStyles.heading);
  const condition = alerts.getByRole("combobox", { name: "Condition", exact: true });
  const menu = await openMenu(condition, page, "Condition", palette, touch); menus.push({ condition: menu.styles });
  await condition.press("Escape"); await expect(menu.menu).toBeHidden(); await expect(condition).toBeFocused(); await expect(pane).toBeVisible();
  await openMenu(condition, page, "Condition", palette, touch); await condition.press("Home"); await condition.press("ArrowDown"); await condition.press("Enter");
  await expect(condition).toContainText("Price below");
  const alertName = `Theme171 ${theme} ${info.project.name}`;
  await alerts.getByRole("textbox", { name: "Alert name", exact: true }).fill(alertName);
  await alerts.getByRole("textbox", { name: "Threshold", exact: true }).fill("67600");
  await alerts.getByRole("textbox", { name: "Cooldown · seconds", exact: true }).fill("30");
  const create = alerts.getByRole("button", { name: "Create alert", exact: true });
  await create.focus(); const createStyles = await geometry(create); readable(createStyles); expect(createStyles.background).toBe(rgb(palette["--interaction"])); expect(createStyles.color).toBe(rgb(palette["--on-interaction"]));
  if (touch) expect(createStyles.height).toBeGreaterThanOrEqual(44);
  await create.click(); await expect.poll(() => created).toEqual([{ instrument_id: 1, name: alertName, alert_type: "PRICE_BELOW", threshold: 67600, cooldown_seconds: 30 }]);
  await expect(alerts.getByText(alertName, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors.get(page)).toEqual([]);
  await capture(page, info, theme, "alerts-created", { menus, created, createStyles, depthRequests, scope: fixture.storage.get("journal-account-scope.v1") });
});
