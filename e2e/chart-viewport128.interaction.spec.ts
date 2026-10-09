import {expect,test,type Page} from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {bars} from "./support/replay-context";
import {productSetup,checkedRun} from "./pine-layering.product-support";

const root=path.resolve(".artifacts/chart-viewport128");
function folder(project:string){const dir=path.join(root,project);fs.mkdirSync(dir,{recursive:true});return dir;}
async function ready(page:Page){
 const state=await productSetup(page);
 await expect(page.getByRole("region",{name:"BTCUSDT 5m chart",exact:true})).toContainText(/Latest bar: open [0-9]/);
 return state;
}
async function measure(page:Page){
 return page.evaluate(()=>{
  const surface=document.querySelector(".chart-container-surface")!, frame=surface.closest(".chart-frame")!;
  const rect=(el:Element)=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
  const pixels=(canvas:HTMLCanvasElement,color:number[])=>{const context=canvas.getContext("2d");if(!context)return 0;const data=context.getImageData(0,0,canvas.width,canvas.height).data;let count=0;for(let i=0;i<data.length;i+=4)if(data[i]===color[0]&&data[i+1]===color[1]&&data[i+2]===color[2]&&data[i+3]>0)count++;return count;};
  const canvases=[...surface.querySelectorAll("canvas")];
  const central=canvases.filter(c=>{const r=c.getBoundingClientRect();return r.width>100&&r.height>80;});
  const axes=canvases.filter(c=>{const r=c.getBoundingClientRect();return r.width>100&&r.height>=8&&r.height<=60;});
  const nav=document.querySelector('nav[aria-label="Primary workspace"]');const nr=nav?.getBoundingClientRect();
  const navVisible=!document.querySelector(".chart-fullscreen-shell")&&nav&&nr&&getComputedStyle(nav).position==="fixed"&&getComputedStyle(nav).display!=="none"&&nr.height>0&&(!document.fullscreenElement||document.fullscreenElement.contains(nav));
  return {viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},scrollY,bottom:navVisible?Math.min(innerHeight,nr!.top):innerHeight,frame:rect(frame),price:central.map(rect),timeAxis:axes.map(rect),candles:{up:central.reduce((n,c)=>n+pixels(c,[34,197,94]),0),down:central.reduce((n,c)=>n+pixels(c,[251,113,133]),0)},axisInk:axes.reduce((n,c)=>n+pixels(c,[168,179,199]),0),overflow:document.documentElement.scrollWidth-innerWidth};
 });
}
async function fit(page:Page){
 let m:Awaited<ReturnType<typeof measure>>|undefined;let previous:string|undefined;
 await expect.poll(async()=>{
  const current=await measure(page);
  const valid=current.frame.y>=-.5&&current.frame.bottom<=current.bottom+.5&&current.frame.right<=current.viewport.width+.5&&[...current.price,...current.timeAxis].every(r=>r.x>=-.5&&r.y>=-.5&&r.bottom<=current.bottom+.5&&r.right<=current.viewport.width+.5)&&current.candles.up>20&&current.candles.down>20&&current.axisInk>10;
  const signature=JSON.stringify([current.frame,current.price,current.timeAxis,current.bottom]);const settled=valid&&signature===previous;previous=signature;if(settled)m=current;return settled;
 }).toBe(true);
 // Use the same successful bounds-and-ink snapshot; resize observers may update between reads.
 expect(m!.price.length).toBeGreaterThan(0);expect(m!.timeAxis.length).toBeGreaterThan(0);
 expect(m!.frame.height).toBeGreaterThanOrEqual(160);expect(m!.frame.height).toBeLessThanOrEqual(860);expect(m!.overflow).toBe(0);return m!;
}
async function visibleControl(page:Page,selector:string,container:string){
 const proof=await page.locator(selector).evaluate((el,parentSelector)=>{
  const r=el.getBoundingClientRect(),p=el.closest(parentSelector)!.getBoundingClientRect();
  const heights={height:r.height,parentHeight:p.height,visibleHeight:Math.max(0,Math.min(r.bottom,p.bottom,innerHeight)-Math.max(r.top,p.top,0))};
  const hit=[r.top+2,r.top+r.height/2,r.bottom-2].map(y=>{const node=document.elementFromPoint(r.left+r.width/2,y);return node===el||!!node&&el.contains(node);});
  return{...heights,hit};
 },container);
 expect(proof.height).toBeGreaterThanOrEqual(36);expect(proof.visibleHeight).toBeGreaterThanOrEqual(proof.height-.5);expect(proof.hit).toEqual([true,true,true]);return proof;
}
async function tools(page:Page){await page.locator('[data-chart-header-control="tools"]').first().click();await expect(page.locator(".chart-studio-toolbar")).toBeVisible();}
async function restoreTop(page:Page){await page.evaluate(()=>scrollTo({top:0,left:0,behavior:"instant"}));await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);}
async function group(page:Page,name:string){const trigger=page.locator(".chart-studio-toolbar").getByRole("button",{name,exact:true});await trigger.click();const dialog=page.locator('[id="'+await trigger.getAttribute("aria-controls")+'"]');await expect(dialog).toBeVisible();return{trigger,dialog};}

