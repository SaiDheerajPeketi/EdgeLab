import { createChart } from "../frontend/node_modules/lightweight-charts";
import { createPineRuntimeJob, createPineLiveRuntimeSession } from "../frontend/src/lib/pineRuntime";
import { adaptPineChartResult, installPineChartPlots } from "../frontend/src/lib/pineChartAdapter";
import { getPackedPinePlot } from "../frontend/src/lib/pinePacked";

let state: any, live: any;
const context = { symbol: "TEST", timeframe: "1", mintick: .01, pointvalue: 1 };
const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
function image(element) {
  const canvas = document.createElement("canvas"), rect = element.getBoundingClientRect();
  canvas.width = rect.width; canvas.height = rect.height;
  const ctx = canvas.getContext("2d");
  // The top primitive canvas is excluded by LWC takeScreenshot, so composite actual DOM layers.
  for (const layer of element.querySelectorAll("canvas")) {
    const bounds = layer.getBoundingClientRect();
    ctx.drawImage(layer, bounds.left - rect.left, bounds.top - rect.top, bounds.width, bounds.height);
  }
  return { width: canvas.width, height: canvas.height, pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
}
export async function prepare(source) { return createPineRuntimeJob({ action: "prepare", source }).promise; }
async function render(result, bars, options = {}) {
  if (state) for (const p of state.placements) { p.installed.dispose(); for(const extra of p.additional ?? [])extra.dispose(); p.chart.remove(); }
  const main = document.querySelector("#main"), pane = document.querySelector("#pane");
  main.replaceChildren(); pane.replaceChildren(); pane.hidden = true;
  const adapted = adaptPineChartResult(result, bars), bounds = options.bounds ?? [80, 120];
  function make(element, candles) {
    element.hidden = false;
    const chart = createChart(element, { width: element.clientWidth, height: innerWidth < 600 ? 290 : 390,
      layout: { background: { color: "#111827" }, textColor: "#cbd5e1" }, grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      leftPriceScale: { visible:Boolean(options.leftAxis), borderVisible:false }, rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false, timeVisible: true },
      crosshair: { vertLine: { visible: false }, horzLine: { visible: false } } });
    const fixed = () => ({ priceRange: { minValue: bounds[0], maxValue: bounds[1] } });
    const base = options.lineOnly ? null : candles ? chart.addCandlestickSeries({ upColor: "#475569", downColor: "#475569", wickUpColor: "#475569", wickDownColor: "#475569", borderVisible: false, lastValueVisible: false, priceLineVisible: false, autoscaleInfoProvider: fixed })
      : chart.addLineSeries({ color: "transparent", lineVisible: false, lastValueVisible: false, priceLineVisible: false, autoscaleInfoProvider: fixed });
    const chartBars = options.chartBars ?? bars;
    if(options.leftAxis){const leftPeer=chart.addLineSeries({priceScaleId:"left",color:"transparent",lineVisible:false,lastValueVisible:false,priceLineVisible:false,autoscaleInfoProvider:fixed});leftPeer.setData(chartBars.map(b=>({time:b.time,value:bounds[0]})));}
    base?.setData(candles ? chartBars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })) : chartBars.map(b => ({ time: b.time, value: bounds[0] })));
    chart.timeScale().setVisibleLogicalRange({ from: options.from ?? 10, to: options.to ?? 35 });
    return { chart, base, element, installed: null };
  }
  const placements = [make(main, Boolean(options.candles))];
  if (adapted.plots.some(p => !p.overlay)) placements.push(make(pane, false));
  await paint();
  placements[0].installed = installPineChartPlots(placements[0].chart, adapted.plots.filter(p => p.overlay), "right", { allowFillOnlyScale: options.lineOnly ? undefined : false, scaleAnchor: (options.chartBars ?? bars).at(-1) });
  if (placements[1]) placements[1].installed = installPineChartPlots(placements[1].chart, adapted.plots.filter(p => !p.overlay));
  if (options.lineOnly) for (const p of placements) {
    p.base = p.installed.series[0];
    p.chart.timeScale().setVisibleLogicalRange({ from: options.from ?? 10, to: options.to ?? 35 });
  }
  state = { result, adapted, bars, options, placements };
  document.querySelector("#status").textContent = result.audit.engine + " " + result.audit.engineVersion + " · " + result.plots.length + " outputs";
  await paint(); return summary();
}
export async function run(source, bars, options = {}) {
  live?.cancel(); live = null;
  const result = await createPineRuntimeJob({ action: "run", source, bars, inputs: options.inputs ?? {}, context, mode: "historical" }).promise;
  return render(result, bars, options);
}
export function summary() {
  return { labels: state.result.labels ?? [], boxes: state.result.boxes ?? [], lineFills: state.result.lineFills ?? [], lines: state.result.lines ?? [], plots: state.result.plots.map(p => ({ name: p.name, style: p.style, options: p.options, points: getPackedPinePlot(p) ? undefined : p.points?.map(v => ({ time: v.time, value: v.value, options: v.options })) })),
    inputs: state.result.inputs, warnings: state.adapted.warnings, adapterWarnings: state.adapted.adapterWarnings, packed: state.result.plots.map(p => Boolean(getPackedPinePlot(p))),
    placements: state.placements.map(p => ({ visible: p.chart.timeScale().getVisibleLogicalRange(), drawingRange: p.installed.drawingPrimitive?.rangeForVisible(), range: p.installed.drawingPrimitive?.rangeForVisible() ?? p.installed.primitive?.rangeForVisible(), stats: p.installed.primitive?.debugStats })) };
}
// Scan independently in screen pixels: gaps and contiguous ink lengths reveal actual dash rendering.
export function scan(price, { placement = 0, channel = "red", from, to, dy = 0, radius = 0 } = {}) {
  const p = state.placements[placement], frame = image(p.element), scale = p.chart.timeScale();
  const width = Math.floor(p.chart.paneSize().width), y = p.base.priceToCoordinate(price) + dy;
  // LWC4 accepts only integer logicalToCoordinate inputs; interpolate actual neighboring slots.
  const coordinate = logical => { const index = Math.floor(logical), left = scale.logicalToCoordinate(index), right = scale.logicalToCoordinate(index + 1); return left + (right - left) * (logical - index); };
  const left = Math.max(4, Math.ceil(from === undefined ? 4 : coordinate(from)));
  const right = Math.min(width - 4, Math.floor(to === undefined ? width - 4 : coordinate(to)));
  const lane = { red: 0, green: 1, blue: 2 }[channel], mask = [];
  let ink = 0;
  for (let x = left; x <= right; x++) {
    let hit = false;
    for (let yy = Math.max(0, Math.round(y) - radius); yy <= Math.min(frame.height - 1, Math.round(y) + radius); yy++) {
      const offset = (yy * frame.width + x) * 4, rgb = frame.pixels.slice(offset, offset + 3);
      if (rgb[lane] > 120 && rgb[lane] > rgb[(lane + 1) % 3] * 1.5 && rgb[lane] > rgb[(lane + 2) % 3] * 1.5) { hit = true; ink++; }
    }
    mask.push(hit ? 1 : 0);
  }
  const runs = [], gaps = [];
  for (let i = 0; i < mask.length;) { const value = mask[i]; let end = i + 1; while (end < mask.length && mask[end] === value) end++; (value ? runs : gaps).push(end - i); i = end; }
  return { y, left, right, ink, samples: mask.length, painted: mask.reduce((a, b) => a + b, 0), runs, gaps, mask };
}
export async function pan(from, to) { for (const p of state.placements) p.chart.timeScale().setVisibleLogicalRange({ from, to }); await paint(); return summary(); }
export async function resize() { for (const p of state.placements) p.chart.resize(p.element.clientWidth, innerWidth < 600 ? 250 : 330); await paint(); return summary(); }
export async function dispose() { for (const p of state.placements) { p.installed.dispose(); p.installed.dispose(); for(const extra of p.additional ?? [])extra.dispose(); } live?.cancel(); live = null; await paint(); return state.placements.map(p => p.installed.primitive?.debugStats); }
export async function startLive(source, bars, options = {}) {
  live?.cancel(); live = createPineLiveRuntimeSession({ source, bars, inputs: options.inputs ?? {}, context });
  return render(await live.promise, bars, options);
}
export async function updateLive(bar, confirmed) {
  const result = await live.update(bar, confirmed);
  const bars = state.bars.at(-1).time === bar.time ? [...state.bars.slice(0, -1), bar] : [...state.bars, bar];
  return render(result, bars, state.options);
}

