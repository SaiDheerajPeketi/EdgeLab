import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

test.use({ video: "off" });
let script: string;
let css: string;
test.beforeAll(async () => {
  const mocks: Record<string, string> = {
    useJournalSettings: "export const RESET_JOURNAL_SETTINGS={}; export function useJournalSettings(){return {defaults:{},journalDraft:{},journalDirty:false,noteDirty:false,journalPending:false,notePending:false,ready:true,setJournalDraft(){},setNoteDraft(){}}}",
    useChartSettings: "export function useChartSettings(){return {dirty:false,pending:false}}",
    useBacktestSettings: "export function useBacktestSettings(){return {dirty:false,pending:false}}",
    useSettingsPreferences: "export function useSettingsPreferences(){return {draft:{density:'comfortable'},dirty:false,pending:false}}",
    authSession: "export function getStoredAuthSession(){return null}",
    "react-router-dom": "export function useLocation(){return {pathname:'/app/settings/data-providers'}}",
    SessionPrivacyPanels: "export const AccountSettingsPanel=()=>null,AiSettingsPanel=()=>null,GlobalSettingsPanel=()=>null,PrivacySettingsPanel=()=>null",
    ChartSettingsPanel: "export const ChartSettingsPanel=()=>null",
    BacktestSettingsPanel: "export const BacktestSettingsPanel=()=>null",
    SettingsDataTransfer: "export const SettingsDataTransfer=()=>null",
    SettingsIntegrations: "export const SettingsIntegrations=()=>null",
    SettingsSearch: "export const SettingsSearch=()=>null",
  };
  // Mount the real SettingsCenter and dataset controls; unrelated account hooks
  // and panels are isolated so failures identify this local draft state machine.
  const bundle = await build({
    bundle: true, write: false, format: "iife", jsx: "automatic",
    stdin: { resolveDir: path.resolve("."), loader: "tsx", contents: `
      import React from "react"; import {createRoot} from "react-dom/client";
      import {SettingsCenter} from "./frontend/src/components/settings/SettingsCenter";
      const root=createRoot(document.getElementById("root"));
      const state=window.fixture={catalog:{root:"/original",instruments:[
        {id:"eurusd",name:"Euro dollar",symbol:"EURUSD",currency:"USD",timezone:"UTC",pnl_multiplier:1},
        {id:"gbpusd",name:"Pound dollar",symbol:"GBPUSD",currency:"GBP",timezone:"Europe/London",pnl_multiplier:2}
      ]},status:{running:true,current:"files"},statusCalls:0,refreshCalls:0,rootSaves:[],assetSaves:[],confirmCalls:0,allowNavigation:false,backCalls:0,failRoot:false,failAsset:false,statusFailure:Boolean(window.failInitialStatus)};
      window.confirm=()=>{state.confirmCalls++;return state.allowNavigation};
      const pending={};
      const render=()=>root.render(<SettingsCenter datasets={state.catalog} journalDefaults={{}} onBack={()=>state.backCalls++}
        onGetDatasetRefreshStatus={async()=>{state.statusCalls++;if(state.statusFailure)throw Error("status unavailable");return structuredClone(state.status)}}
        onRefreshDatasets={async()=>{state.refreshCalls++;return {status:structuredClone(state.status)}}}
        onUpdateDatasetSettings={payload=>{state.rootSaves.push(payload);return new Promise((resolve,reject)=>{pending.root={payload,resolve,reject}})}}
        onUpdateDatasetAsset={(id,payload)=>{state.assetSaves.push({id,payload});return new Promise((resolve,reject)=>{pending.asset={id,payload,resolve,reject}})}}
        onUpdateJournalDefaults={()=>{}} />);
      state.refreshCatalog=()=>{state.catalog=structuredClone(state.catalog);render()};
      state.finishRoot=()=>{const request=pending.root;if(state.failRoot){request.reject(Error("root unavailable"));return}state.catalog={...state.catalog,root:request.payload.root_path};render();request.resolve()};
      state.finishAsset=()=>{const request=pending.asset;if(state.failAsset){request.reject(Error("asset unavailable"));return}state.catalog={...state.catalog,instruments:state.catalog.instruments.map(asset=>asset.id===request.id?{...asset,...request.payload}:asset)};render();request.resolve()};
      render();
    ` },
    plugins: [{ name: "settings-fixture-boundaries", setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => { const name = args.path.split("/").at(-1)!; if (mocks[name]) return { path: name, namespace: "fixture" }; });
      b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({ contents: mocks[args.path], loader: "js" }));
    } }],
  });
  script = bundle.outputFiles[0].text;
  const assets = path.resolve("frontend/dist/assets");
  css = fs.readdirSync(assets).filter(name => name.endsWith(".css")).map(name => fs.readFileSync(path.join(assets, name), "utf8")).join("\n");
});
async function open(page: Page, failInitialStatus = false) {
  await page.addInitScript((failed) => { (window as unknown as { failInitialStatus: boolean }).failInitialStatus = failed; }, failInitialStatus);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("**/settings-reliability-fixture82", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture82.css"></head><body><div id="root"></div><script src="/fixture82.js"></script></body></html>' }));
  await page.route("**/fixture82.css", route => route.fulfill({ contentType: "text/css", body: css }));
  await page.route("**/fixture82.js", route => route.fulfill({ contentType: "text/javascript", body: script }));
  await page.goto("/settings-reliability-fixture82");
  await expect(page.getByRole("combobox", { name: "Instrument", exact: true })).toBeVisible();
  return errors;
}
const calibration = (page: Page) => page.locator('[data-setting-control="asset-calibration"]');
const rootInput = (page: Page) => page.locator('[data-setting-control="dataset-root"] input');
async function category(page: Page, value: string, name: string) {
  if (page.viewportSize()!.width < 1024) await page.getByRole("combobox", { name: "Settings category", exact: true }).selectOption(value);
  else await page.getByRole("button", { name: new RegExp("^" + name + "(?: |$)") }).click();
}
async function run(page: Page, expression: string) { await page.evaluate(expression); }

test("instrument edits are guarded and survive equivalent catalogs and instrument switches", async ({ page }, info) => {
  const errors = await open(page);
  const currency = calibration(page).getByLabel("Currency", { exact: true });
  await currency.fill("EUR");
  await expect(page.getByText("Draft changes not applied", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
  await category(page, "global", "Global");
  await expect(page.getByRole("heading", { name: "Data & providers", exact: true })).toBeVisible();
  expect(await page.evaluate("fixture.confirmCalls")).toBe(1);
  await run(page, "fixture.refreshCatalog()");
  await expect(currency).toHaveValue("EUR");
  await run(page, "fixture.catalog.instruments[0].timezone='America/New_York';fixture.refreshCatalog()");
  await expect(currency).toHaveValue("EUR");
  await expect(calibration(page).getByLabel("Time zone", { exact: true })).toHaveValue("America/New_York");
  await page.getByRole("combobox", { name: "Instrument", exact: true }).selectOption("gbpusd");
  await calibration(page).getByLabel("P&L multiplier", { exact: true }).fill("3");
  await page.getByRole("combobox", { name: "Instrument", exact: true }).selectOption("eurusd");
  await expect(currency).toHaveValue("EUR");
  await page.getByRole("combobox", { name: "Instrument", exact: true }).selectOption("gbpusd");
  await expect(calibration(page).getByLabel("P&L multiplier", { exact: true })).toHaveValue("3");
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath("instrument-drafts.png"), fullPage: true });
});

test("instrument save prevents duplicates while later edits remain unapplied after acknowledgment", async ({ page }) => {
  const errors = await open(page), row = calibration(page), button = row.getByRole("button", { name: "Save instrument", exact: true });
  await row.getByLabel("Currency", { exact: true }).fill("EUR");
  await button.click(); await expect(button).toBeDisabled();
  await row.getByLabel("Currency", { exact: true }).fill("CAD");
  await category(page, "global", "Global");
  await expect(page.getByRole("heading", { name: "Data & providers", exact: true })).toBeVisible();
  expect(await page.evaluate("fixture.assetSaves")).toEqual([{ id: "eurusd", payload: { currency: "EUR", timezone: "UTC", pnl_multiplier: 1 } }]);
  await run(page, "fixture.finishAsset()");
  await expect(row.getByLabel("Currency", { exact: true })).toHaveValue("CAD");
  await expect(button).toBeEnabled();
  await expect(row.getByText("Saved", { exact: true })).toBeHidden();
  await expect(page.getByText("Draft changes not applied", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("dataset root acknowledgment preserves later edits and pending navigation is guarded", async ({ page }) => {
  const errors = await open(page), input = rootInput(page), apply = page.getByRole("button", { name: "Apply dataset root", exact: true });
  await input.fill("/first"); await apply.click(); await expect(apply).toBeDisabled();
  await input.fill("/second"); await page.getByRole("button", { name: "Back", exact: true }).click();
  expect(await page.evaluate("fixture.backCalls")).toBe(0);
  await run(page, "fixture.finishRoot()");
  await expect(input).toHaveValue("/second"); await expect(apply).toBeEnabled();
  await expect(page.locator('[data-setting-control="dataset-root"]').getByText("Saved", { exact: true })).toBeHidden();
  expect(await page.evaluate("fixture.rootSaves")).toEqual([{ root_path: "/first" }]);
  expect(errors).toEqual([]);
});

test("rejected dataset and instrument saves retain drafts with retry and no unhandled rejection", async ({ page }) => {
  const errors = await open(page);
  await rootInput(page).fill("/retry-root"); await page.getByRole("button", { name: "Apply dataset root", exact: true }).click();
  await run(page, "fixture.failRoot=true;fixture.finishRoot()");
  await expect(page.locator('[data-setting-control="dataset-root"]').getByRole("alert")).toBeVisible();
  await expect(rootInput(page)).toHaveValue("/retry-root");
  await run(page, "fixture.failRoot=false");
  await page.locator('[data-setting-control="dataset-root"]').getByRole("button", { name: "Retry", exact: true }).click();
  await run(page, "fixture.finishRoot()");
  await expect(page.locator('[data-setting-control="dataset-root"]').getByRole("alert")).toBeHidden();
  await expect(page.getByRole("button", { name: "Apply dataset root", exact: true })).toBeDisabled();
  await calibration(page).getByLabel("Currency", { exact: true }).fill("EUR");
  await calibration(page).getByRole("button", { name: "Save instrument", exact: true }).click();
  await run(page, "fixture.failAsset=true;fixture.finishAsset()");
  await expect(calibration(page).getByRole("alert")).toBeVisible();
  await expect(calibration(page).getByLabel("Currency", { exact: true })).toHaveValue("EUR");
  await run(page, "fixture.failAsset=false");
  await calibration(page).getByRole("button", { name: "Retry", exact: true }).click();
  await run(page, "fixture.finishAsset()");
  await expect(calibration(page).getByRole("alert")).toBeHidden();
  await expect(calibration(page).getByRole("button", { name: "Save instrument", exact: true })).toBeDisabled();
  await expect(page.getByText("All explicit changes applied", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a running dataset refresh can be checked without starting another scan", async ({ page }) => {
  const errors = await open(page), refresh = page.locator('[data-setting-control="dataset-refresh"]');
  await expect(refresh.getByRole("button", { name: "Check scan status", exact: true })).toBeEnabled();
  await run(page, "fixture.status={running:false,summary:{assets:2,timeframes:2},finished_at:'2026-10-08T00:00:00Z'}");
  await refresh.getByRole("button", { name: "Check scan status", exact: true }).click();
  await expect(refresh.getByRole("button", { name: "Rescan datasets", exact: true })).toBeEnabled();
  expect(await page.evaluate("fixture.refreshCalls")).toBe(0);
  expect(await page.evaluate("fixture.statusCalls")).toBe(2);
  await run(page, "fixture.status={running:true,current:'again'}");
  await refresh.getByRole("button", { name: "Rescan datasets", exact: true }).click();
  await expect(refresh.getByRole("button", { name: "Check scan status", exact: true })).toBeEnabled();
  expect(await page.evaluate("fixture.refreshCalls")).toBe(1);
  expect(errors).toEqual([]);
});


test("reverting drafts during pending saves remains an explicit later edit", async ({ page }) => {
  const errors = await open(page), row = calibration(page), input = rootInput(page);
  await input.fill("/first"); await page.getByRole("button", { name: "Apply dataset root", exact: true }).click();
  await input.fill("/original");
  await row.getByLabel("Currency", { exact: true }).fill("EUR"); await row.getByRole("button", { name: "Save instrument", exact: true }).click();
  await row.getByLabel("Currency", { exact: true }).fill("USD");
  await category(page, "global", "Global");
  await expect(page.getByRole("heading", { name: "Data & providers", exact: true })).toBeVisible();
  await run(page, "fixture.finishRoot();fixture.finishAsset()");
  await expect(input).toHaveValue("/original"); await expect(row.getByLabel("Currency", { exact: true })).toHaveValue("USD");
  await expect(page.getByRole("button", { name: "Apply dataset root", exact: true })).toBeEnabled();
  await expect(row.getByRole("button", { name: "Save instrument", exact: true })).toBeEnabled();
  await expect(page.getByText("Draft changes not applied", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});


test("failed status loading retries its read without starting a dataset scan", async ({ page }) => {
  const errors = await open(page, true), refresh = page.locator('[data-setting-control="dataset-refresh"]');
  await expect(refresh.getByRole("alert")).toContainText("Retry the status check");
  await run(page, "fixture.statusFailure=false");
  await refresh.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(refresh.getByRole("alert")).toBeHidden();
  await expect(refresh.getByRole("button", { name: "Check scan status", exact: true })).toBeEnabled();
  expect(await page.evaluate("fixture.statusCalls")).toBe(2);
  expect(await page.evaluate("fixture.refreshCalls")).toBe(0);
  expect(errors).toEqual([]);
});