test.afterEach(async({page},info)=>{
 if(info.status===info.expectedStatus)return;
 const dir=folder(info.project.name);const stem=info.title.startsWith("whole")?"fit-failure":"reachable-failure";
 await page.screenshot({path:path.join(dir,stem+".png"),animations:"disabled"});
 fs.writeFileSync(path.join(dir,stem+".json"),JSON.stringify({geometry:await measure(page),error:info.error},null,2));
});
test("whole price plot and time axis fit initially, with Tools, and after resize",async({page},info)=>{
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await ready(page);
 await expect(page.locator(".chart-studio-toolbar")).toHaveCount(0);const initial=await fit(page);expect(initial.scrollY).toBe(0);
 const dir=folder(info.project.name);await page.screenshot({path:path.join(dir,"initial-full-chart.png"),animations:"disabled"});
 await tools(page);const open=await fit(page);expect(open.scrollY).toBe(0);
 await page.screenshot({path:path.join(dir,"tools-full-chart.png"),animations:"disabled"});
 const original=page.viewportSize()!;const rotated={width:original.height,height:original.width};await page.setViewportSize(rotated);
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))));const rotatedMeasure=await measure(page);
 // The 160px readable plot floor may require deliberate scrolling in landscape.
 if(rotatedMeasure.frame.bottom>rotatedMeasure.bottom){
  await page.evaluate(({bottom,usable})=>scrollTo({top:bottom+scrollY-usable+8,left:0,behavior:"instant"}),{bottom:rotatedMeasure.frame.bottom,usable:rotatedMeasure.bottom});const scrolled=await fit(page);
  expect(scrolled.frame.height).toBeCloseTo(rotatedMeasure.frame.height,0);
 }else await fit(page);
 await page.setViewportSize(original);await restoreTop(page);const restored=await fit(page);
 expect(restored.frame.height).toBeCloseTo(open.frame.height,0);expect(errors).toEqual([]);
 fs.writeFileSync(path.join(dir,"fit.json"),JSON.stringify({scope:"Actual CSS viewport; no native browser zoom claim. Whole main plot and time axis, not intersection.",initial,open,rotated:rotatedMeasure,restored,errors},null,2));
});

