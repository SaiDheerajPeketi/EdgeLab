import {pineChoose,pineLabel,pineOptions} from "./support/pine-select130";
import {test as base,expect} from "@playwright/test";
import {build} from "esbuild";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import {createHash} from "node:crypto";
declare global{interface Window{pineInputActiveFixture:any}}
const root=path.resolve(import.meta.dirname,".."),bars=JSON.parse(fs.readFileSync(path.join(root,"e2e/pine-visuals.bars.json"),"utf8")).slice(0,4);
const source=(body:string,version=6)=>"//@version="+version+'\nindicator("Activation89")\n'+body;
const simple='enabled=input.bool(false,"Enable")\nlength=input.int(4,"Length",minval=1,maxval=9,active=enabled)\nplot(length,"Output")';
type Harness={origin:string,workerRequests:string[]};
const test=base.extend<{harness:Harness},{serverHarness:Harness}>({
 serverHarness:[async({},use)=>{
  const assets=path.join(root,"frontend/dist/assets"),workerName=fs.readdirSync(assets).find(name=>/^pine-native-worker.*\.js$/.test(name));
  if(!workerName)throw new Error("Build the genuine production worker before this suite.");
  const workerPath="/assets/"+workerName,worker=fs.readFileSync(path.join(assets,workerName)),workerRequests:string[]=[];
  const bundle=(await build({entryPoints:[path.join(root,"e2e/pine-input-active89.fixture.tsx")],bundle:true,minify:true,write:false,format:"iife",jsx:"automatic",platform:"browser",define:{"import.meta.env":"{}"},
   plugins:[{name:"actual-production-worker",setup(builder){
    builder.onResolve({filter:/^virtual:pine-worker-url$/},()=>({path:"worker",namespace:"active89"}));
    builder.onLoad({filter:/.*/,namespace:"active89"},()=>({contents:"export default "+JSON.stringify(workerPath),loader:"js"}));
   }}]})).outputFiles[0].contents;
  const css=fs.readdirSync(assets).filter(name=>name.endsWith(".css")).map(name=>fs.readFileSync(path.join(assets,name))).join("\n");
  fs.mkdirSync(path.join(root,".artifacts"),{recursive:true});
  fs.writeFileSync(path.join(root,".artifacts/pine-input-active89-"+(process.env.EDGELAB_INPUT_ACTIVE89_BASELINE==="1"?"baseline":"final")+"-assets.json"),JSON.stringify({
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
  await new Promise<void>(resolve=>server.listen(45191,"127.0.0.1",resolve));
  try{await use({origin:"http://127.0.0.1:45191",workerRequests});}finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
 },{scope:"worker"}],
 harness:async({page,serverHarness},use)=>{serverHarness.workerRequests.length=0;await page.goto(serverHarness.origin);await use(serverHarness);}
});
async function prepare(page,code){const result=await page.evaluate(code=>window.pineInputActiveFixture.prepare(code),code);await expect(page.getByRole("checkbox",{name:"Enable",exact:true})).toBeVisible();return result;}
const current=page=>page.evaluate(()=>window.pineInputActiveFixture.current);
test("baseline dependent controls remain disabled after toggling their controlling input",async({page,harness})=>{
 test.skip(process.env.EDGELAB_INPUT_ACTIVE89_BASELINE!=="1");await prepare(page,source(simple));
 await expect(page.getByRole("spinbutton",{name:"Length",exact:true})).toBeDisabled();
 await page.getByRole("checkbox",{name:"Enable",exact:true}).check();
 await expect(page.getByRole("spinbutton",{name:"Length",exact:true})).toBeDisabled();
 expect(harness.workerRequests).toHaveLength(1);
});

const modernOnly=()=>test.skip(process.env.EDGELAB_INPUT_ACTIVE89_BASELINE==="1");
const length=page=>page.getByRole("spinbutton",{name:"Length",exact:true});
const enabled=page=>page.getByRole("checkbox",{name:"Enable",exact:true});
const run=page=>page.evaluate(bars=>window.pineInputActiveFixture.run(bars),bars);
test("v5 and v6 controlling checkboxes activate instantly while staged disabled values survive remount and Run",async({page,harness})=>{
 modernOnly();
 for(const version of [5,6]){
  const prepared=await prepare(page,source(simple,version)),ids=prepared.inputDefinitions.map(d=>d.id),requests=harness.workerRequests.length;
  await expect(length(page)).toBeDisabled();await expect(length(page)).toHaveValue("4");
  await enabled(page).check();await expect(length(page)).toBeEnabled();expect(harness.workerRequests).toHaveLength(requests);
  await length(page).fill("7");await enabled(page).uncheck();await expect(length(page)).toBeDisabled();await expect(length(page)).toHaveValue("7");
  await page.evaluate(()=>window.pineInputActiveFixture.remount());await expect(length(page)).toBeDisabled();await expect(length(page)).toHaveValue("7");
  expect(harness.workerRequests).toHaveLength(requests);
  const output=await run(page);expect(output.inputDefinitions.map(d=>d.id)).toEqual(ids);
  expect(output.inputDefinitions.find(d=>d.title==="Length").active).toBe(false);
  expect(output.plots[0].points.map(p=>p.value)).toEqual(Array(4).fill(7));
  await expect(length(page)).toHaveValue("7");await enabled(page).check();await expect(length(page)).toBeEnabled();
 }
});
test("string choices numeric comparisons aliases and ternaries respond immediately without another worker run",async({page,harness},info)=>{
 modernOnly();
 const code=source('enabled=input.bool(false,"Enable")\nmode=input.string("Basic","Mode",options=["Basic","Advanced"])\ncount=input.int(2,"Count",minval=0,maxval=10)\ndivisor=input.int(2,"Divisor",minval=0,maxval=10)\nexpert=mode=="Advanced"\nbase=expert and count>=3\nbranch=enabled ? count%2==0 : expert\nlength=input.int(4,"Length",minval=1,maxval=9,active=base)\nflag=input.bool(true,"Dependent flag",active=branch)\nchoice=input.string("A","Dependent choice",options=["A","B"],active=enabled)\nquotient=input.int(6,"Quotient",active=count/divisor>2)\nplot(length,"Output")');
 await prepare(page,code);const requests=harness.workerRequests.length;
 const mode=page.getByRole("combobox",{name:"Mode",exact:true}),count=page.getByRole("spinbutton",{name:"Count",exact:true}),
  flag=page.getByRole("checkbox",{name:"Dependent flag",exact:true}),choice=page.getByRole("combobox",{name:"Dependent choice",exact:true});
 await expect(length(page)).toBeDisabled();await expect(flag).toBeDisabled();await expect(flag).toBeChecked();await expect(choice).toBeDisabled();
 await pineChoose(mode,"Advanced");await expect(flag).toBeEnabled();await expect(length(page)).toBeDisabled();
 await count.fill("3");await expect(length(page)).toBeEnabled();await length(page).fill("8");await flag.uncheck();
 await enabled(page).check();await expect(flag).toBeDisabled();await expect(choice).toBeEnabled();await pineChoose(choice,"B");
 await count.fill("8");await expect(flag).toBeEnabled();
 const quotient=page.getByRole("spinbutton",{name:"Quotient",exact:true});await expect(quotient).toBeEnabled();await quotient.fill("9");
 await page.getByRole("spinbutton",{name:"Divisor",exact:true}).fill("0");await expect(quotient).toBeDisabled();await expect(quotient).toHaveValue("9");await expect(flag).not.toBeChecked();
 await enabled(page).uncheck();await expect(choice).toBeDisabled();await pineLabel(choice,"B");
 await pineChoose(mode,"Basic");await expect(length(page)).toBeDisabled();await expect(length(page)).toHaveValue("8");
 await expect(flag).toBeDisabled();await expect(flag).not.toBeChecked();
 await page.evaluate(()=>window.pineInputActiveFixture.remount());await pineLabel(choice,"B");await expect(length(page)).toHaveValue("8");
 expect(harness.workerRequests).toHaveLength(requests);expect((await current(page)).result).toBeNull();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:path.join(root,".artifacts/pine-input-active89-"+info.project.name+".png"),fullPage:true,animations:"disabled"});
});
test("fresh metadata is reused while validated legacy snapshots upgrade through the genuine worker without losing edits",async({page,harness})=>{
 modernOnly();const prepared=await prepare(page,source(simple));await enabled(page).check();await length(page).fill("7");
 const requests=harness.workerRequests.length;await page.evaluate(()=>window.pineInputActiveFixture.remount());
 expect(harness.workerRequests).toHaveLength(requests);
 await page.evaluate(()=>window.pineInputActiveFixture.loadLegacy());
 await expect.poll(()=>harness.workerRequests.length).toBe(requests+1);
 await expect.poll(async()=>Boolean((await current(page)).definitions.find(d=>d.title==="Length")?.activeCondition)).toBe(true);
 await expect(enabled(page)).toBeChecked();await expect(length(page)).toBeEnabled();await expect(length(page)).toHaveValue("7");
 expect((await current(page)).definitions.map(d=>d.id)).toEqual(prepared.inputDefinitions.map(d=>d.id));
 await enabled(page).uncheck();await expect(length(page)).toBeDisabled();await expect(length(page)).toHaveValue("7");
 expect(harness.workerRequests).toHaveLength(requests+1);
});
test("unmount cancels a held legacy metadata refresh and a newer source keeps its own defaults",async({page,harness})=>{
 modernOnly();await prepare(page,source(simple));let release,held=false;
 const gate=new Promise<void>(resolve=>release=resolve);let holdNext=true;
 await page.route("**/assets/pine-native-worker*.js",async route=>{
  if(holdNext){holdNext=false;held=true;await gate;}try{await route.continue();}catch{ /* The cancelled fetch may already be gone. */ }
 });
 await page.evaluate(()=>window.pineInputActiveFixture.loadLegacy());await expect.poll(()=>held).toBe(true);
 await page.evaluate(()=>window.pineInputActiveFixture.metadataMounted(false));
 await expect(page.getByRole("checkbox",{name:"Enable",exact:true})).toHaveCount(0);await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
 const newSource=source(simple.replace('input.bool(false','input.bool(true').replace('input.int(4','input.int(8'));
 await page.evaluate(code=>window.pineInputActiveFixture.prepare(code),newSource);
 release();await page.evaluate(()=>window.pineInputActiveFixture.metadataMounted(true));
 await expect(enabled(page)).toBeChecked();await expect(length(page)).toBeEnabled();await expect(length(page)).toHaveValue("8");
 await expect.poll(()=>page.evaluate(()=>window.pineInputActiveFixture.current.metadata?.source)).toBe(newSource);
 await page.evaluate(()=>window.pineInputActiveFixture.remount());await expect(length(page)).toHaveValue("8");
 await expect(page.getByRole("alert")).toHaveCount(0);await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
});
