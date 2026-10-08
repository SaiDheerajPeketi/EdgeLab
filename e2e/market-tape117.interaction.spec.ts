
import {test,expect,type Page} from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {gotoStable,installDeterminism} from "./support/app";

const artifacts=path.resolve(".artifacts/market-tape117");
async function start(page:Page){
 const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 await installDeterminism(page,{motionLock:false,freezeTime:false});
 await page.emulateMedia({reducedMotion:"no-preference"});
 // Observe real timers without replacing their callbacks, cadence or cleanup.
 await page.addInitScript(()=>{
  const set=window.setInterval.bind(window),clear=window.clearInterval.bind(window);
  const observation={ticks:0,created:0,cleared:0,active:new Set<number>()};
  (window as any).tapeTimers=observation;
  window.setInterval=((handler:TimerHandler,delay?:number,...args:unknown[])=>{
   if(delay!==1600)return set(handler,delay,...args);
   observation.created++;
   const id=set(()=>{
    observation.ticks++;
    if(typeof handler==="function")Reflect.apply(handler,window,args);else window.eval(handler);
   },delay);
   observation.active.add(id);return id;
  }) as typeof window.setInterval;
  window.clearInterval=((id?:number)=>{
   if(id!==undefined&&observation.active.delete(id))observation.cleared++;
   clear(id);
  }) as typeof window.clearInterval;
 });
 await gotoStable(page,"/");
 const feed=page.getByRole("region",{name:"Illustrative market feed"});
 await feed.scrollIntoViewIfNeeded();
 await expect(feed.locator(".edgelab-marquee")).toHaveCSS("animation-play-state","running");
 await expect.poll(()=>timerState(page).then(s=>s.active)).toBe(1);
 return {feed,errors};
}
const timerState=(page:Page)=>page.evaluate(()=>{
 const s=(window as any).tapeTimers;return {ticks:s.ticks,created:s.created,cleared:s.cleared,active:s.active.size};
});
const snapshot=(page:Page)=>page.getByRole("region",{name:"Illustrative market feed"}).evaluate(feed=>{
 const track=feed.querySelector(".edgelab-marquee")!;
 const animation=track.getAnimations().find(a=>a instanceof CSSAnimation&&a.animationName==="edgelab-marquee");
 return {transform:getComputedStyle(track).transform,x:new DOMMatrixReadOnly(getComputedStyle(track).transform).m41,
  time:animation?.currentTime??null,pending:animation?.pending??false,playState:animation?.playState??"none",prices:Array.from(track.children).filter(row=>row.getAttribute("aria-hidden")!=="true").map(row=>row.children[1]?.textContent),
  sameTrack:!(window as any).originalTape||(window as any).originalTape===track,
  sameAnimation:!(window as any).originalTapeAnimation||(window as any).originalTapeAnimation===animation};
});
async function rememberTrack(page:Page){
 await page.getByRole("region",{name:"Illustrative market feed"}).evaluate(feed=>{
  const track=feed.querySelector(".edgelab-marquee")!;
  (window as any).originalTape=track;
  (window as any).originalTapeAnimation=track.getAnimations().find(a=>a instanceof CSSAnimation&&a.animationName==="edgelab-marquee");
 });
}
async function settlePause(page:Page){
 await page.getByRole("region",{name:"Illustrative market feed"}).evaluate(async feed=>{
  const track=feed.querySelector(".edgelab-marquee")!;
  await Promise.all(track.getAnimations().map(animation=>animation.ready));
  await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
 });
}
async function freezeProof(page:Page){
 await settlePause(page);
 const before=await snapshot(page),timers=await timerState(page);
 await page.waitForTimeout(3400);
 const after=await snapshot(page);
 expect(after.transform).toBe(before.transform);expect(after.prices).toEqual(before.prices);
 expect((await timerState(page)).ticks).toBe(timers.ticks);expect((await timerState(page)).active).toBe(0);
 return {before,after,timers};
}
async function save(info:any,label:string,evidence:any,errors:string[]){
 expect(errors).toEqual([]);
 const folder=path.join(artifacts,info.project.name);fs.mkdirSync(folder,{recursive:true});
 const index=fs.readFileSync(path.resolve("frontend/dist/index.html"));
 fs.writeFileSync(path.join(folder,label+".json"),JSON.stringify({productionIndexSha256:createHash("sha256").update(index).digest("hex"),evidence,errors},null,2));
}

