import { expect, test, type Page, type Route } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

test.use({ video:"off" });
let script:string,css:string;
test.beforeAll(async()=>{
  const bundle=await build({bundle:true,write:false,format:"iife",jsx:"automatic",define:{"import.meta.env":JSON.stringify({VITE_API_BASE_URL:"/api"})},
    stdin:{resolveDir:path.resolve("."),loader:"tsx",contents:`
      import React,{useState} from "react";import {createRoot} from "react-dom/client";
      import {ChartToolbar} from "./frontend/src/components/ChartToolbar";
      import {sanitizeChartVisualSettings} from "./frontend/src/lib/chartSettings";
      import {getCachedAppStorageItem,saveAppStorageItem} from "./frontend/src/lib/serverStorage";
      const noop=()=>{};
      function Fixture(){
        const [settings,setSettings]=useState(()=>sanitizeChartVisualSettings({textSize:12,watermarkText:"Morning"}));
        const [openSignal,setOpenSignal]=useState(0);
        window.fixture={settings,open:()=>setOpenSignal(value=>value+1),background:()=>saveAppStorageItem("chart-settings-presets.v1",[...getCachedAppStorageItem("chart-settings-presets.v1",[]),{name:"Background",settings:{textSize:13,watermarkText:"Background"},updatedAt:"2026-10-08T00:00:00Z"}])};
        return <ChartToolbar activePaneLabel="Main chart" chartSettings={settings} chartStyle="candles" clearableDrawingsCount={0} drawingTool="cursor" drawingsCount={0}
          indicatorInstances={[]} layoutName="Fixture" layoutNames={["Fixture"]} magnetMode="off" orderOverlaysVisible={true} paneLayout="single"
          replayTimeframe="1m" replayTimeframeOptions={[]} savedLabel={null} smoothCandles={false} sourceTimeframe="1m" symbol="TEST" timeframe="1m"
          toolsOpen={false} settingsOpenSignal={openSignal} onChartSettingsChange={setSettings} onChartSettingsReset={()=>setSettings(sanitizeChartVisualSettings({}))}
          onAddIndicator={noop} onRemoveIndicator={noop} onUpdateIndicatorSettings={noop} onChartStyleChange={noop} onClearDrawings={noop} onDeleteLayout={noop}
          onDrawingToolChange={noop} onLayoutNameChange={noop} onLoadLayout={noop} onMagnetModeChange={noop} onPaneLayoutChange={noop} onReplayTimeframeChange={noop}
          onSaveLayout={noop} onTimeframeChange={noop} onToggleOrderOverlays={noop} onSmoothCandlesChange={noop}/>;
      }
      createRoot(document.getElementById("root")).render(<Fixture/>);
    `}});
  script=bundle.outputFiles[0].text;
  const assets=path.resolve("frontend/dist/assets");
  css=fs.readdirSync(assets).filter(name=>name.endsWith(".css")).map(name=>fs.readFileSync(path.join(assets,name),"utf8")).join("\n");
});
const PRESETS="chart-settings-presets.v1",ACTIVE="active-chart-settings-preset.v1";
type Mutation={path:string;method:string;payload:any};
async function setup(page:Page){
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  const values:Record<string,any>={[PRESETS]:[
    {name:"Morning",settings:{textSize:12,watermarkText:"Morning"},updatedAt:"2026-10-08T00:00:00Z"},
    {name:"Evening",settings:{textSize:16,watermarkText:"Evening"},updatedAt:"2026-10-08T00:00:00Z"}
  ],[ACTIVE]:"Morning"};
  const state={mode:"ok" as "ok"|"fail"|"hold",calls:[] as Mutation[],corruptAck:false,held:[] as Array<{route:Route;call:Mutation}>};
  const item=(key:string)=>({namespace:"edgelab",key,value:structuredClone(values[key]??null),updated_at:"2026-10-08T00:00:00Z"});
  async function respond(route:Route,call:Mutation,fail=false){
    if(fail){await route.fulfill({status:503,json:{detail:"Template storage unavailable"}});return}
    if(call.method==="PUT"){const key=decodeURIComponent(call.path.split("/").at(-1)!);values[key]=structuredClone(call.payload.value);await route.fulfill({json:item(key)});return}
    if(call.method==="POST"&&call.path.endsWith("/settings/chart/templates")){
      const {action,name,settings}=call.payload;
      if(action==="save")values[PRESETS]=[{name,settings,updatedAt:"2026-10-08T00:00:00Z"},...values[PRESETS].filter((entry:any)=>entry.name!==name)];
      if(action==="delete")values[PRESETS]=values[PRESETS].filter((entry:any)=>entry.name!==name);
      values[ACTIVE]=action==="delete"?(values[ACTIVE]===name?null:values[ACTIVE]):name;
      const active=item(ACTIVE);if(state.corruptAck)active.value="Evening";
      await route.fulfill({json:{presets:item(PRESETS),active}});return;
    }
    await route.fulfill({json:call.path.endsWith("/settings/chart")?{presets:item(PRESETS),active:item(ACTIVE)}:item(decodeURIComponent(call.path.split("/").at(-1)!))});
  }
  await page.route("**/api/**",async route=>{
    const request=route.request(),call={path:new URL(request.url()).pathname,method:request.method(),payload:request.postData()?request.postDataJSON():null};
    if(call.method!=="GET"&&(call.path.includes(PRESETS)||call.path.includes(ACTIVE)||call.path.endsWith("/settings/chart/templates"))){
      state.calls.push(call);
      if(state.mode==="hold"){state.held.push({route,call});return}
      await respond(route,call,state.mode==="fail");return;
    }
    await respond(route,call);
  });
  await page.route("**/template85",route=>route.fulfill({contentType:"text/html",body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture85.css"></head><body><main id="root"></main><script src="/fixture85.js"></script></body></html>'}));
  await page.route("**/fixture85.css",route=>route.fulfill({contentType:"text/css",body:css}));
  await page.route("**/fixture85.js",route=>route.fulfill({contentType:"text/javascript",body:script}));
  await page.goto("/template85");
  await page.evaluate(()=>(window as any).fixture.open());
  const dialog=page.getByRole("dialog",{name:"Chart settings",exact:true});
  await expect(dialog).toBeVisible();await expect(dialog.getByRole("button",{name:"Morning Active",exact:true})).toBeVisible();
  state.calls.length=0;
  return {dialog,state,values,errors,release:async(fail=false)=>{for(const pending of state.held.splice(0))await respond(pending.route,pending.call,fail)}};
}
const save=(dialog:ReturnType<Page["getByRole"]>)=>dialog.getByRole("button",{name:/^(Save Template|Saving)/});
const status=(dialog:ReturnType<Page["getByRole"]>)=>dialog.locator(".chart-settings-template-status strong");

test("failed template save stays open and does not claim an acknowledged active template",async({page})=>{
  const {dialog,state,values,errors}=await setup(page);state.mode="fail";
  await dialog.getByRole("textbox",{name:"Template name",exact:true}).fill("Failed save");
  await save(dialog).click();await expect.poll(()=>state.calls.length).toBeGreaterThan(0);
  expect(values[ACTIVE]).toBe("Morning");expect(values[PRESETS].map((p:any)=>p.name)).toEqual(["Morning","Evening"]);
  await expect(dialog).toBeVisible();await expect(dialog.getByRole("alert")).toContainText(/unavailable|save|failed|template/i);
  state.mode="ok";await save(dialog).click();await expect(dialog).toBeHidden();
  expect(values[ACTIVE]).toBe("Failed save");expect(values[PRESETS][0].name).toBe("Failed save");
  expect(state.calls).toHaveLength(2);expect(state.calls.every(call=>call.method==="POST"&&call.path.endsWith("/settings/chart/templates")&&call.payload.action==="save")).toBe(true);expect(errors).toEqual([]);
});

test("failed template deletion retains the active template and shows a retryable error",async({page})=>{
  const {dialog,state,values,errors}=await setup(page);state.mode="fail";
  await dialog.getByRole("button",{name:"Delete",exact:true}).click();await expect.poll(()=>state.calls.length).toBeGreaterThan(0);
  expect(values[ACTIVE]).toBe("Morning");expect(values[PRESETS].map((p:any)=>p.name)).toEqual(["Morning","Evening"]);
  await expect(dialog.getByRole("button",{name:/^Morning (Active|Modified)$/})).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText(/unavailable|delete|failed|template/i);
  state.mode="ok";await dialog.getByRole("button",{name:"Delete",exact:true}).click();
  await expect(dialog.getByRole("button",{name:/^Morning (Active|Modified|Use)$/})).toBeHidden();await expect(status(dialog)).toHaveText("Unsaved");
  expect(values[ACTIVE]).toBe(null);expect(values[PRESETS].map((p:any)=>p.name)).toEqual(["Evening"]);
  expect(state.calls).toHaveLength(2);expect(state.calls.every(call=>call.method==="POST"&&call.path.endsWith("/settings/chart/templates")&&call.payload.action==="delete")).toBe(true);expect(errors).toEqual([]);
});

async function canvas(dialog:ReturnType<Page["getByRole"]>){await dialog.getByRole("button",{name:"Canvas",exact:true}).click();return dialog.getByLabel("Text size",{exact:true})}
async function reopen(page:Page){await page.evaluate(()=>(window as any).fixture.open());const dialog=page.getByRole("dialog",{name:"Chart settings",exact:true});await expect(dialog).toBeVisible();return dialog}

test("held save confirms atomically while close and reopen preserve the current dialog draft",async({page})=>{
  const {dialog,state,values,release,errors}=await setup(page);state.mode="hold";
  await dialog.getByRole("textbox",{name:"Template name",exact:true}).fill("Acknowledged");
  await save(dialog).click();await expect.poll(()=>state.held.length).toBe(1);
  await expect(dialog).toBeVisible();await expect(status(dialog)).toHaveText("Morning");
  await expect(dialog.getByRole("button",{name:"Acknowledged Active",exact:true})).toBeHidden();
  await expect(save(dialog)).toBeDisabled();await expect(dialog.getByRole("button",{name:"Delete",exact:true})).toBeDisabled();
  await expect(dialog.getByRole("button",{name:"Evening Use",exact:true})).toBeDisabled();
  expect(values[ACTIVE]).toBe("Morning");expect(values[PRESETS].map((p:any)=>p.name)).toEqual(["Morning","Evening"]);
  expect(state.calls).toHaveLength(1);expect(state.calls[0].payload.action).toBe("save");
  await dialog.getByRole("button",{name:"Close chart settings",exact:true}).click();await expect(dialog).toBeHidden();
  const saved=await reopen(page);await expect(saved.getByRole("textbox",{name:"Template name",exact:true})).toHaveValue("Acknowledged");
  await release();await expect(saved).toBeVisible();await expect(status(saved)).toHaveText("Morning");
  await expect(saved.getByRole("status")).toContainText("Saved Acknowledged. Your newer changes are still unsaved.");
  expect(values[ACTIVE]).toBe("Acknowledged");expect(errors).toEqual([]);
});

test("held delete retains the active chip and current preview until confirmed",async({page})=>{
  const {dialog,state,values,release,errors}=await setup(page);state.mode="hold";
  await dialog.getByRole("button",{name:"Delete",exact:true}).click();await expect.poll(()=>state.held.length).toBe(1);
  await expect(status(dialog)).toHaveText("Morning");await expect(dialog.getByRole("button",{name:"Morning Active",exact:true})).toBeVisible();
  await expect(save(dialog)).toBeDisabled();await expect(dialog.getByRole("button",{name:"Evening Use",exact:true})).toBeDisabled();
  expect(values[PRESETS].map((p:any)=>p.name)).toEqual(["Morning","Evening"]);
  await release();await expect(status(dialog)).toHaveText("Unsaved");await expect(await canvas(dialog)).toHaveValue("12");
  expect(state.calls).toHaveLength(1);expect(state.calls[0].payload.action).toBe("delete");expect(errors).toEqual([]);
});

test("held activation preserves the current settings and active marker until acknowledged",async({page})=>{
  const {dialog,state,values,release,errors}=await setup(page);state.mode="hold";
  const size=await canvas(dialog);await expect(size).toHaveValue("12");
  await dialog.getByRole("button",{name:"Evening Use",exact:true}).click();await expect.poll(()=>state.held.length).toBe(1);
  await expect(status(dialog)).toHaveText("Morning");await expect(size).toHaveValue("12");expect(values[ACTIVE]).toBe("Morning");
  await expect(save(dialog)).toBeDisabled();await expect(dialog.getByRole("button",{name:"Morning Active",exact:true})).toBeDisabled();
  await release();await expect(status(dialog)).toHaveText("Evening");await expect(size).toHaveValue("16");
  expect(values[ACTIVE]).toBe("Evening");expect(state.calls).toHaveLength(1);expect(state.calls[0].payload.action).toBe("activate");expect(errors).toEqual([]);
});

test("failed template selection leaves active settings intact and retries through the same action",async({page})=>{
  const {dialog,state,values,errors}=await setup(page);state.mode="fail";
  const size=await canvas(dialog);await dialog.getByRole("button",{name:"Evening Use",exact:true}).click();
  await expect(dialog.getByRole("alert")).toContainText(/unavailable|failed|template/i);
  await expect(status(dialog)).toHaveText("Morning");await expect(size).toHaveValue("12");expect(values[ACTIVE]).toBe("Morning");
  state.mode="ok";await dialog.getByRole("button",{name:"Evening Use",exact:true}).click();
  await expect(status(dialog)).toHaveText("Evening");await expect(size).toHaveValue("16");await expect(dialog.getByRole("alert")).toBeHidden();
  expect(state.calls).toHaveLength(2);expect(state.calls.every(call=>call.payload.action==="activate")).toBe(true);expect(errors).toEqual([]);
});

test("edits made during a held save survive acknowledgement and remain explicitly modified",async({page})=>{
  const {dialog,state,values,release,errors}=await setup(page);state.mode="hold";
  const name=dialog.getByRole("textbox",{name:"Template name",exact:true}),size=await canvas(dialog);
  await name.fill("Submitted");await size.fill("13");await save(dialog).click();await expect.poll(()=>state.held.length).toBe(1);
  await expect(name).toBeEnabled();await expect(size).toBeEnabled();
  await name.fill("Later draft");await size.fill("14");
  await release();await expect(dialog).toBeVisible();await expect(name).toHaveValue("Later draft");await expect(size).toHaveValue("14");
  await expect(status(dialog)).toHaveText("Morning · Modified");
  await expect(dialog.getByRole("status")).toContainText("Saved Submitted. Your newer changes are still unsaved.");
  expect(values[ACTIVE]).toBe("Submitted");expect(values[PRESETS].find((p:any)=>p.name==="Submitted").settings.textSize).toBe(13);
  state.mode="ok";await save(dialog).click();await expect(dialog).toBeHidden();
  expect(values[ACTIVE]).toBe("Later draft");expect(values[PRESETS].find((p:any)=>p.name==="Later draft").settings.textSize).toBe(14);expect(errors).toEqual([]);
});

test("same-event-loop double save and pending action attempts dispatch one mutation",async({page})=>{
  const {dialog,state,release,errors}=await setup(page);state.mode="hold";
  await dialog.getByRole("textbox",{name:"Template name",exact:true}).fill("One write");
  await save(dialog).evaluate(element=>{const button=element as HTMLButtonElement;button.click();button.click()});
  await expect.poll(()=>state.held.length).toBe(1);
  await dialog.getByRole("button",{name:"Delete",exact:true}).evaluate(element=>(element as HTMLButtonElement).click());
  await dialog.getByRole("button",{name:"Evening Use",exact:true}).evaluate(element=>(element as HTMLButtonElement).click());
  expect(state.calls).toHaveLength(1);await release();await expect(dialog).toBeHidden();expect(errors).toEqual([]);
});

async function tokenColor(page:Page,token:string){return page.evaluate(token=>{const probe=document.createElement("span");probe.style.color="var("+token+")";document.body.append(probe);const value=getComputedStyle(probe).color;probe.remove();return value},token)}
test("template failures and editable drafts fit mobile and follow dark and light theme tokens",async({page},info)=>{
  const {dialog,state,errors}=await setup(page);state.mode="fail";await save(dialog).click();
  await expect(dialog.getByRole("alert")).toBeVisible();await canvas(dialog);
  for(const theme of ["dark","light"]){
    if(theme==="light")await page.evaluate(()=>{for(const [key,value]of Object.entries({"--ui-canvas":"#ffffff","--ui-surface":"#ffffff","--ui-inset":"#f6f8fa","--ui-floating":"#ffffff","--ui-raised":"#ffffff","--ui-hover":"#edf2f7","--ui-selection":"#d9eef8","--text-primary":"#16212b","--text-secondary":"#52616f","--text-muted":"#52616f","--loss-text":"#aa2032"}))document.documentElement.style.setProperty(key,value)});
    const name=dialog.getByRole("textbox",{name:"Template name",exact:true});
    expect(await name.evaluate(el=>getComputedStyle(el).color)).toBe(await tokenColor(page,"--text-primary"));
    expect(await dialog.getByRole("alert").evaluate(el=>getComputedStyle(el).color)).toBe(await tokenColor(page,"--loss-text"));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
    for(const locator of [name,save(dialog),dialog.getByRole("button",{name:"Delete",exact:true})]){
      const b=await locator.boundingBox();expect(b).not.toBeNull();expect(b!.x).toBeGreaterThanOrEqual(0);expect(b!.x+b!.width).toBeLessThanOrEqual(page.viewportSize()!.width+1);
    }
    if(process.env.EDGELAB_TEMPLATE85_SCREENSHOTS!=="0")await page.screenshot({path:info.outputPath("template-persistence-"+theme+".png")});
  }
  expect(errors).toEqual([]);
});

test("an inconsistent successful receipt cannot activate or close the saved template until a valid retry",async({page})=>{
  const {dialog,state,values,errors}=await setup(page);state.corruptAck=true;
  await dialog.getByRole("textbox",{name:"Template name",exact:true}).fill("Unconfirmed");
  await save(dialog).click();await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog).toBeVisible();await expect(status(dialog)).toHaveText("Morning");
  await expect(dialog.getByRole("button",{name:"Unconfirmed Active",exact:true})).toBeHidden();
  expect(values[ACTIVE]).toBe("Unconfirmed","A malformed acknowledgment cannot publish even a committed write optimistically");
  state.corruptAck=false;await save(dialog).click();await expect(dialog).toBeHidden();
  expect(state.calls).toHaveLength(2);expect(values[ACTIVE]).toBe("Unconfirmed");expect(errors).toEqual([]);
});

test("a queued legacy background write survives held activation acknowledgement and cache rebase",async({page})=>{
  const {dialog,state,values,release,errors}=await setup(page);state.mode="hold";
  const size=await canvas(dialog);
  await dialog.getByRole("button",{name:"Evening Use",exact:true}).click();await expect.poll(()=>state.held.length).toBe(1);
  await page.evaluate(()=>(window as any).fixture.background());
  await expect(dialog.getByRole("button",{name:"Background Use",exact:true})).toBeVisible();
  expect(state.calls).toHaveLength(1,"The real legacy PUT must queue behind the active atomic operation");
  state.mode="ok";await release();
  await expect(status(dialog)).toHaveText("Evening");await expect(size).toHaveValue("16");
  await expect(dialog.getByRole("button",{name:"Background Use",exact:true})).toBeVisible();
  await expect.poll(()=>values[PRESETS].map((entry:any)=>entry.name)).toContain("Background");
  expect(values[ACTIVE]).toBe("Evening");
  expect(state.calls.map(call=>[call.method,call.payload.action??null])).toEqual([["POST","activate"],["PUT",null]]);
  const persisted=state.calls[1].payload.value as Array<{name:string;settings:{textSize:number}}>;
  expect(persisted.map(preset=>preset.name)).toContain("Background");
  expect(persisted.find(preset=>preset.name==="Evening")?.settings.textSize).toBe(16);
  expect(errors).toEqual([]);
});