test("separate studies, assumptions, fullscreen, drawings and replay remain genuinely reachable",async({page},info)=>{
 test.setTimeout(120000);const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));const state=await ready(page);await tools(page);
 const toolbar=page.locator(".chart-studio-toolbar");await toolbar.getByRole("button",{name:"Indicators",exact:true}).click();
 const catalog=page.getByRole("dialog",{name:/Indicator/}).first();await catalog.getByLabel("Search indicators by name, description, category, or synonym",{exact:true}).fill("Relative Strength Index");await catalog.getByRole("button",{name:"Add RSI indicator",exact:true}).click();await page.keyboard.press("Escape");await expect(catalog).toBeHidden();
 const pine='//@version=6\nindicator("Viewport128 pane",overlay=false)\nlength=input.int(3,"Length",minval=1,maxval=10)\nplot(close-close[length],"Momentum",color=#ff00ff)'.replaceAll("\\n","\n");
 await toolbar.getByRole("button",{name:"Editor",exact:true}).click();const editor=page.getByRole("dialog",{name:"EdgeLab indicator editor",exact:true});
 await editor.getByLabel("New script template",{exact:true}).selectOption("pine-indicator");await editor.getByLabel("EdgeLab indicator source",{exact:true}).fill(pine);await checkedRun(editor);
 const beforeAdd=await page.evaluate(source=>(window as any).__layerResults.filter((r:any)=>r.status==="completed"&&r.result.kind==="run"&&r.result.source===source).length,pine);
 await editor.getByRole("button",{name:"Add to chart",exact:true}).click();await expect.poll(()=>page.evaluate(source=>(window as any).__layerResults.filter((r:any)=>r.status==="completed"&&r.result.kind==="run"&&r.result.source===source).length,pine)).toBeGreaterThan(beforeAdd);await editor.getByRole("button",{name:"Close indicator editor",exact:true}).click();
 await restoreTop(page);const withStudies=await fit(page),height=withStudies.frame.height;
 const native=page.getByRole("region",{name:"Viewport128 pane native Pine pane",exact:true});await expect(native).toBeVisible();await native.scrollIntoViewIfNeeded();await expect(native.locator("canvas").first()).toBeVisible();await expect(native).toContainText(/Momentum:/);
 const nativePixels=await native.locator("canvas").evaluateAll(nodes=>nodes.reduce((n,node)=>{const c=node as HTMLCanvasElement;const data=c.getContext("2d")!.getImageData(0,0,c.width,c.height).data;for(let i=0;i<data.length;i+=4)if(data[i]===255&&data[i+1]===0&&data[i+2]===255&&data[i+3])n++;return n;},0));expect(nativePixels).toBeGreaterThan(20);
 expect((await measure(page)).frame.height).toBeCloseTo(height,0);
 const dir=folder(info.project.name);await page.screenshot({path:path.join(dir,"native-study.png"),animations:"disabled"});
 const rsi=page.locator(".indicator-pane-title").filter({hasText:/^RSI /}).first().locator("../..");await expect(rsi).toBeVisible();await rsi.scrollIntoViewIfNeeded();await expect(rsi.locator("svg path").last()).toHaveAttribute("d",/^M/);expect(await rsi.locator("svg path").last().getAttribute("d")).not.toMatch(/NaN|undefined/);await expect(rsi.locator("span").last()).toHaveText(/^[0-9]+\.[0-9]$/);expect((await measure(page)).frame.height).toBeCloseTo(height,0);
 await restoreTop(page);
 const header=page.locator(".backtest-focus-header"),headerBottom=await header.evaluate(el=>el.getBoundingClientRect().bottom+scrollY);
 await page.evaluate(top=>scrollTo({top,left:0,behavior:"instant"}),headerBottom-8);await expect.poll(()=>header.evaluate(el=>el.getBoundingClientRect().bottom)).toBeGreaterThan(0);await expect(page.locator(".chart-quick-actionbar-floating")).toHaveCount(0);
 await page.evaluate(top=>scrollTo({top,left:0,behavior:"instant"}),headerBottom+8);await expect.poll(()=>header.evaluate(el=>el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0);await expect(page.locator(".chart-quick-actionbar-floating")).toBeVisible();
 await restoreTop(page);await expect(page.locator(".chart-quick-actionbar-floating")).toHaveCount(0);
 const focusProof=[];
 for(const control of [header.locator('[data-chart-header-control="tools"]'),page.getByRole("region",{name:"Replay transport",exact:true}).getByRole("button",{name:"Step",exact:true})]){
  await control.scrollIntoViewIfNeeded();await page.keyboard.press("Tab");await control.focus();await expect(control).toBeFocused();
  const proof=await control.evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect(),scroller=el.closest(".backtest-focus-header,.replay-transport-primary")!,p=scroller.getBoundingClientRect();return{outline:s.outlineStyle,width:parseFloat(s.outlineWidth),offset:parseFloat(s.outlineOffset),x:r.x,right:r.right,parentX:p.x,parentRight:p.right,compact:innerWidth<=480||(innerWidth<=900&&innerHeight<=650)};});
  expect(proof.outline).not.toBe("none");expect(proof.width).toBeGreaterThanOrEqual(2);if(proof.compact){expect(proof.offset).toBeLessThan(0);expect(proof.x).toBeGreaterThanOrEqual(proof.parentX);expect(proof.right).toBeLessThanOrEqual(proof.parentRight+.5);}focusProof.push(proof);
 }
 await restoreTop(page);
 const assumptions=page.getByLabel("Pine execution assumptions",{exact:true});await assumptions.locator("summary").click();const details=page.getByRole("region",{name:"Assumption details and affected scripts",exact:true});await details.scrollIntoViewIfNeeded();await expect(details).toBeVisible();expect((await details.boundingBox())!.width).toBeLessThanOrEqual(page.viewportSize()!.width);await page.screenshot({path:path.join(dir,"assumptions.png"),animations:"disabled"});await assumptions.locator("summary").click();
 // Opening tools while visiting lower panes must not reseed/rescale the price frame.
 await page.locator('[data-chart-header-control="tools"]').first().click();await page.locator('[data-chart-header-control="tools"]').first().click();await restoreTop(page);await fit(page);
 const drawing=await group(page,"Drawings");await drawing.dialog.getByRole("button",{name:"Trend",exact:true}).click();await expect(drawing.dialog).toBeHidden();await expect(drawing.trigger).toBeFocused();
 await drawing.trigger.click();await expect(drawing.dialog.getByRole("button",{name:"Trend",exact:true})).toHaveClass(/active/);await page.keyboard.press("Escape");
 const frame=page.locator(".chart-frame").first(),box=await frame.boundingBox();expect(box).toBeTruthy();
 await frame.click({position:{x:Math.round(box!.width*.3),y:Math.round(box!.height*.35)}});await frame.click({position:{x:Math.round(box!.width*.65),y:Math.round(box!.height*.65)}});
 await expect.poll(()=>JSON.stringify(state.storage.get("chart-layout.v1")??{}).includes('"tool":"trendline"')).toBe(true);
 const drawingLayout=structuredClone(state.storage.get("chart-layout.v1"));const trend=drawingLayout.drawings.find((d:any)=>d.tool==="trendline");expect(trend.points).toHaveLength(2);for(const point of trend.points){expect(Number.isFinite(point.price)).toBe(true);expect(Number.isFinite(point.logical)).toBe(true);}expect(trend.points[0].logical).not.toBe(trend.points[1].logical);await page.keyboard.press("Escape");
 const replay=page.getByRole("region",{name:"Replay transport",exact:true});await replay.getByRole("button",{name:"Replay options",exact:true}).click();const options=page.getByRole("dialog",{name:"Replay options",exact:true});await options.getByLabel("Custom replay speed in replay bars per second",{exact:true}).fill("4");await expect(options.getByLabel("Custom replay speed in replay bars per second",{exact:true})).toHaveValue("4");await options.locator(".replay-date-trigger").click();await expect(page.locator(".replay-date-popover")).toBeVisible();await page.keyboard.press("Escape");await expect(options).toBeVisible();await page.keyboard.press("Escape");await expect(options).toBeHidden();await replay.getByRole("button",{name:"Step",exact:true}).click();await expect(replay).toContainText("Bar 97");await expect(page.locator(".chart-stage")).toContainText("Latest bar: open "+bars[97].open);
 await restoreTop(page);await page.getByRole("button",{name:"Full Screen",exact:true}).first().click();await expect(page.locator(".chart-fullscreen-shell")).toBeVisible();const full=await fit(page);
 const fullscreenControls=[];
 for(const action of ["Ticket","Tools","Exit"]){
  const button=page.locator(".chart-quick-actionbar").getByRole("button",{name:action,exact:true});await button.scrollIntoViewIfNeeded();
  const proof=await button.evaluate(el=>{const r=el.getBoundingClientRect(),p=el.closest(".chart-quick-actionbar")!.getBoundingClientRect();const hit=[r.top+2,r.top+r.height/2,r.bottom-2].map(y=>{const n=document.elementFromPoint(r.left+r.width/2,y);return n===el||!!n&&el.contains(n);});return{height:r.height,visibleHeight:Math.max(0,Math.min(r.bottom,p.bottom,innerHeight)-Math.max(r.top,p.top,0)),hit};});
  expect(proof.height).toBeGreaterThanOrEqual(36);expect(proof.visibleHeight).toBeGreaterThanOrEqual(proof.height-.5);expect(proof.hit).toEqual([true,true,true]);fullscreenControls.push({action,...proof});
 }
 const fullDrawings=await group(page,"Drawings");await expect(fullDrawings.dialog.getByRole("button",{name:"Trend",exact:true})).toBeVisible();await page.keyboard.press("Escape");await expect(fullDrawings.trigger).toBeFocused();
 const drawingProof=await visibleControl(page,'.chart-studio-toolbar button[aria-label="Drawings"]',".chart-studio-toolbar");fullscreenControls.push({action:"Drawings",...drawingProof});
 await replay.getByRole("button",{name:"Replay options",exact:true}).click();await expect(options).toBeVisible();await expect(options.getByLabel("Replay bar offset",{exact:true})).toBeVisible();await page.keyboard.press("Escape");await expect(options).toBeHidden();
 await restoreTop(page);await fit(page);await page.screenshot({path:path.join(dir,"fullscreen.png"),animations:"disabled"});await page.locator(".chart-quick-actionbar").getByRole("button",{name:"Exit",exact:true}).click();await expect(page.locator(".chart-fullscreen-shell")).toHaveCount(0);await restoreTop(page);const after=await fit(page);
 let multiNotice=null;
 if(info.project.name==="desktop"){
  const workspace=await group(page,"Workspace");await workspace.dialog.getByRole("radio",{name:"2 rows",exact:true}).click();await page.keyboard.press("Escape");await expect(page.locator(".chart-pane-layout-horizontal-2")).toBeVisible();
  const stage=page.locator(".chart-stage").first(),disclosure=stage.getByLabel("Pine execution assumptions",{exact:true});await expect(disclosure).toBeVisible();const summary=disclosure.locator("summary");await summary.scrollIntoViewIfNeeded();
  multiNotice=await stage.evaluate(el=>{const disclosure=el.querySelector('details[aria-label="Pine execution assumptions"]')!,canvas=el.querySelector(".chart-frame")!,d=disclosure.getBoundingClientRect(),c=canvas.getBoundingClientRect();return{noticeBottom:d.bottom,canvasTop:c.top};});expect(multiNotice.noticeBottom).toBeLessThanOrEqual(multiNotice.canvasTop+.5);
  await summary.click();const multiDetails=stage.getByRole("region",{name:"Assumption details and affected scripts",exact:true});await expect(multiDetails).toBeVisible();await multiDetails.focus();await multiDetails.press("End");
  await expect.poll(()=>multiDetails.evaluate(el=>{const last=el.querySelector(":scope > span:last-child > span:last-child")!,t=last.getBoundingClientRect(),r=el.getBoundingClientRect(),s=el.closest(".chart-stage")!.getBoundingClientRect();return t.top>=Math.max(r.top,s.top,0)-.5&&t.bottom<=Math.min(r.bottom,s.bottom,innerHeight)+.5;})).toBe(true);await summary.click();
 }
 const workerName=fs.readdirSync("frontend/dist/assets").find(n=>/^pine-native-worker.*\.js$/.test(n))!,bytes=fs.readFileSync(path.join("frontend/dist/assets",workerName)),sha256=createHash("sha256").update(bytes).digest("hex");expect(state.workerReceipts.length).toBeGreaterThan(0);expect(state.workerReceipts.every(r=>r.sha256===sha256&&r.bytes===bytes.length)).toBe(true);expect(errors).toEqual([]);
 fs.writeFileSync(path.join(dir,"reachable.json"),JSON.stringify({source:pine,withStudies,full,after,nativePixels,drawingLayout,focusProof,fullscreenControls,multiNotice,workerName,sha256,workerReceipts:state.workerReceipts,errors},null,2));
});
