import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

test.use({ video: "off" });
let script: string;
let css: string;
test.beforeAll(async () => {
  const api = `
    const state=window.fixture={
      calls:[],pending:{},failConnection:false,failVerify:false,holdCreate:false,failReads:false,holdReads:false,
      providers:[{provider_id:"ninjatrader",display_name:"NinjaTrader",description:"Authenticated broker adapter.",availability:"available",requires_secret:true,capabilities:{accounts:true,orders:false,fills:true,incremental_sync:true,live_connectivity:true}}],
      connections:[{id:"connection-a",provider:"ninjatrader",display_name:"Alpha",status:"connected",health:"healthy",last_sync_completed_at:null,revoked_at:null},{id:"connection-b",provider:"ninjatrader",display_name:"Beta",status:"connected",health:"healthy",last_sync_completed_at:null,revoked_at:null}],
      secrets:[{id:"secret-existing",provider:"ninjatrader",purpose:"broker-sync",version:1,key_id:"vault-existing84",state:"active",last_connected_at:null}]
    };
    if(window.fixtureSecondProvider)state.providers.push({provider_id:"offline-fixture",display_name:"Offline fixture",description:"Local test adapter.",availability:"offline-fixture",requires_secret:true,capabilities:{accounts:true,orders:false,fills:true,incremental_sync:false,live_connectivity:false}});
    const record=(name,payload)=>{state.calls.push({name,payload});};
    const held=(name,id)=>{record(name,id);return new Promise((resolve,reject)=>{state.pending[name]={resolve,reject}})};
    state.finish=(name)=>state.pending[name].resolve({});
    export async function getBrokerProviders(){record("getProviders");if(state.failReads)throw Error("Provider status unavailable");if(state.holdReads)await new Promise((resolve,reject)=>{state.pending.getProviders={resolve,reject}});return structuredClone(state.providers)}
    export async function getBrokerConnections(){record("getConnections");return structuredClone(state.connections)}
    export async function getIntegrationSecrets(){record("getSecrets");return structuredClone(state.secrets)}
    export async function createIntegrationSecret(payload){record("createSecret",payload);if(state.holdCreate)await new Promise((resolve,reject)=>{state.pending.createSecret={resolve,reject}});const secret={id:"secret-created",provider:payload.provider,purpose:payload.purpose,version:1,key_id:"vault-created84",state:"active",last_connected_at:null};state.secrets.push(secret);return structuredClone(secret)}
    export async function verifyIntegrationSecret(id){record("verifySecret",id);if(state.failVerify)throw Error("Credential verification unavailable");return {}}
    export async function createBrokerConnection(payload){record("createConnection",payload);if(state.failConnection)throw Error("Broker handshake unavailable");const connection={id:"connection-created",provider:payload.provider,display_name:payload.display_name,status:"connected",health:"healthy",last_sync_completed_at:null,revoked_at:null};state.connections.push(connection);return structuredClone(connection)}
    export function refreshBrokerConnection(id){return held("refreshConnection",id)}
    export function revokeBrokerConnection(id){return held("revokeConnection",id)}
    export function revokeIntegrationSecret(id){return held("revokeSecret",id)}
    export async function rotateIntegrationSecret(id){record("rotateSecret",id);return {}}
  `;
  const bundle = await build({ bundle:true,write:false,format:"iife",jsx:"automatic",
    stdin:{resolveDir:path.resolve("."),loader:"tsx",contents:`
      import React from "react";import {createRoot} from "react-dom/client";
      import {SettingsIntegrations} from "./frontend/src/components/settings/SettingsIntegrations";
      createRoot(document.getElementById("root")).render(<SettingsIntegrations/>);
    `},
    plugins:[{name:"integration-api-boundary",setup(b){
      b.onResolve({filter:/\/lib\/api$/},()=>({path:"api",namespace:"fixture"}));
      b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:api,loader:"js"}));
    }}],
  });
  script=bundle.outputFiles[0].text;
  const assets=path.resolve("frontend/dist/assets");
  css=fs.readdirSync(assets).filter(name=>name.endsWith(".css")).map(name=>fs.readFileSync(path.join(assets,name),"utf8")).join("\n");
});
async function open(page: Page, secondProvider = false) {
  await page.addInitScript(value=>{(window as any).fixtureSecondProvider=value},secondProvider);
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/integrations84",route=>route.fulfill({contentType:"text/html",body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture84.css"></head><body class="bg-[var(--ui-surface)] text-[var(--text-primary)]"><main id="root" class="mx-auto max-w-5xl px-4 py-8"></main><script src="/fixture84.js"></script></body></html>'}));
  await page.route("**/fixture84.css",route=>route.fulfill({contentType:"text/css",body:css}));
  await page.route("**/fixture84.js",route=>route.fulfill({contentType:"text/javascript",body:script}));
  await page.goto("/integrations84");
  await expect(page.getByRole("group",{name:"Alpha connection",exact:true})).toBeVisible();
  await expect(page.getByRole("status").filter({hasText:"Loading provider status"})).toBeHidden();
  return errors;
}
const form=(page:Page)=>page.locator("form");
const submit=(page:Page)=>page.getByRole("button",{name:"Save credential and create connection",exact:true});
const vault=(page:Page)=>page.locator('[data-setting-control="credential-vault"]');
async function calls(page:Page,name:string){return page.evaluate(name=>(window as any).fixture.calls.filter((call:any)=>call.name===name),name);}
async function credential(page:Page){await form(page).locator('input[type="password"]').fill("fixture84-write-only-token");}