export function spot(logical, price, { placement = 0, channel = "red", radius = 5 } = {}) {
  const p = state.placements[placement], frame = image(p.element), scale = p.chart.timeScale(), index = Math.floor(logical);
  const x1 = scale.logicalToCoordinate(index), x2 = scale.logicalToCoordinate(index + 1), x = x1 + (x2-x1)*(logical-index), y = p.base.priceToCoordinate(price);
  const lane = { red: 0, green: 1, blue: 2 }[channel]; let ink = 0;
  for(let yy=Math.max(0,Math.floor(y-radius));yy<=Math.min(frame.height-1,Math.ceil(y+radius));yy++) for(let xx=Math.max(0,Math.floor(x-radius));xx<=Math.min(frame.width-1,Math.ceil(x+radius));xx++) {
    const offset=(yy*frame.width+xx)*4,rgb=frame.pixels.slice(offset,offset+3);
    if(rgb[lane]>120&&rgb[lane]>rgb[(lane+1)%3]*1.5&&rgb[lane]>rgb[(lane+2)%3]*1.5) ink++;
  }
  return { x,y,ink };
}

export async function scale(mode, invertScale) { for (const p of state.placements) p.chart.priceScale("right").applyOptions({ mode, invertScale }); await paint(); return summary(); }

export function sample(logical, price, placement = 0) {
 const p=state.placements[placement],frame=image(p.element),scale=p.chart.timeScale(),i=Math.floor(logical),a=scale.logicalToCoordinate(i),b=scale.logicalToCoordinate(i+1),x=Math.round(a+(b-a)*(logical-i)),y=Math.round(p.base.priceToCoordinate(price)),offset=(y*frame.width+x)*4;
 return {x,y,rgba:Array.from(frame.pixels.slice(offset,offset+4))};
}

