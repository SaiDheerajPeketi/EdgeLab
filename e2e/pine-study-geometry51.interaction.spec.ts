import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { test, expect, type Page, type Locator } from "@playwright/test";
import { productSetup, editor, observed } from "./pine-layering.product-support";

const phase = process.env.EDGELAB_GEOMETRY51_PHASE ?? "baseline";
const artifacts = path.resolve(".artifacts/pine-study-geometry51", phase);

async function geometry(page: Page, label: string) {
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate((label) => {
    const key = (node: Element) => node.tagName.toLowerCase() + (node.id ? "#" + node.id : "") + [...node.classList].slice(0, 4).map((name) => "." + name).join("");
    const measure = (node: Element | null) => {
      if (!node) return null;
      const element = node as HTMLElement;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { key: key(element), text: element.textContent?.trim().slice(0, 100), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        width: rect.width, height: rect.height, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, scrollLeft: element.scrollLeft,
        overflowX: style.overflowX, overflowY: style.overflowY, position: style.position, display: style.display };
    };
    const workspace = document.querySelector("#workspace-content");
    const column = document.querySelector(".focus-chart-column");
    const stage = document.querySelector(".chart-stage");
    const toolbar = document.querySelector(".chart-studio-toolbar");
    const replay = document.querySelector(".replay-controller-bar");
    const toolbarOverflowing = toolbar ? [...toolbar.querySelectorAll("*")]
      .filter((node) => !node.closest(".sr-only"))
      .map((node) => {
        const entry = measure(node)!;
        const clippingAncestors = [];
        for (let parent = node.parentElement; parent && parent !== toolbar; parent = parent.parentElement) {
          if (getComputedStyle(parent).overflowX !== "visible") clippingAncestors.push(measure(parent));
        }
        return { ...entry, clippingAncestors };
      })
      .filter((entry) => entry.height > 0 && entry.width > 0 && entry.position !== "fixed"
        && (entry.right > toolbar.getBoundingClientRect().right + 1 || entry.left < toolbar.getBoundingClientRect().left - 1))
      .sort((a, b) => b.right - a.right) : [];
    const ancestors = [];
    for (let element = stage; element; element = element.parentElement) ancestors.push(measure(element));
    const overflowing = column ? [...column.querySelectorAll("*")].map(measure).filter((entry) => entry && entry.height > 0 && entry.width > 0 && entry.position !== "fixed"
      && (entry.right > column.getBoundingClientRect().right + 1 || entry.left < column.getBoundingClientRect().left - 1))
      .sort((a, b) => b!.right - a!.right).slice(0, 35) : [];
    const active = document.activeElement as HTMLElement | null;
    const activeRect = active?.getBoundingClientRect();
    const hit = activeRect && document.elementFromPoint(activeRect.left + activeRect.width / 2, activeRect.top + activeRect.height / 2);
    return { label, viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY, documentScrollLeft: document.documentElement.scrollLeft,
      documentClientWidth: document.documentElement.clientWidth, documentScrollWidth: document.documentElement.scrollWidth },
      workspace: measure(workspace), column: measure(column), stage: measure(stage), header: measure(document.querySelector(".chart-stage-header")),
      toolbar: measure(toolbar), replay: measure(replay), toolbarOverflowing,
      ancestors, children: column ? [...column.children].map(measure) : [], overflowing,
      focus: { ...measure(active), name: active?.getAttribute("aria-label"), ownsCenter: Boolean(active && hit && active.contains(hit)) } };
  }, label);
}

async function action(control: Locator, touch: boolean) {
  if (touch) await control.tap();
  else await control.click();
}

async function record(page: Page, label: string, project: string, observations: any[], screenshot = false) {
  const value = await geometry(page, label);
  observations.push(value);
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(path.join(artifacts, project + "-geometry.json"), JSON.stringify(observations, null, 2));
  if (screenshot) await page.screenshot({ path: path.join(artifacts, project + "-" + label + ".png") });
  return value;
}

