import {pineChoose,pineLabel,pineOptions} from "./support/pine-select130";
import {test as base,expect} from "@playwright/test";
import {build} from "esbuild";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import {createHash} from "node:crypto";
declare global{interface Window{pineEnumIdentityFixture:any}}
const root=path.resolve(import.meta.dirname,".."),bars=JSON.parse(fs.readFileSync(path.join(root,"e2e/pine-visuals.bars.json"),"utf8")).slice(0,4);
const source=(body:string,version=6)=>"//@version="+version+'\nindicator("Enums91")\n'+body;
const declaration='enum Side\n    up = "Up"\n    down = "Down"\n    flat = "Flat"\n';
const aliasBody=declaration+'const Side alias = Side.up\nchoice=input.enum(alias,"Direction")\nplot(choice==Side.up?1:choice==Side.down?-1:0,"Signal")';
type Harness={origin:string,workerRequests:string[]};
const test=base.extend<{harness:Harness},{serverHarness:Harness}>({
 serverHarness:[async({},use)=>{
  const baseline=process.env.EDGELAB_ENUM_IDENTITY93_BASELINE==="1";
  const assets=path.join(root,baseline?".artifacts/pine-enum-identity93-baseline-assets":"frontend/dist/assets"),workerName=fs.readdirSync(assets).find(name=>/^pine-native-worker.*\.js$/.test(name));
  if(!workerName)throw new Error("Build the genuine production worker before this suite.");
  const workerPath="/assets/"+workerName,worker=fs.readFileSync(path.join(assets,workerName)),workerRequests:string[]=[];
  const bundle=(await build({entryPoints:[path.join(root,"e2e/pine-enum-identity93.fixture.tsx")],bundle:true,minify:true,write:false,format:"iife",jsx:"automatic",platform:"browser",define:{"import.meta.env":"{}"},
   plugins:[{name:"actual-production-worker",setup(builder){
    builder.onResolve({filter:/^virtual:pine-worker-url$/},()=>({path:"worker",namespace:"identity93"}));
    builder.onLoad({filter:/.*/,namespace:"identity93"},()=>({contents:"export default "+JSON.stringify(workerPath),loader:"js"}));
   }}]})).outputFiles[0].contents;
  const css=fs.readdirSync(assets).filter(name=>name.endsWith(".css")).map(name=>fs.readFileSync(path.join(assets,name))).join("\n");
  fs.mkdirSync(path.join(root,".artifacts"),{recursive:true});
  fs.writeFileSync(path.join(root,".artifacts/pine-enum-identity93-"+(baseline?"baseline":"final")+"-assets.json"),JSON.stringify({
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
  await new Promise<void>(resolve=>server.listen(45194,"127.0.0.1",resolve));
  try{await use({origin:"http://127.0.0.1:45194",workerRequests});}finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
 },{scope:"worker"}],
 harness:async({page,serverHarness},use)=>{serverHarness.workerRequests.length=0;await page.goto(serverHarness.origin);await page.waitForFunction(()=>Boolean(window.pineEnumIdentityFixture?.current));const errors:string[]=[];page.on("pageerror",error=>errors.push(String(error)));await use(serverHarness);expect(errors).toEqual([]);}
});
const modernOnly=()=>test.skip(process.env.EDGELAB_ENUM_IDENTITY93_BASELINE==="1");
async function prepare(page,code){return page.evaluate(code=>window.pineEnumIdentityFixture.prepare(code),code);}
const direction=page=>page.getByRole("combobox",{name:"Direction",exact:true});
const current=page=>page.evaluate(()=>window.pineEnumIdentityFixture.current);
const run=page=>page.evaluate(bars=>window.pineEnumIdentityFixture.run(bars),bars);
test("baseline duplicate enum labels collapse distinct member selections to the same native output",async({page,harness},info)=>{
 test.skip(process.env.EDGELAB_ENUM_IDENTITY93_BASELINE!=="1");
 const code=source('enum Choice\n    first="Same"\n    second="Same"\n    third="Unique"\nconst Choice initial=Choice.second\nchoice=input.enum(initial,"Choice")\nsecondOnly=input.int(4,"Second only",active=choice==Choice.second)\nplot(choice==Choice.first?1:choice==Choice.second?2:3,"Signal")');
 const metadata=await prepare(page,code),choice=page.getByRole("combobox",{name:"Choice",exact:true});
 await pineOptions(choice,["Same","Same","Unique"]);await pineLabel(choice,"Same");
 const first=await run(page);expect(first.plots[0].points.map(p=>p.value)).toEqual(Array(4).fill(1));
 await pineChoose(choice,"Same",1);const second=await run(page);expect(second.inputs.in_0).toBe("Same");expect(second.plots[0].points.map(p=>p.value)).toEqual(Array(4).fill(1));
 fs.writeFileSync(path.join(root,".artifacts/pine-enum-identity93-baseline-"+info.project.name+".json"),JSON.stringify({source:code,metadata,first:first.plots[0].points,second:second.plots[0].points},null,2));
});

const choicesBody='enum Choice\n    first="Same"\n    second="Same"\n    third="Unique"\nconst Choice initial=Choice.second\nchoice=input.enum(initial,"Choice")\nsecondOnly=input.int(4,"Second only",active=choice==Choice.second)\nplot(choice==Choice.first?1:choice==Choice.second?2:3,"Signal")';
const collisionBody='enum Choice\n    first="Choice.second"\n    second="Other"\nchoice=input.enum(Choice.first,"Choice")\nother=input.enum(Choice.second,"Other choice")\nplot(choice==Choice.first?1:2,"Signal")';
const choiceControl=page=>page.getByRole("combobox",{name:"Choice",exact:true});
const signals=result=>result.plots[0].points.map(point=>point.value);
async function loadLegacy(page,code,inputs,show=true){return page.evaluate(({code,inputs,show})=>window.pineEnumIdentityFixture.loadLegacy(code,inputs,show),{code,inputs,show});}
async function remount(page){return page.evaluate(()=>window.pineEnumIdentityFixture.remount());}
async function expectMigrated(page,value){await expect.poll(async()=>{const state=await current(page);return[state.prepared?.inputDefinitions[0]?.enumVersion,state.inputs.in_0];}).toEqual([1,value]);}
test("v5/v6 identical titles retain distinct native member IDs, activation and saved remount",async({page,harness},info)=>{
 modernOnly();
 for(const version of [5,6]){
  const metadata=await prepare(page,source(choicesBody,version)),choice=choiceControl(page),dependent=page.getByRole("spinbutton",{name:"Second only",exact:true});
  expect(metadata.inputDefinitions[0].defval).toBe("Choice.second");
  await pineOptions(choice,["Same","Same","Unique"]);await pineLabel(choice,"Same");await expect(dependent).toBeEnabled();
  expect(signals(await run(page))).toEqual(Array(4).fill(2));const requests=harness.workerRequests.length;
  await pineChoose(choice,"Same",0);await expect(dependent).toBeDisabled();expect(harness.workerRequests.length).toBe(requests);
  expect(signals(await run(page))).toEqual(Array(4).fill(1));
  await pineChoose(choice,"Unique",0);expect(signals(await run(page))).toEqual(Array(4).fill(3));
  await pineChoose(choice,"Same",1);const saved=await remount(page);expect(saved.inputs.in_0).toBe("Choice.second");expect(saved.prepared.inputDefinitions[0].enumVersion).toBe(1);
  await pineLabel(choiceControl(page),"Same");await expect(page.getByRole("spinbutton",{name:"Second only",exact:true})).toBeEnabled();
  expect(signals(await run(page))).toEqual(Array(4).fill(2));
 }
 const bounds=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,fields:[...document.querySelectorAll('button[role="combobox"],input')].map(el=>{const rect=el.getBoundingClientRect();return {left:rect.left,right:rect.right};})}));
 expect(bounds.document).toBeLessThanOrEqual(bounds.width);for(const field of bounds.fields){expect(field.left).toBeGreaterThanOrEqual(0);expect(field.right).toBeLessThanOrEqual(bounds.width);}
 await page.screenshot({path:path.join(root,".artifacts/pine-enum-identity93-final-"+info.project.name+".png"),animations:"disabled",fullPage:true});
});
test("proved unique legacy labels migrate atomically; label equal to another ID is never ID-first",async({page,harness})=>{
 modernOnly();await loadLegacy(page,source(choicesBody),{in_0:"Unique",in_1:9});await expectMigrated(page,"Choice.third");
 await pineLabel(choiceControl(page),"Unique");expect((await current(page)).inputs.in_1).toBe(9);expect(signals(await run(page))).toEqual(Array(4).fill(3));
 await remount(page);await pineLabel(choiceControl(page),"Unique");expect(signals(await run(page))).toEqual(Array(4).fill(3));
 await loadLegacy(page,source(collisionBody),{in_0:"Choice.second",in_1:"Other"});await expectMigrated(page,"Choice.first");await pineLabel(choiceControl(page),"Choice.second");
 const proof=await page.evaluate(()=>window.pineEnumIdentityFixture.renderProof);expect(proof.length).toBeGreaterThan(0);expect(proof[0]).toEqual({saved:{in_0:"Choice.second",in_1:"Other"},effective:{in_0:"Choice.first",in_1:"Choice.second"},selectedLabels:["Choice.second","Other"]});
 expect((await current(page)).inputs.in_1).toBe("Choice.second");expect(signals(await run(page))).toEqual(Array(4).fill(1));const requests=harness.workerRequests.length;await remount(page);await pineLabel(choiceControl(page),"Choice.second");
 expect(harness.workerRequests.length).toBe(requests);expect(signals(await run(page))).toEqual(Array(4).fill(1));
 const ownIdLabel=source(collisionBody.replace('first="Choice.second"','first="Choice.first"'));
 await loadLegacy(page,ownIdLabel,{in_0:"Choice.first",in_1:"Other"});await expectMigrated(page,"Choice.first");
 const savedSameValue=await remount(page);expect(savedSameValue.inputs.in_0).toBe("Choice.first");expect(savedSameValue.prepared.inputDefinitions[0].enumVersion).toBe(1);expect(signals(await run(page))).toEqual(Array(4).fill(1));
});
test("ambiguous and unknown legacy titles remain invalid with recovery until explicit ID selection",async({page,harness})=>{
 modernOnly();
 for(const original of ["Same","Choice.second"]){
  await loadLegacy(page,source(choicesBody),{in_0:original,in_1:7});await expectMigrated(page,"");
  await pineLabel(choiceControl(page),"Choose a valid option");await expect(choiceControl(page)).toHaveAttribute("aria-invalid","true");await expect(choiceControl(page)).toHaveAccessibleDescription(/needs reselection/);await pineOptions(choiceControl(page),["Same","Same","Unique"]);
  await expect(page.getByRole("alert")).toHaveText('Saved choice “'+original+'” needs reselection. Choose a valid option.');
  expect((await current(page)).recovery.in_0).toBe(original);
  const failed=await run(page).catch(error=>String(error));expect(failed).toMatch(/INVALID_INPUT|must match a declared option/i);expect((await current(page)).result).toBeNull();
  await remount(page);await pineLabel(choiceControl(page),"Choose a valid option");expect((await current(page)).recovery.in_0).toBe(original);
  await page.evaluate(()=>window.pineEnumIdentityFixture.corruptRecovery());await pineLabel(choiceControl(page),"Choose a valid option");await expect(choiceControl(page)).toHaveAttribute("aria-invalid","true");await expect(page.getByText(/needs reselection/)).toHaveCount(0);
  await pineChoose(choiceControl(page),"Same",1);await expect(choiceControl(page)).toHaveAttribute("aria-invalid","false");expect((await current(page)).recovery).toEqual({});await expect(page.getByText(/needs reselection/)).toHaveCount(0);
  expect(signals(await run(page))).toEqual(Array(4).fill(2));await remount(page);await pineLabel(choiceControl(page),"Same");
 }
});
test("snapshot and persistent live ingress migrate saved labels before any input controls open",async({page,harness})=>{
 modernOnly();
 for(const [body,saved,expected] of [[choicesBody,"Unique",3],[collisionBody,"Choice.second",1]]){
  await loadLegacy(page,source(body),{in_0:saved},false);await expect(choiceControl(page)).toHaveCount(0);expect((await current(page)).prepared.inputDefinitions[0].enumVersion).toBeUndefined();
  const receipt=await page.evaluate(bars=>window.pineEnumIdentityFixture.ingress(bars),bars);
  for(const name of ["snapshot","initial"]){expect(signals(receipt[name])).toEqual(Array(4).fill(expected));expect(receipt[name].inputs.in_0).toBe(expected===3?"Choice.third":"Choice.first");}
  for(const name of ["provisional","confirmed"]){expect(signals(receipt[name])).toEqual(Array(5).fill(expected));expect(receipt[name].inputs.in_0).toBe(expected===3?"Choice.third":"Choice.first");}
  await expect(choiceControl(page)).toHaveCount(0);await expect.poll(()=>page.locator("iframe").count()).toBe(0);
 }
});