test("catalog selection and submitted provider agree when offline fixture is absent",async({page})=>{
  const errors=await open(page);
  await expect(form(page).getByRole("combobox",{name:"Provider",exact:true})).toContainText("NinjaTrader");
  await expect(form(page).getByLabel("Connection name",{exact:true})).toHaveValue("NinjaTrader");
  await expect(form(page).getByLabel("API key",{exact:true})).toBeVisible();
  await credential(page);await submit(page).click();
  await expect.poll(async()=>calls(page,"createConnection")).toHaveLength(1);
  expect((await calls(page,"createSecret"))[0].payload).toEqual({provider:"ninjatrader",purpose:"broker-sync",credentials:{api_key:"fixture84-write-only-token"}});
  expect((await calls(page,"createConnection"))[0].payload.provider).toBe("ninjatrader");
  expect(errors).toEqual([]);
});

test("held refresh blocks connection submission and every other mutation",async({page})=>{
  const errors=await open(page);await credential(page);
  await page.getByRole("group",{name:"Beta connection",exact:true}).getByRole("button",{name:"Refresh",exact:true}).click();
  await expect.poll(async()=>calls(page,"refreshConnection")).toHaveLength(1);
  await expect.soft(submit(page)).toBeDisabled();
  if(await submit(page).isEnabled())await submit(page).click();
  await form(page).evaluate(element=>(element as HTMLFormElement).requestSubmit());
  expect(await calls(page,"createSecret")).toHaveLength(0);
  await page.evaluate(()=>(window as any).fixture.finish("refreshConnection"));
  await expect(submit(page)).toBeEnabled();
  expect(errors).toEqual([]);
});