test("ordinary native study actions preserve contained workspace geometry and focus", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const touch = Boolean(info.project.use.hasTouch || info.project.use.isMobile);
  const context = await productSetup(page);
  const observations: any[] = [];
  await record(page, "before-study", info.project.name, observations, true);
  const source = '//@version=6\nindicator("Geometry study",overlay=true,behind_chart=false)\nshade=input.color(#ff0000,"Shade")\nplot((open+close)/2,"Mean",color=shade,linewidth=4)';
  const dialog = await editor(page);
  await dialog.getByLabel("New script template", { exact: true }).selectOption("pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(source);
  await dialog.getByRole("button", { name: "Check script", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await record(page, "after-check", info.project.name, observations);
  await dialog.getByRole("button", { name: "Run", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeHidden();
  const initial = await observed(page, source, "#FF0000FF");
  expect(initial.source).toBe(source);
  expect(initial.behindChart).toBe(false);
  await record(page, "after-run", info.project.name, observations);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => context.storage.get("custom-indicator-scripts.v1")?.some((script: any) => script.source === source)).toBe(true);
  const saved = structuredClone(context.storage.get("custom-indicator-scripts.v1").find((script: any) => script.source === source));
  await dialog.getByRole("button", { name: "Add to chart", exact: true }).click();
  await record(page, "after-add", info.project.name, observations);
  await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  await record(page, "after-editor-close", info.project.name, observations, true);
  const row = page.locator(".native-study-chip").filter({ hasText: "Geometry study" }).first();
  const trigger = row.getByRole("button", { name: "Inputs for Geometry study", exact: true });
  await action(trigger, touch);
  await record(page, "inputs-open", info.project.name, observations);
  await row.getByRole("textbox", { name: "Shade", exact: true }).fill("#0000ff");
  expect((await observed(page, source, "#0000ff")).behindChart).toBe(false);
  await record(page, "input-updated", info.project.name, observations, true);
  await action(row.getByRole("button", { name: "Close inputs for Geometry study", exact: true }), touch);
  await expect(trigger).toBeFocused();
  await record(page, "after-input-close", info.project.name, observations, true);
  await page.keyboard.press("Enter");
  const shade = row.getByRole("textbox", { name: "Shade", exact: true });
  for (let index = 0; index < 8 && !await shade.evaluate((element) => document.activeElement === element); index++) {
    await page.keyboard.press("Tab");
    await record(page, "tab-" + index, info.project.name, observations);
  }
  await expect(shade).toBeFocused();
  await record(page, "tab-input-focused", info.project.name, observations, true);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await record(page, "after-escape", info.project.name, observations, true);
  await action(page.getByRole("button", { name: "Objects", exact: true }).first(), touch);
  const object = page.locator(".indicator-object-row").filter({ hasText: saved.name }).first();
  await action(object.getByRole("button", { name: /^On: Hide / }), touch);
  await record(page, "after-hide", info.project.name, observations);
  await action(object.getByRole("button", { name: /^Off: Show / }), touch);
  await record(page, "after-show", info.project.name, observations);
  await action(page.getByRole("button", { name: "Collapse chart objects", exact: true }), touch);
  await record(page, "after-objects-close", info.project.name, observations);
  await action(row.getByRole("button", { name: "Remove Geometry study", exact: true }), touch);
  await expect(row).toHaveCount(0);
  const removed = await record(page, "after-remove", info.project.name, observations, true);
  expect(context.storage.get("custom-indicator-scripts.v1").find((script: any) => script.id === saved.id)).toEqual(saved);
  const worker = fs.readFileSync(path.join("frontend/dist/assets", fs.readdirSync("frontend/dist/assets").find((name) => /^pine-native-worker.*\.js$/.test(name))!));
  const workerSha256 = createHash("sha256").update(worker).digest("hex");
  for (const receipt of context.workerReceipts) expect(receipt.sha256).toBe(workerSha256);
  fs.writeFileSync(path.join(artifacts, info.project.name + "-receipt.json"), JSON.stringify({ source, initial, saved, workerSha256, workerBytes: worker.length, workerReceipts: context.workerReceipts, errors }, null, 2));
  expect(errors).toEqual([]);
  for (const value of observations) {
    expect(value.viewport.scrollX, value.label + " document horizontal scroll").toBe(0);
    expect(value.workspace.scrollLeft, value.label + " workspace horizontal scroll").toBe(0);
    for (const [name, element] of Object.entries({
      workspace: value.workspace,
      column: value.column,
      toolbar: value.toolbar,
      replay: value.replay,
    })) {
      if (!element) continue;
      expect(element.scrollWidth, value.label + " " + name + " contained content width")
        .toBeLessThanOrEqual(element.clientWidth + 1);
    }
    expect(value.stage.left, value.label + " chart left edge").toBeGreaterThanOrEqual(0);
    expect(value.stage.right, value.label + " chart right edge").toBeLessThanOrEqual(value.viewport.width + 1);
  }
  expect(removed.focus.ownsCenter, "Visible connected removal focus target").toBe(true);
});