test("keyboard Pause freezes prices and scroll position, survives reentry and Resume continues the same feed",async({page},info)=>{
 const {feed,errors}=await start(page),track=feed.locator(".edgelab-marquee");
 const initial=await snapshot(page);
 await expect.poll(()=>snapshot(page).then(s=>s.prices.join("|"))).not.toBe(initial.prices.join("|"));
 await expect.poll(()=>snapshot(page).then(s=>s.x)).toBeLessThan(-1);
 await rememberTrack(page);
 const before=await snapshot(page),pause=feed.getByRole("button",{name:"Pause demo feed",exact:true});
 const geometry=await pause.evaluate(button=>{
  const r=button.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,viewport:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth};
 });
 expect(geometry.width).toBeGreaterThanOrEqual(44);expect(geometry.height).toBeGreaterThanOrEqual(44);
 expect(geometry.x).toBeGreaterThanOrEqual(0);expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
 expect(geometry.overflow).toBeLessThanOrEqual(1);
 await pause.focus();await page.keyboard.press("Enter");
 const resume=feed.getByRole("button",{name:"Resume demo feed",exact:true});
 await expect(resume).toBeFocused();await expect(track).toHaveCSS("animation-play-state","paused");
 await settlePause(page);
 const paused=await snapshot(page);
 expect(paused.sameTrack).toBe(true);expect(paused.sameAnimation).toBe(true);expect(paused.prices).toEqual(before.prices);
 expect(Number(paused.time)).toBeGreaterThanOrEqual(Number(before.time));expect(Number(paused.time)-Number(before.time)).toBeLessThan(300);
 const frozen=await freezeProof(page);
 await page.evaluate(()=>window.scrollTo({top:document.documentElement.scrollHeight,behavior:"instant"}));
 await expect.poll(()=>feed.evaluate(el=>el.getBoundingClientRect().bottom)).toBeLessThan(-120);
 await page.waitForTimeout(200);
 await feed.scrollIntoViewIfNeeded();await expect(resume).toBeVisible();await expect(track).toHaveCSS("animation-play-state","paused");
 const reentered=await snapshot(page);expect(reentered.prices).toEqual(paused.prices);expect(reentered.transform).toBe(paused.transform);
 await expect(resume).toBeFocused();await page.keyboard.press("Space");
 await expect(feed.getByRole("button",{name:"Pause demo feed",exact:true})).toBeFocused();
 await expect(track).toHaveCSS("animation-play-state","running");
 await expect.poll(()=>snapshot(page).then(s=>Math.abs(s.x-paused.x))).toBeGreaterThan(1);
 await expect.poll(()=>snapshot(page).then(s=>s.prices.join("|"))).not.toBe(paused.prices.join("|"));
 const resumed=await snapshot(page);expect(resumed.sameTrack).toBe(true);expect(resumed.sameAnimation).toBe(true);
 await save(info,"pause-resume",{geometry,before,paused,frozen,reentered,resumed,timers:await timerState(page)},errors);
 await feed.getByRole("button",{name:"Pause demo feed",exact:true}).click();
 await expect(track).toHaveCSS("animation-play-state","paused");
 await feed.screenshot({path:path.join(artifacts,info.project.name,"paused-feed.png")});
});

test("live reduced-motion changes preserve Pause intent and unmount clears the genuine feed timer",async({page},info)=>{
 const {feed,errors}=await start(page),track=feed.locator(".edgelab-marquee");
 await feed.getByRole("button",{name:"Pause demo feed",exact:true}).click();
 const paused=await snapshot(page);
 await page.emulateMedia({reducedMotion:"reduce"});
 await expect(feed.getByRole("button",{name:/^(Pause|Resume) demo feed$/})).toHaveCount(0);
 await expect(track).toHaveCSS("animation-name","none");
 const reducedPaused=await freezeProof(page);
 await page.emulateMedia({reducedMotion:"no-preference"});
 const resume=feed.getByRole("button",{name:"Resume demo feed",exact:true});
 await expect(resume).toBeVisible();await expect(track).toHaveCSS("animation-play-state","paused");
 expect((await snapshot(page)).prices).toEqual(paused.prices);
 const restoredPaused=await freezeProof(page);
 await resume.focus();await page.keyboard.press("Enter");
 await expect(track).toHaveCSS("animation-play-state","running");
 await expect.poll(()=>timerState(page).then(s=>s.active)).toBe(1);
 await page.emulateMedia({reducedMotion:"reduce"});
 await expect(track).toHaveCSS("animation-name","none");
 const reducedRunning=await freezeProof(page);
 await page.emulateMedia({reducedMotion:"no-preference"});
 await expect(feed.getByRole("button",{name:"Pause demo feed",exact:true})).toBeVisible();
 await expect.poll(()=>timerState(page).then(s=>s.active)).toBe(1);
 const beforeUnmount=await timerState(page);
 await page.evaluate(()=>{history.pushState({},"","/pricing");window.dispatchEvent(new PopStateEvent("popstate"));});
 await expect(feed).toHaveCount(0);await expect.poll(()=>timerState(page).then(s=>s.active)).toBe(0);
 const unmounted=await timerState(page);await page.waitForTimeout(1850);
 expect((await timerState(page)).ticks).toBe(unmounted.ticks);
 expect(unmounted.cleared).toBeGreaterThan(beforeUnmount.cleared);
 await save(info,"reduced-cleanup",{paused,reducedPaused,restoredPaused,reducedRunning,beforeUnmount,unmounted,finalTimers:await timerState(page)},errors);
});