test("an already-open revoke confirmation cannot dispatch alongside another connection refresh",async({page})=>{
  const errors=await open(page),alpha=page.getByRole("group",{name:"Alpha connection",exact:true});
  await alpha.getByRole("button",{name:"Revoke",exact:true}).click();
  const confirm=alpha.getByRole("button",{name:"Confirm revoke",exact:true});
  await expect(confirm).toBeVisible();
  await page.getByRole("group",{name:"Beta connection",exact:true}).getByRole("button",{name:"Refresh",exact:true}).click();
  await expect.poll(async()=>calls(page,"refreshConnection")).toHaveLength(1);
  await expect.soft(confirm).toBeDisabled();
  if(await confirm.isEnabled())await confirm.click();
  expect(await calls(page,"revokeConnection")).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("failed connection exposes the already-saved credential metadata and recovery controls",async({page})=>{
  const errors=await open(page);await credential(page);
  await page.evaluate(()=>(window as any).fixture.failConnection=true);
  await submit(page).click();
  await expect(page.getByRole("alert")).toContainText(/handshake|connection|credential/i);
  expect(await calls(page,"createSecret")).toHaveLength(1);
  expect(await calls(page,"createConnection")).toHaveLength(1);
  await expect(vault(page)).toContainText("vault-created84");
  const created=vault(page).locator("div.rounded-md").filter({hasText:"vault-created84"});
  await expect(created.getByRole("button",{name:"Verify",exact:true})).toBeEnabled();
  await expect(created.getByRole("button",{name:"Re-encrypt",exact:true})).toBeEnabled();
  expect(await page.locator("body").innerText()).not.toContain("fixture84-write-only-token");
  await expect(form(page).locator('input[type="password"]')).toHaveValue("");
  await page.evaluate(()=>(window as any).fixture.failConnection=false);
  await form(page).getByLabel("Connection name",{exact:true}).fill("Recovered NinjaTrader");
  await page.getByRole("button",{name:"Retry connection setup",exact:true}).click();
  await expect(page.getByRole("group",{name:"Recovered NinjaTrader connection",exact:true})).toBeVisible();
  expect(await calls(page,"createSecret")).toHaveLength(1);
  const retries=await calls(page,"createConnection");expect(retries).toHaveLength(2);
  expect(retries.map(call=>call.payload.secret_id)).toEqual(["secret-created","secret-created"]);
  expect(retries.map(call=>call.payload.display_name)).toEqual(["NinjaTrader","Recovered NinjaTrader"]);
  await expect(page.getByRole("alert")).toBeHidden();
  expect(errors).toEqual([]);
});


test("provider dropdown keyboard selection updates credential labels and clears the previous provider draft",async({page})=>{
  const errors=await open(page,true),provider=page.getByRole("combobox",{name:"Provider",exact:true});
  await credential(page);
  await provider.focus();await provider.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await provider.press("End");await provider.press("Enter");
  await expect(provider).toContainText("Offline fixture");
  await expect(form(page).getByLabel("Connection name",{exact:true})).toHaveValue("Offline fixture");
  await expect(form(page).getByLabel("Fixture token",{exact:true})).toHaveValue("");
  await credential(page);await provider.press("ArrowDown");await provider.press("Home");await provider.press("Enter");
  await expect(provider).toContainText("NinjaTrader");
  await expect(form(page).getByLabel("API key",{exact:true})).toHaveValue("");
  await credential(page);await submit(page).click();
  await expect.poll(async()=>calls(page,"createConnection")).toHaveLength(1);
  expect((await calls(page,"createSecret"))[0].payload.provider).toBe("ninjatrader");
  expect(errors).toEqual([]);
});

test("same-event-loop duplicate submits admit one vault write and one connection",async({page})=>{
  const errors=await open(page);await credential(page);
  await page.evaluate(()=>(window as any).fixture.holdCreate=true);
  await form(page).evaluate(element=>{const form=element as HTMLFormElement;form.requestSubmit();form.requestSubmit()});
  await expect.poll(async()=>calls(page,"createSecret")).toHaveLength(1);
  await expect(form(page).locator('input[type="password"]')).toBeDisabled();
  await expect(form(page).getByLabel("Connection name",{exact:true})).toBeDisabled();
  await expect(page.getByRole("combobox",{name:"Provider",exact:true})).toBeDisabled();
  await page.evaluate(()=>(window as any).fixture.finish("createSecret"));
  await expect(page.getByRole("group",{name:"NinjaTrader connection",exact:true})).toBeVisible();
  expect(await calls(page,"createSecret")).toHaveLength(1);expect(await calls(page,"createConnection")).toHaveLength(1);
  await expect(form(page).locator('input[type="password"]')).toHaveValue("");
  expect(errors).toEqual([]);
});

test("verification failure resumes the same saved credential without another vault write",async({page})=>{
  const errors=await open(page);await credential(page);
  await page.evaluate(()=>(window as any).fixture.failVerify=true);
  await submit(page).click();
  await expect(page.getByRole("alert")).toContainText("verification");
  await expect(vault(page)).toContainText("vault-created84");
  await expect(form(page).locator('input[type="password"]')).toHaveValue("");
  expect(await calls(page,"createConnection")).toHaveLength(0);
  await page.evaluate(()=>(window as any).fixture.failVerify=false);
  await page.getByRole("button",{name:"Retry connection setup",exact:true}).click();
  await expect(page.getByRole("group",{name:"NinjaTrader connection",exact:true})).toBeVisible();
  expect(await calls(page,"createSecret")).toHaveLength(1);
  expect((await calls(page,"verifySecret")).map(call=>call.payload)).toEqual(["secret-created","secret-created"]);
  expect(await calls(page,"createConnection")).toHaveLength(1);
  expect(errors).toEqual([]);
});

async function tokenColor(page:Page,token:string){
  return page.evaluate(token=>{const probe=document.createElement("span");probe.style.color="var("+token+")";document.body.append(probe);const color=getComputedStyle(probe).color;probe.remove();return color},token);
}
async function contains(page:Page,locator:ReturnType<Page["locator"]>){
  const bounds=await locator.boundingBox();expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width+1);
}
test("real dropdown fields and provider text follow dark and light tokens without overflowing",async({page},info)=>{
  const errors=await open(page,true),provider=page.getByRole("combobox",{name:"Provider",exact:true});
  for(const theme of ["dark","light"]){
    if(theme==="light")await page.evaluate(()=>{
      const tokens={"--ui-surface":"#ffffff","--ui-inset":"#f6f8fa","--ui-floating":"#ffffff","--ui-raised":"#ffffff","--ui-hover":"#edf2f7","--ui-selection":"#d9eef8","--text-primary":"#16212b","--text-secondary":"#52616f","--text-muted":"#52616f","--accent-primary":"#0b7189","--loss-text":"#aa2032","--profit-text":"#12683a"};
      for(const [key,value] of Object.entries(tokens))document.documentElement.style.setProperty(key,value);
    });
    const field=form(page).locator('input[type="password"]');
    expect(await page.locator("body").evaluate(el=>getComputedStyle(el).color)).toBe(await tokenColor(page,"--text-primary"));
    expect(await page.locator("body").evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(await tokenColor(page,"--ui-surface"));
    expect(await page.getByText("Supported",{exact:true}).first().evaluate(el=>getComputedStyle(el).color)).toBe(await tokenColor(page,"--profit-text"));
    expect(await page.getByRole("group",{name:"Alpha connection",exact:true}).getByRole("button",{name:"Revoke",exact:true}).evaluate(el=>getComputedStyle(el).color)).toBe(await tokenColor(page,"--loss-text"));
    expect(await field.evaluate(el=>getComputedStyle(el).color)).toBe(await tokenColor(page,"--text-primary"));
    expect(await field.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(await tokenColor(page,"--ui-inset"));
    expect(await page.getByRole("heading",{name:"Providers and credentials",exact:true}).evaluate(el=>getComputedStyle(el).color)).toBe(await tokenColor(page,"--text-primary"));
    await provider.click();const menu=page.getByRole("listbox");await expect(menu).toBeVisible();
    expect(await menu.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(await tokenColor(page,"--ui-floating"));
    expect(await provider.evaluate(el=>getComputedStyle(el).color)).toBe(await tokenColor(page,"--text-primary"));
    await contains(page,menu);await contains(page,field);await contains(page,submit(page));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({path:info.outputPath("integration-settings-"+theme+".png"),fullPage:true});
    await provider.press("Escape");await expect(menu).toBeHidden();
  }
  expect(errors).toEqual([]);
});

test("failed status reads keep mutations disabled while a held read retry recovers without writes",async({page})=>{
  const errors=await open(page);await credential(page);
  await page.getByRole("group",{name:"Beta connection",exact:true}).getByRole("button",{name:"Refresh",exact:true}).click();
  await page.evaluate(()=>{(window as any).fixture.failReads=true;(window as any).fixture.finish("refreshConnection")});
  const retry=page.getByRole("button",{name:"Retry status check",exact:true});
  await expect(retry).toBeEnabled();await expect(page.getByRole("alert")).toContainText("Provider status unavailable");
  const mutations=page.getByRole("button",{name:/^(Refresh|Revoke|Verify|Re-encrypt)$/});
  for(const button of await mutations.all())await expect(button).toBeDisabled();
  await expect(submit(page)).toBeDisabled();
  await expect(page.getByRole("combobox",{name:"Provider",exact:true})).toBeDisabled();
  await page.evaluate(()=>{(window as any).fixture.failReads=false;(window as any).fixture.holdReads=true});
  await retry.click();await expect(page.getByRole("status").filter({hasText:"Loading provider status"})).toBeVisible();
  for(const button of await mutations.all())await expect(button).toBeDisabled();
  await expect(submit(page)).toBeDisabled();
  await form(page).evaluate(element=>(element as HTMLFormElement).requestSubmit());
  expect(await calls(page,"createSecret")).toHaveLength(0);expect(await calls(page,"revokeConnection")).toHaveLength(0);expect(await calls(page,"verifySecret")).toHaveLength(0);
  await page.evaluate(()=>(window as any).fixture.finish("getProviders"));
  await expect(page.getByRole("alert")).toBeHidden();await expect(retry).toBeHidden();
  await expect(submit(page)).toBeEnabled();
  await expect(form(page).getByLabel("API key",{exact:true})).toHaveValue("fixture84-write-only-token");
  expect(await calls(page,"refreshConnection")).toHaveLength(1);expect(await calls(page,"getProviders")).toHaveLength(3);
  expect(errors).toEqual([]);
});
