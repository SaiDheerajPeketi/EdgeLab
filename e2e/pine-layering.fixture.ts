import { createChart } from "../frontend/node_modules/lightweight-charts";
import { createPineRuntimeJob } from "../frontend/src/lib/pineRuntime";
import { adaptPineChartResult, installPineChartPlots, projectPineBarColors } from "../frontend/src/lib/pineChartAdapter";
import { getPackedPinePlot, pointAtBar } from "../frontend/src/lib/pinePacked";

let state: any;
const paint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const context = { symbol: "TEST", timeframe: "1", mintick: 0.01, pointvalue: 1 };

export async function execute(input: any) {
  try {
    const result = await createPineRuntimeJob({ action: input.action ?? "run", source: input.source, bars: input.bars, inputs: input.inputs ?? {}, context, mode: "historical" }).promise;
    return { completed: true, result };
  } catch (error: any) {
    return { completed: false, code: error.code, message: error.message };
  }
}

export async function run(input: any) {
  if (state) {
    for (const owner of Object.values(state.placements) as any[]) {
      owner.installed.dispose();
      owner.chart.remove();
    }
  }
  const response = await execute(input);
  if (!response.completed) return response;
  const result = response.result;
  const adapted = adaptPineChartResult(result, input.bars);
  const projection = projectPineBarColors(adapted.plots, input.bars);
  const placements: any = {};
  for (const placement of ["main", "pane"]) {
    const element = document.getElementById(placement)!;
    element.replaceChildren();
    const chart = createChart(element, {
      width: element.clientWidth,
      height: 220,
      layout: { background: { color: "#111827" }, textColor: "#cbd5e1" },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderVisible: false, invertScale: input.inverted === true },
      timeScale: { visible: false },
      crosshair: { vertLine: { visible: false }, horzLine: { visible: false } },
    });
    const range = () => input.autoScale ? null : ({ priceRange: { minValue: 70, maxValue: 130 } });
    const primary = placement === "main"
      ? chart.addCandlestickSeries({ upColor: "#475569", downColor: "#475569", wickUpColor: "#475569", wickDownColor: "#475569", borderVisible: false, lastValueVisible: false, priceLineVisible: false, autoscaleInfoProvider: range })
      : chart.addLineSeries({ color: "transparent", lineVisible: false, lastValueVisible: false, priceLineVisible: false, autoscaleInfoProvider: range });
    primary.setData(input.bars.map((bar: any, index: number) => placement === "main"
      ? { ...bar, ...(projection.colorAt(index) === undefined ? {} : { color: projection.colorAt(index) }) }
      : { time: bar.time, value: 100 }));
    const plots = adapted.plots.filter((plot) => placement === "main" ? plot.overlay : !plot.overlay);
    const installed = installPineChartPlots(chart, plots, "right", { allowFillOnlyScale: placement !== "main", scaleAnchor: input.bars.at(-1) });
    placements[placement] = { chart, primary, installed, element, disposed: false };
    chart.timeScale().setVisibleLogicalRange({ from: input.from ?? 120, to: input.to ?? 144 });
  }
  state = { result, adapted, placements, bars: input.bars };
  await paint();
  return summary();
}

export function summary() {
  return {
    completed: true,
    engine: state.result.audit.engineVersion,
    source: state.result.source,
    name: state.result.name,
    inputs: state.result.inputs,
    behindChart: state.result.behindChart,
    overlay: state.result.overlay,
    warnings: state.adapted.warnings,
    adapterWarnings: state.adapted.adapterWarnings,
    plots: state.result.plots.map((plot: any) => {
      const packed = getPackedPinePlot(plot);
      const buffers = packed ? [packed.values.buffer, packed.kinds.buffer, packed.optionIndices.buffer] : [];
      return {
        name: plot.name, style: plot.style, options: plot.options, packed: Boolean(packed),
        bufferCount: new Set(buffers).size,
        bufferBytes: buffers.reduce((total, buffer) => total + buffer.byteLength, 0),
        samples: [0, 120, state.bars.length - 1].filter((index) => index < state.bars.length).map((index) => ({ index, point: packed ? pointAtBar(plot, index) : plot.points.find((point: any) => point.time === state.bars[index].time) })),
      };
    }),
    drawn: state.adapted.plots.map((plot: any) => ({ name: plot.name, kind: plot.kind, overlay: plot.overlay, behindChart: plot.behindChart })),
    placements: Object.fromEntries(Object.entries(state.placements).map(([name, owner]: any) => [name, {
      series: owner.installed.series.length,
      visible: owner.chart.timeScale().getVisibleLogicalRange(),
      range: owner.installed.primitive?.rangeForVisible(),
      stats: owner.installed.primitive?.debugStats,
    }])),
  };
}

export function probe(index: number, price: number, placement = "main", between = false, dx = 0) {
  const owner = state.placements[placement];
  const scale = owner.chart.timeScale();
  let x = scale.timeToCoordinate(state.bars[index].time);
  if (between) x = (x + scale.timeToCoordinate(state.bars[index + 1].time)) / 2;
  x += dx;
  const y = owner.primary.priceToCoordinate(price);
  const size = owner.chart.paneSize();
  if (x === null || y === null || !Number.isFinite(x + y) || x < 0 || x >= size.width || y < 0 || y >= size.height) {
    throw new Error("Actual pixel probe outside chart: " + JSON.stringify({ x, y, size, visible: scale.getVisibleLogicalRange() }));
  }
  const rect = owner.element.getBoundingClientRect();
  const ratio = devicePixelRatio;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  const ctx = canvas.getContext("2d")!;
  for (const layer of owner.element.querySelectorAll("canvas") as NodeListOf<HTMLCanvasElement>) {
    const bounds = layer.getBoundingClientRect();
    ctx.drawImage(layer, (bounds.left - rect.left) * ratio, (bounds.top - rect.top) * ratio, bounds.width * ratio, bounds.height * ratio);
  }
  const pixels = ctx.getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data;
  const layers = [...owner.element.querySelectorAll("canvas")].map((layer: HTMLCanvasElement) => {
    const bounds = layer.getBoundingClientRect();
    if (bounds.height < 100 || bounds.left > rect.left + 1) return null;
    const px = Math.round(x * layer.width / bounds.width);
    const py = Math.round(y * layer.height / bounds.height);
    const ctx = layer.getContext("2d")!;
    return { width: layer.width, height: layer.height, cssWidth: bounds.width, cssHeight: bounds.height, left: bounds.left - rect.left, top: bounds.top - rect.top, px, py, rgba: Array.from(ctx.getImageData(px, py, 1, 1).data), neighbors: [-2, -1, 0, 1, 2].map((dx) => ({ dx, rgba: Array.from(ctx.getImageData(px + dx, py, 1, 1).data) })) };
  }).filter(Boolean);
  return { x, y, dx, dpr: ratio, rgb: Array.from(pixels.slice(0, 3)), layers, visible: scale.getVisibleLogicalRange() };
}

export async function pan(from: number, to: number) {
  for (const owner of Object.values(state.placements) as any[]) owner.chart.timeScale().setVisibleLogicalRange({ from, to });
  await paint();
  return summary();
}

export async function resize() {
  for (const owner of Object.values(state.placements) as any[]) owner.chart.resize(owner.element.clientWidth, 128);
  await paint();
  return summary();
}

export async function dispose() {
  for (const owner of Object.values(state.placements) as any[]) {
    owner.installed.dispose();
    owner.installed.dispose();
    owner.disposed = true;
  }
  await paint();
  return summary();
}
