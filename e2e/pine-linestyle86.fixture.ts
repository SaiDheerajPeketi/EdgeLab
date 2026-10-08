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
  if (state) for (const p of state.placements) { p.installed.dispose(); p.chart.remove(); }
  const main = document.querySelector("#main"), pane = document.querySelector("#pane");
  main.replaceChildren(); pane.replaceChildren(); pane.hidden = true;
  const adapted = adaptPineChartResult(result, bars), bounds = options.bounds ?? [80, 120];
  function make(element, candles) {
    element.hidden = false;
    const chart = createChart(element, { width: element.clientWidth, height: innerWidth < 600 ? 290 : 390,
      layout: { background: { color: "#111827" }, textColor: "#cbd5e1" }, grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false, timeVisible: true },
      crosshair: { vertLine: { visible: false }, horzLine: { visible: false } } });
    const fixed = () => ({ priceRange: { minValue: bounds[0], maxValue: bounds[1] } });
    const base = candles ? chart.addCandlestickSeries({ upColor: "#475569", downColor: "#475569", wickUpColor: "#475569", wickDownColor: "#475569", borderVisible: false, lastValueVisible: false, priceLineVisible: false, autoscaleInfoProvider: fixed })
      : chart.addLineSeries({ color: "transparent", lineVisible: false, lastValueVisible: false, priceLineVisible: false, autoscaleInfoProvider: fixed });
    const chartBars = options.chartBars ?? bars;
    base.setData(candles ? chartBars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })) : chartBars.map(b => ({ time: b.time, value: bounds[0] })));
    chart.timeScale().setVisibleLogicalRange({ from: options.from ?? 10, to: options.to ?? 35 });
    return { chart, base, element, installed: null };
  }
  const placements = [make(main, Boolean(options.candles))];
  if (adapted.plots.some(p => !p.overlay)) placements.push(make(pane, false));
  await paint();
  placements[0].installed = installPineChartPlots(placements[0].chart, adapted.plots.filter(p => p.overlay), "right", { allowFillOnlyScale: false, scaleAnchor: (options.chartBars ?? bars).at(-1) });
  if (placements[1]) placements[1].installed = installPineChartPlots(placements[1].chart, adapted.plots.filter(p => !p.overlay));
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
  return { plots: state.result.plots.map(p => ({ name: p.name, style: p.style, options: p.options, points: getPackedPinePlot(p) ? undefined : p.points?.map(v => ({ time: v.time, value: v.value, options: v.options })) })),
    inputs: state.result.inputs, warnings: state.adapted.warnings, adapterWarnings: state.adapted.adapterWarnings, packed: state.result.plots.map(p => Boolean(getPackedPinePlot(p))),
    placements: state.placements.map(p => ({ visible: p.chart.timeScale().getVisibleLogicalRange(), range: p.installed.primitive?.rangeForVisible(), stats: p.installed.primitive?.debugStats })) };
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
export async function dispose() { for (const p of state.placements) { p.installed.dispose(); p.installed.dispose(); } live?.cancel(); live = null; await paint(); return state.placements.map(p => p.installed.primitive?.debugStats); }
export async function startLive(source, bars, options = {}) {
  live?.cancel(); live = createPineLiveRuntimeSession({ source, bars, inputs: options.inputs ?? {}, context });
  return render(await live.promise, bars, options);
}
export async function updateLive(bar, confirmed) {
  const result = await live.update(bar, confirmed);
  const bars = state.bars.at(-1).time === bar.time ? [...state.bars.slice(0, -1), bar] : [...state.bars, bar];
  return render(result, bars, state.options);
}