// Independently inspect colored glyphs inside a region defined by real chart coordinates.
export function glyphs(left, right, top, bottom, { placement = 0, channel = "green" } = {}) {
 const p=state.placements[placement],frame=image(p.element),scale=p.chart.timeScale();
 const xAt=i=>{const n=Math.floor(i),a=scale.logicalToCoordinate(n),b=scale.logicalToCoordinate(n+1);return a+(b-a)*(i-n);};
 const ys=[p.base.priceToCoordinate(top),p.base.priceToCoordinate(bottom)],xs=[xAt(left),xAt(right)];
 const bounds={left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys)},lane={red:0,green:1,blue:2}[channel];
 let ink=0,minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
 for(let y=Math.max(0,Math.ceil(bounds.top));y<=Math.min(frame.height-1,Math.floor(bounds.bottom));y++)for(let x=Math.max(0,Math.ceil(bounds.left));x<=Math.min(frame.width-1,Math.floor(bounds.right));x++){
  const offset=(y*frame.width+x)*4,rgb=frame.pixels.slice(offset,offset+3);
  if(rgb[lane]>120&&rgb[lane]>rgb[(lane+1)%3]*1.5&&rgb[lane]>rgb[(lane+2)%3]*1.5){ink++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
 }
 return{ink,minX,maxX,minY,maxY,bounds};
}

export function anchor(logical, price, placement = 0) {
 const p=state.placements[placement],scale=p.chart.timeScale(),i=Math.floor(logical),a=scale.logicalToCoordinate(i),b=scale.logicalToCoordinate(i+1),x=a+(b-a)*(logical-i)+p.chart.priceScale("left").width(),y=p.base.priceToCoordinate(price),rect=p.element.getBoundingClientRect();
 return{x,y,pageX:rect.left+x,pageY:rect.top+y,width:p.chart.paneSize().width,height:p.chart.paneSize().height};
}
export function offsetPixel(logical,price,dx,dy,placement=0){const p=state.placements[placement],frame=image(p.element),a=anchor(logical,price,placement),x=Math.round(a.x+dx),y=Math.round(a.y+dy),offset=(y*frame.width+x)*4;return{x,y,rgba:Array.from(frame.pixels.slice(offset,offset+4))};}
export function region(logical,price,left,right,top,bottom,{placement=0,channel="red"}={}){
 const p=state.placements[placement],frame=image(p.element),a=anchor(logical,price,placement),lane={red:0,green:1,blue:2}[channel];let ink=0,minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
 for(let y=Math.max(0,Math.ceil(a.y+top));y<=Math.min(frame.height-1,Math.floor(a.y+bottom));y++)for(let x=Math.max(0,Math.ceil(a.x+left));x<=Math.min(frame.width-1,Math.floor(a.x+right));x++){const n=(y*frame.width+x)*4,rgb=frame.pixels.slice(n,n+3);if(rgb[lane]>120&&rgb[lane]>rgb[(lane+1)%3]*1.5&&rgb[lane]>rgb[(lane+2)%3]*1.5){ink++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}}
 return{ink,minX,maxX,minY,maxY,anchor:a};
}

export async function zoomPriceMargins(top,bottom){for(const p of state.placements)p.chart.priceScale("right").applyOptions({scaleMargins:{top,bottom}});await paint();return summary();}
export function priceCoordinates(prices,placement=0){const p=state.placements[placement];return{coordinates:prices.map(price=>p.base.priceToCoordinate(price)),visible:p.chart.timeScale().getVisibleLogicalRange(),pane:p.chart.paneSize(),leftWidth:p.chart.priceScale("left").width()};}

export async function secondStudy(source){const result=await createPineRuntimeJob({action:"run",source,bars:state.bars,inputs:{},context,mode:"historical"}).promise,adapted=adaptPineChartResult(result,state.bars),p=state.placements[0],installed=installPineChartPlots(p.chart,adapted.plots.filter(plot=>plot.overlay));(p.additional??=[]).push(installed);await paint();return{labels:result.labels,summary:summary()};}
