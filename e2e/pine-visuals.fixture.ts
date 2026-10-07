import { createChart } from "../frontend/node_modules/lightweight-charts";
import { createPineRuntimeJob } from "../frontend/src/lib/pineRuntime";
import { adaptPineChartResult, installPineChartPlots } from "../frontend/src/lib/pineChartAdapter";
import { getPackedPinePlot } from "../frontend/src/lib/pinePacked";
let state;
const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
// LWC v4 takeScreenshot excludes the top primitive canvas. Composite every actual chart canvas using its DOM placement so shape/text pixel proofs include that layer.
const image = (chart, element) => {
  const canvas = document.createElement("canvas"), rect = element.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  const ctx = canvas.getContext("2d");
  for (const layer of element.querySelectorAll("canvas")) {
    const bounds = layer.getBoundingClientRect();
    ctx.drawImage(layer, bounds.left - rect.left, bounds.top - rect.top, bounds.width, bounds.height);
  }
  return { width: canvas.width, height: canvas.height, pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
};
export async function run(source, bars, options = {}) {
  if (state)
    for (const p of state.placements) {
      p.installed?.dispose();
      p.chart.remove();
    }
  const main = document.querySelector("#main"), pane = document.querySelector("#pane");
  main.replaceChildren();
  pane.replaceChildren();
  pane.hidden = true;
  const result = await createPineRuntimeJob({ action: "run", source, bars, context: { symbol: "TEST", timeframe: "1", mintick: .01, pointvalue: 1 }, mode: "historical" }).promise;
  const adapted = adaptPineChartResult(result, bars), bounds = options.bounds ?? [80, 120], from = options.from ?? Math.max(0, bars.length - 30), to = options.to ?? bars.length - 1;
  function make(element, candles) {
    element.hidden = false;
    const chart = createChart(element, { width: element.clientWidth, height: innerWidth < 600 ? 290 : 390, layout: { background: { color: "#111827" }, textColor: "#cbd5e1" }, grid: { vertLines: { visible: false }, horzLines: { visible: false } }, rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false, timeVisible: true }, crosshair: { vertLine: { visible: false }, horzLine: { visible: false } } });
    const fixed = () => ({ priceRange: { minValue: bounds[0], maxValue: bounds[1] } });
    const base = candles ? chart.addCandlestickSeries({ upColor: "#475569", downColor: "#475569", wickUpColor: "#475569", wickDownColor: "#475569", borderVisible: false, autoscaleInfoProvider: fixed })
      : chart.addLineSeries({ color: "transparent", lineVisible: false, lastValueVisible: false, priceLineVisible: false, autoscaleInfoProvider: fixed });
    base.setData(candles ? bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })) : bars.map(b => ({ time: b.time, value: bounds[0] })));
    chart.timeScale().setVisibleLogicalRange({ from, to });
    return { chart, base, element, before: null, installed: null };
  }
  const placements = [make(main, true)];
  if (adapted.plots.some(p => !p.overlay))
    placements.push(make(pane, false));
  await paint();
  for (const p of placements) {
    p.before = image(p.chart, p.element);
    p.beforeCoordinate = p.base.priceToCoordinate(100);
  }
  placements[0].installed = installPineChartPlots(placements[0].chart, adapted.plots.filter(p => p.overlay), "right", { allowFillOnlyScale: false });
  if (placements[1])
    placements[1].installed = installPineChartPlots(placements[1].chart, adapted.plots.filter(p => !p.overlay));
  state = { result, adapted, bars, placements };
  document.querySelector("#status").textContent = result.name + " · " + result.audit.engine + " " + result.audit.engineVersion + " · " + result.plots.length + " outputs · " + bars.length + " bars";
  await paint();
  return summary();
}
export function summary() { return { outputs: state.result.plots.length, plots: state.result.plots.map(p => ({ id: p.id, name: p.name, style: p.style, options: p.options })), drawn: state.adapted.plots.map(p => p.name), warnings: state.adapted.warnings, packed: state.result.plots.map(p => Boolean(getPackedPinePlot(p))), placements: state.placements.map(p => ({ beforeCoordinate: p.beforeCoordinate, primaryCoordinate: p.base.priceToCoordinate(100), visible: p.chart.timeScale().getVisibleLogicalRange(), series: p.installed.series.length, finiteHostCoordinate: p.installed.series.length ? Number.isFinite(p.installed.series[0].priceToCoordinate(100)) : true, range: p.installed.primitive?.rangeForVisible(), stats: p.installed.primitive?.debugStats })) }; }
export function probe(time, price, { placement = 0, radius = 2, dx = 0, dy = 0 } = {}) {
  const p = state.placements[placement], after = image(p.chart, p.element), before = p.before, x = p.chart.timeScale().timeToCoordinate(time), y = (p.disposed ? p.base : p.installed.series[0] ?? p.base)?.priceToCoordinate(price);
  if (x === null || y === null || !Number.isFinite(x + y))
    return { x, y, changed: 0, red: 0, green: 0, blue: 0, white: 0 };
  let changed = 0, red = 0, green = 0, blue = 0, white = 0;
  const cx = Math.round(x + dx), cy = Math.round(y + dy);
  for (let yy = cy - radius; yy <= cy + radius; yy++)
    for (let xx = cx - radius; xx <= cx + radius; xx++) {
      if (xx < 0 || yy < 0 || xx >= after.width || yy >= after.height)
        continue;
      const o = (yy * after.width + xx) * 4, [r, g, b] = after.pixels.slice(o, o + 3);
      if ([0, 1, 2].some(l => Math.abs(after.pixels[o + l] - before.pixels[o + l]) > 8))
        changed++;
      if (r > 100 && r > g * 1.3 && r > b * 1.3)
        red++;
      if (g > 100 && g > r * 1.3 && g > b * 1.2)
        green++;
      if (b > 100 && b > r * 1.3)
        blue++;
      if (r > 210 && g > 210 && b > 210)
        white++;
    }
  const offset = (cy * after.width + cx) * 4;
  const samplePrice = (p.disposed ? p.base : p.installed.series[0] ?? p.base).coordinateToPrice(cy + .5);
  return { x, y, samplePrice, changed, red, green, blue, white, pixel: Array.from(after.pixels.slice(offset, offset + 3)) };
}
export async function pan(from, to) {
  for (const p of state.placements)
    p.chart.timeScale().setVisibleLogicalRange({ from, to });
  await paint();
  return summary();
}
export async function resize() {
  for (const p of state.placements)
    p.chart.resize(p.element.clientWidth, innerWidth < 600 ? 260 : 330);
  await paint();
  return summary();
}
export async function dispose() {
  for (const p of state.placements) {
    p.installed.dispose();
    p.installed.dispose();
    p.disposed = true;
  }
  await paint();
  return state.placements.map(p => ({ stats: p.installed.primitive?.debugStats }));
}
export function intervalProbe(leftTime, rightTime, price, options = {}) { const scale = state.placements[options.placement ?? 0].chart.timeScale(); return probe(rightTime, price, { ...options, dx: (scale.timeToCoordinate(leftTime) - scale.timeToCoordinate(rightTime)) * (1 - (options.fraction ?? .5)), radius: 1 }); }
