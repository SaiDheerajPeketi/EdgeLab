import {test as base,expect} from "@playwright/test";
import {build} from "esbuild";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import {createHash} from "node:crypto";
declare global{interface Window{pineInputEnumFixture:any}}
const root=path.resolve(import.meta.dirname,".."),bars=JSON.parse(fs.readFileSync(path.join(root,"e2e/pine-visuals.bars.json"),"utf8")).slice(0,4);
const source=(body:string,version=6)=>"//@version="+version+'\nindicator("Enums91")\n'+body;
const declaration='enum Side\n    up = "Up"\n    down = "Down"\n    flat = "Flat"\n';
const aliasBody=declaration+'const Side alias = Side.up\nchoice=input.enum(alias,"Direction")\nplot(choice==Side.up?1:choice==Side.down?-1:0,"Signal")';
type Harness={origin:string,workerRequests:string[]};
const test=base.extend<{harness:Harness},{serverHarness:Harness}>({
 serverHarness:[async({},use)=>{
  const baseline=process.env.EDGELAB_INPUT_ENUM91_BASELINE==="1";
  const assets=path.join(root,baseline?".artifacts/pine-input-enum91-baseline-assets":"frontend/dist/assets"),workerName=fs.readdirSync(assets).find(name=>/^pine-native-worker.*\.js$/.test(name));
  if(!workerName)throw new Error("Build the genuine production worker before this suite.");
  const workerPath="/assets/"+workerName,worker=fs.readFileSync(path.join(assets,workerName)),workerRequests:string[]=[];
  const bundle=(await build({entryPoints:[path.join(root,"e2e/pine-input-enum91.fixture.tsx")],bundle:true,minify:true,write:false,format:"iife",jsx:"automatic",platform:"browser",define:{"import.meta.env":"{}"},
   plugins:[{name:"actual-production-worker",setup(builder){
    builder.onResolve({filter:/^virtual:pine-worker-url$/},()=>({path:"worker",namespace:"enum91"}));
    builder.onLoad({filter:/.*/,namespace:"enum91"},()=>({contents:"export default "+JSON.stringify(workerPath),loader:"js"}));
   }}]})).outputFiles[0].contents;
  const css=fs.readdirSync(assets).filter(name=>name.endsWith(".css")).map(name=>fs.readFileSync(path.join(assets,name))).join("\n");
  fs.mkdirSync(path.join(root,".artifacts"),{recursive:true});
  fs.writeFileSync(path.join(root,".artifacts/pine-input-enum91-"+(baseline?"baseline":"final")+"-assets.json"),JSON.stringify({
   worker:workerName,workerSha256:createHash("sha256").update(worker).digest("hex"),fixtureSha256:createHash("sha256").update(bundle).digest("hex")
  }));
  const server=http.createServer((req,res)=>{
   const url=new URL(req.url??"/","http://127.0.0.1");res.setHeader("Cache-Control","no-store");
   if(url.pathname==="/"){res.setHeader("Content-Type","text/html");res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');}
   else if(url.pathname==="/fixture.js"){res.setHeader("Content-Type","text/javascript");res.end(bundle);}
   else if(url.pathname==="/fixture.css"){res.setHeader("Content-Type","text/css");res.end(css);}
   else if(url.pathname===workerPath){workerRequests.push(workerPath);res.setHeader("Content-Type","text/javascript");res.end(worker);}
   else{res.statusCode=404;res.end();}
  });
  await new Promise<void>(resolve=>server.listen(45192,"127.0.0.1",resolve));
  try{await use({origin:"http://127.0.0.1:45192",workerRequests});}finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
 },{scope:"worker"}],
 harness:async({page,serverHarness},use)=>{serverHarness.workerRequests.length=0;await page.goto(serverHarness.origin);await use(serverHarness);}
});
const modernOnly=()=>test.skip(process.env.EDGELAB_INPUT_ENUM91_BASELINE==="1");
async function prepare(page,code){return page.evaluate(code=>window.pineInputEnumFixture.prepare(code),code);}
const direction=page=>page.getByRole("combobox",{name:"Direction",exact:true});
const current=page=>page.evaluate(()=>window.pineInputEnumFixture.current);
const run=page=>page.evaluate(bars=>window.pineInputEnumFixture.run(bars),bars);
test("baseline enum alias renders editable free text rather than dropdown choices",async({page,harness})=>{
 test.skip(process.env.EDGELAB_INPUT_ENUM91_BASELINE!=="1");const prepared=await prepare(page,source(aliasBody));
 expect(prepared.inputDefinitions[0].options).toBeUndefined();
 await expect(page.getByRole("textbox",{name:"Direction",exact:true})).toHaveValue("Up");
 await expect(direction(page)).toHaveCount(0);expect(harness.workerRequests).toHaveLength(1);
});

test("v5 and v6 alias enums render genuine choices and preserve selected values through validated saved remount and Run",async({page,harness})=>{
 modernOnly();
 for(const version of [5,6]){
  const code=source(aliasBody,version),prepared=await prepare(page,code),ids=prepared.inputDefinitions.map(d=>d.id);
  await expect(direction(page)).toHaveValue("Up");await expect(direction(page).locator("option")).toHaveText(["Up","Down","Flat"]);
  await expect(page.getByRole("textbox",{name:"Direction",exact:true})).toHaveCount(0);
  const requests=harness.workerRequests.length;await direction(page).selectOption("Down");
  await page.evaluate(()=>window.pineInputEnumFixture.savedRemount());await expect(direction(page)).toHaveValue("Down");expect(harness.workerRequests).toHaveLength(requests);
  const result=await run(page);expect(result.source).toBe(code);expect(result.inputDefinitions.map(d=>d.id)).toEqual(ids);
  expect(result.inputs[ids[0]]).toBe("Down");expect(result.plots[0].points.map(p=>p.value)).toEqual(Array(4).fill(-1));
  await direction(page).selectOption("Flat");const flat=await run(page);expect(flat.plots[0].points.map(p=>p.value)).toEqual(Array(4).fill(0));
  await page.evaluate(()=>window.pineInputEnumFixture.savedRemount());await expect(direction(page)).toHaveValue("Flat");
 }
});
test("aliased subsets retain order constrain genuine runtime overrides and recover with a valid choice",async({page,harness},info)=>{
 modernOnly();const code=source(declaration+'const Side falling=Side.down\nconst Side neutral=Side.flat\nconst Side defaultChoice=true?neutral:falling\nchoice=input.enum(defaultChoice,"Direction",options=[neutral,falling])\nplot(choice==Side.down?-1:0,"Signal")');
 const prepared=await prepare(page,code),id=prepared.inputDefinitions[0].id;
 await expect(direction(page)).toHaveValue("Flat");await expect(direction(page).locator("option")).toHaveText(["Flat","Down"]);
 await direction(page).selectOption("Down");const requests=harness.workerRequests.length;
 await page.evaluate(()=>window.pineInputEnumFixture.savedRemount());await expect(direction(page)).toHaveValue("Down");expect(harness.workerRequests).toHaveLength(requests);
 await page.evaluate(id=>window.pineInputEnumFixture.stageInput(id,"Up"),id);
 await expect(direction(page)).toHaveValue("Up");await expect(direction(page).locator("option:checked")).toHaveText("Choose a valid option");
 expect(await direction(page).locator("option:checked").evaluate((option:HTMLOptionElement)=>option.disabled&&option.matches(":disabled"))).toBe(true);expect((await current(page)).inputs[id]).toBe("Up");
 const failure=await page.evaluate(async bars=>{try{await window.pineInputEnumFixture.run(bars);return null}catch(error){return String(error)}},bars);
 expect(failure).toMatch(/declared option|input/i);await expect(page.getByRole("alert")).toBeVisible();expect((await current(page)).result).toBeNull();expect((await current(page)).inputs[id]).toBe("Up");
 await expect(direction(page)).toHaveValue("Up");
 await direction(page).selectOption("Down");const result=await run(page);expect(result.inputs[id]).toBe("Down");
 expect(result.plots[0].points.map(p=>p.value)).toEqual(Array(4).fill(-1));await expect(page.getByRole("alert")).toHaveCount(0);
 await expect(direction(page).locator("option")).toHaveText(["Flat","Down"]);
 await page.evaluate(()=>window.pineInputEnumFixture.savedRemount());await expect(direction(page)).toHaveValue("Down");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:path.join(root,".artifacts/pine-input-enum91-"+info.project.name+".png"),fullPage:true,animations:"disabled"});
});
test("legacy enum metadata upgrades through the real worker without replacing the user's selected value",async({page,harness})=>{
 modernOnly();const prepared=await prepare(page,source(aliasBody));await expect(direction(page)).toHaveValue("Up");await direction(page).selectOption("Down");
 const requests=harness.workerRequests.length;await page.evaluate(()=>window.pineInputEnumFixture.loadLegacy());
 await expect.poll(()=>harness.workerRequests.length).toBe(requests+1);
 await expect.poll(async()=>((await current(page)).definitions[0]?.options??[])).toEqual(["Up","Down","Flat"]);
 await expect(direction(page)).toHaveValue("Down");expect((await current(page)).definitions.map(d=>d.id)).toEqual(prepared.inputDefinitions.map(d=>d.id));
 await page.evaluate(()=>window.pineInputEnumFixture.savedRemount());await expect(direction(page)).toHaveValue("Down");expect(harness.workerRequests).toHaveLength(requests+1);
 const result=await run(page);expect(result.plots[0].points.map(p=>p.value)).toEqual(Array(4).fill(-1));
});
test("cancelled held legacy enum refresh cannot restore metadata or defaults over a newer source",async({page,harness})=>{
 modernOnly();await prepare(page,source(aliasBody));await expect(direction(page)).toHaveValue("Up");let release,held=false;
 const gate=new Promise<void>(resolve=>release=resolve);let holdNext=true;
 await page.route("**/assets/pine-native-worker*.js",async route=>{
  if(holdNext){holdNext=false;held=true;await gate;}try{await route.continue();}catch{ /* A cancelled refresh can abandon its fetch. */ }
 });
 await page.evaluate(()=>window.pineInputEnumFixture.loadLegacy());await expect.poll(()=>held).toBe(true);
 await page.evaluate(()=>window.pineInputEnumFixture.metadataMounted(false));await expect(direction(page)).toHaveCount(0);
 await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
 const newer=source(declaration+'const Side alias=Side.flat\nchoice=input.enum(alias,"Direction",options=[Side.down,Side.flat])\nplot(choice==Side.flat?0:-1)');
 await prepare(page,newer);release();await page.evaluate(()=>window.pineInputEnumFixture.metadataMounted(true));
 await expect(direction(page)).toHaveValue("Flat");await expect(direction(page).locator("option")).toHaveText(["Down","Flat"]);
 await expect.poll(()=>page.evaluate(()=>window.pineInputEnumFixture.current.metadata?.source)).toBe(newer);
 await page.evaluate(()=>window.pineInputEnumFixture.savedRemount());await expect(direction(page)).toHaveValue("Flat");
 await expect(page.getByRole("alert")).toHaveCount(0);await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
});
