import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { liveViewportSetup } from "./chart-viewport151.support";
import { editor } from "./pine-layering.product-support";

type Bar={time:number;open:number;high:number;low:number;close:number;volume:number};
const hash=(value:Buffer|string)=>createHash("sha256").update(value).digest("hex");
const seal=()=>hash(fs.readdirSync("frontend/dist",{recursive:true}).map(String).filter(file=>fs.statSync(path.join("frontend/dist",file)).isFile()).sort()
  .map(file=>file+":"+hash(fs.readFileSync(path.join("frontend/dist",file)))).join("\n"));
const source=`//@version=6
indicator("Flat TA189",overlay=true,format=format.price,precision=4)
length=input.int(3,"Length",minval=2,maxval=20)
plot(ta.cci(close,length),"CCI",display=display.status_line+display.data_window)
plot(ta.wpr(length),"WPR",display=display.status_line+display.data_window)
plot(ta.mfi(close,length),"MFI",display=display.status_line+display.data_window)`;
// Independent arrays implement the stated equations, not the native rolling-cache implementation.
function reference(data:Bar[],index:number,length:number){
  if(index<length-1)return{CCI:null,WPR:null,MFI:null};
  const window=data.slice(index-length+1,index+1),average=window.reduce((sum,bar)=>sum+bar.close,0)/length;
  const deviation=window.reduce((sum,bar)=>sum+Math.abs(bar.close-average),0)/length;
  const high=Math.max(...window.map(bar=>bar.high)),low=Math.min(...window.map(bar=>bar.low));
  let upper=0,lower=0;
  for(let i=index-length+1;i<=index;i++){
    const change=i===0?NaN:data[i].close-data[i-1].close;
    // Initial undefined change takes both native formula ternary branches, preserving the first warmed 50.
    upper+=data[i].volume*(change<=0?0:data[i].close);lower+=data[i].volume*(change>=0?0:data[i].close);
  }
  return{CCI:deviation===0?null:(data[index].close-average)/(.015*deviation),WPR:high===low?null:100*(data[index].close-high)/(high-low),
    MFI:upper===0&&lower===0?null:lower===0?100:100-100/(1+upper/lower)};
}
async function observe(page:Page){
  const errors:string[]=[],sandboxErrors:string[]=[],workers:any[]=[];
  page.on("pageerror",error=>error.message.includes("Service worker is disabled because the context is sandboxed")?sandboxErrors.push(error.message):errors.push(error.message));
  await page.addInitScript(()=>{if(window!==window.top)return;(window as any).__ta189=[];
    addEventListener("message",event=>{const frame=[...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')]
      .find(item=>item.contentWindow===event.source&&item.srcdoc.includes(`data-job="${event.data?.nonce}"`));
      if(frame&&event.origin==="null"&&event.data?.type==="result")(window as any).__ta189.push(event.data.payload);},true);});
  await page.route("**/assets/pine-native-worker*.js",async route=>{const response=await route.fetch(),bytes=await response.body();workers.push({url:route.request().url(),bytes:bytes.length,sha256:hash(bytes)});await route.fulfill({response,body:bytes});});
  return{errors,sandboxErrors,workers};
}
async function results(page:Page){return page.evaluate(source=>((window as any).__ta189??[]).flatMap((payload:any)=>{
  const response=payload.protocol==="pine-live-v1"?payload.response:payload,result=response?.result;
  if(response?.status!=="completed"||result?.kind!=="run"||result.source!==source)return[];
  return[{source:result.source,inputs:result.inputs,audit:result.audit,sessionId:payload.sessionId,sequence:payload.sequence,
    plots:result.plots.map((plot:any)=>{if(!plot.packed)return{id:plot.id,name:plot.name,values:plot.points.map((point:any)=>point.value)};
      const values=new Float64Array(response.buffers[plot.packed.values]),kinds=new Uint8Array(response.buffers[plot.packed.kinds]);
      return{id:plot.id,name:plot.name,values:Array.from({length:plot.packed.slots},(_,i)=>kinds[i]===4?values[i]:kinds[i]===1?null:undefined)};})}];
}),source);}
async function chart(page:Page,index?:number,remember=false){
  if(index!==undefined)await page.locator(".chart-stage .tv-lightweight-charts").first().scrollIntoViewIfNeeded();
  const state=await page.evaluate(async({index,remember})=>{
    const stage=document.querySelector<HTMLElement>(".chart-stage")!,key=Object.keys(stage).find(key=>key.startsWith("__reactFiber$"));let api:any,candles:any,volumes:any;
    for(let fiber=key?(stage as any)[key]:null,depth=0;fiber&&depth<64;fiber=fiber.return,depth++)for(let hook=fiber.memoizedState,n=0;hook&&n<384;hook=hook.next,n++){
      const ref=hook.memoizedState?.current;if(!ref)continue;if(!api&&typeof ref.timeScale==="function"&&typeof ref.addCandlestickSeries==="function")api=ref;
      if(typeof ref.seriesType==="function"&&ref.seriesType()==="Candlestick")candles??=ref;
      if(typeof ref.seriesType==="function"&&ref.seriesType()==="Histogram")volumes??=ref;
    }
    if(!api||!candles)throw Error("Actual chart refs unavailable");
    if(remember)(window as any).__taOwner189={api,candles};
    if(index!==undefined)api.timeScale().setVisibleLogicalRange({from:index-8,to:index+8});
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    const owner=(window as any).__taOwner189,row=index===undefined?undefined:candles.data()[index],rect=stage.querySelector(".tv-lightweight-charts")!.getBoundingClientRect();
    return{rows:candles.data(),volumeRows:volumes?.data(),sameOwner:!owner||owner.api===api&&owner.candles===candles,
      target:row?{time:row.time,x:rect.left+api.timeScale().timeToCoordinate(row.time),y:rect.top+candles.priceToCoordinate(row.close)}:undefined};
  },{index,remember});
  if(state.target){expect(state.target.x).toBeGreaterThan(0);expect(state.target.x).toBeLessThan(page.viewportSize()!.width);expect(state.target.y).toBeGreaterThan(0);expect(state.target.y).toBeLessThan(page.viewportSize()!.height);await page.mouse.move(state.target.x,state.target.y);}
  return state;
}
function compare(result:any,data:Bar[],length:number,index:number){
  const expected=reference(data,index,length);
  expect(result.source).toBe(source);expect(result.inputs.in_0).toBe(length);expect(result.audit.bars).toBe(data.length);
  for(const plot of result.plots){expect(plot.values).toHaveLength(data.length);const wanted=expected[plot.name as keyof typeof expected],actual=plot.values[index];
    if(wanted===null)expect(actual,`${plot.name} at ${index}`).toBeNull();else{expect(typeof actual).toBe("number");expect(Math.abs(actual-wanted),`${plot.name} at ${index}`).toBeLessThan(1e-6);}}
  return expected;
}

test("actual flat-price TA keeps exact NA through live rollback, confirmation and custom-input rerun",async({page},info)=>{
  const beforeSeal=seal(),observed=await observe(page),sockets:any[]=[];
  // Only provider transport scheduling is controlled; the actual shared fixture/API, runtime and chart remain intact.
  const routeSocket=page.routeWebSocket.bind(page);
  page.routeWebSocket=((pattern:any,handler:any)=>routeSocket(pattern,async socket=>{sockets.push(socket);await handler(socket);})) as typeof page.routeWebSocket;
  let feed:Awaited<ReturnType<typeof liveViewportSetup>>;
  try{feed=await liveViewportSetup(page,true);}finally{page.routeWebSocket=routeSocket;}
  for(const bar of feed.history)Object.assign(bar,{open:67530,high:67530,low:67530,close:67530,volume:10});
  feed.releaseHistory();
  await expect.poll(async()=>(await chart(page)).rows.length).toBe(600);
  const baseline=await chart(page,undefined,true);expect(baseline.rows.map(({time,open,high,low,close}:Bar)=>({time,open,high,low,close}))).toEqual(feed.history.map(({volume,...bar})=>bar));
  expect(baseline.volumeRows?.map(({time,value}:any)=>({time,value}))).toEqual(feed.history.map(bar=>({time:bar.time,value:10})));
  const events:any[]=[],origin=feed.history[0].time;let eventClock=Math.max(Date.now(),(origin+600*60)*1000);
  function emit(index:number,close:number,confirmed=false,volume=15){
    const bar:Bar={time:origin+index*60,open:67520,high:Math.max(67540,close),low:67500,close,volume};
    const closeTime=bar.time*1000+59999;eventClock=Math.max(eventClock+1,bar.time*1000,confirmed?closeTime:bar.time*1000);
    const event={e:"kline",E:eventClock,s:"BTCUSDT",k:{t:bar.time*1000,T:closeTime,i:"1m",s:"BTCUSDT",o:String(bar.open),h:String(bar.high),l:String(bar.low),c:String(close),v:String(volume),x:confirmed}};
    events.push(event);for(const socket of sockets)if(socket.url().includes("btcusdt@kline_1m"))socket.send(JSON.stringify(event));return bar;
  }
  let current=emit(600,67530);await expect.poll(async()=>(await chart(page)).rows.length).toBe(601);
  const dialog=await editor(page);await dialog.getByLabel("New script template",{exact:true}).selectOption("pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source",{exact:true}).fill(source);await dialog.getByRole("button",{name:"Check script",exact:true}).click();
  await expect(dialog.getByRole("button",{name:"Add to chart",exact:true})).toBeEnabled();await dialog.getByRole("button",{name:"Add to chart",exact:true}).click();
  await dialog.getByRole("button",{name:"Close indicator editor",exact:true}).click();
  const latest=async()=>(await results(page)).filter((result:any)=>result.sessionId).at(-1);
  await expect.poll(async()=>(await latest())?.audit.bars).toBe(601);
  const initial=await latest(),proofs:any[]=[];const data=page.getByRole("region",{name:"Data Window",exact:true});
  const expectReadouts=async(index:number,expected:ReturnType<typeof reference>)=>{
    await chart(page,index);
    for(const name of ["CCI","WPR","MFI"] as const){const wanted=expected[name]===null?"—":new Intl.NumberFormat("en-US",{minimumFractionDigits:4,maximumFractionDigits:4}).format(expected[name]!);
      await expect(page.getByRole("button",{name:`Flat TA189 · ${name}`,exact:true}).locator("strong")).toHaveText(wanted);
      await expect(data.locator(`[aria-label="Flat TA189 · ${name}"] strong`)).toHaveText(wanted);}
  };
  compare(initial,[...feed.history,current],3,2);expect(initial.plots.find((plot:any)=>plot.name==="MFI").values[2]).toBe(50);
  for(const index of [599,600]){const expected=compare(initial,[...feed.history,current],3,index);await expectReadouts(index,expected);proofs.push({phase:"initial",index,expected});}
  for(const close of [67533,67529,67530]){
    const previous=await latest();current=emit(600,close);await expect.poll(async()=>(await latest())?.sequence).toBeGreaterThan(previous.sequence);
    const result=await latest();expect(result.sessionId).toBe(initial.sessionId);const expected=compare(result,[...feed.history,current],3,600);await expectReadouts(600,expected);proofs.push({phase:"rollback",close,sequence:result.sequence,expected});
  }
  const prior=await latest();current=emit(600,67530,true);await expect.poll(async()=>(await latest())?.sequence).toBeGreaterThan(prior.sequence);
  const closed=await latest();compare(closed,[...feed.history,current],3,600);
  const confirmed=current;current=emit(601,67530);await expect.poll(async()=>(await latest())?.audit.bars).toBe(602);
  const appended=await latest();expect(appended.sessionId).toBe(initial.sessionId);compare(appended,[...feed.history,confirmed,current],3,601);
  await expectReadouts(601,reference([...feed.history,confirmed,current],601,3));
  await page.getByRole("button",{name:"Flat TA189 · CCI",exact:true}).scrollIntoViewIfNeeded();await page.getByRole("button",{name:"Flat TA189 · CCI",exact:true}).click();
  const controls=page.getByRole("group",{name:"Indicator settings",exact:true});await controls.getByLabel("Length",{exact:true}).fill("5");await controls.getByLabel("Length",{exact:true}).press("Enter");
  await expect.poll(async()=>{const result=await latest();return result?.inputs.in_0===5&&result.audit.bars===602;}).toBe(true);const changed=await latest();expect(changed.sessionId).not.toBe(initial.sessionId);
  compare(changed,[...feed.history,confirmed,current],5,4);expect(changed.plots.find((plot:any)=>plot.name==="MFI").values[4]).toBe(50);
  compare(changed,[...feed.history,confirmed,current],5,601);await page.getByRole("button",{name:"Close indicator settings",exact:true}).click();
  await expectReadouts(599,reference([...feed.history,confirmed,current],599,5));
  const ownership=await chart(page);expect(ownership.sameOwner).toBe(true);expect(observed.errors).toEqual([]);expect(observed.workers.length).toBeGreaterThan(0);
  expect(feed.storage.get("custom-indicator-scripts.v1")?.some((item:any)=>item.source===source)).toBe(true);expect(seal()).toBe(beforeSeal);
  const directory=path.resolve(".artifacts/pine-ta189",info.project.name);fs.mkdirSync(directory,{recursive:true});
  // Mobile uses genuine mouse hover in a touch-capable viewport; show each status group through its actual horizontal strip.
  await page.getByRole("button",{name:"Flat TA189 · MFI",exact:true}).scrollIntoViewIfNeeded();await chart(page,599);
  await page.screenshot({path:path.join(directory,"flat-ta-readouts.png"),animations:"disabled"});
  fs.writeFileSync(path.join(directory,"receipt.json"),JSON.stringify({scope:"Actual production editor/live worker/chart, controlled HTTP/auth and native provider events only; mobile hybrid mouse hover explicitly qualified",beforeSeal,afterSeal:seal(),source,baseline,initial,closed,appended,changed,proofs,events,ownership,...observed,
    fixtures:Object.fromEntries(["e2e/ta-degenerate189.config.ts","e2e/ta-degenerate189.interaction.spec.ts"].map(file=>[file,hash(fs.readFileSync(file))]))},null,2));
});
