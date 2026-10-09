import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createChart, type IChartApi } from "../frontend/node_modules/lightweight-charts";
import { PineInputAnchors } from "../frontend/src/components/PineInputAnchors";
import { createPineRuntimeJob } from "../frontend/src/lib/pineRuntime";
import { adaptPineChartResult, installPineChartPlots } from "../frontend/src/lib/pineChartAdapter";

// Real component/LWC coordinate probe with real native preparation/execution.
// The production app's ownership/persistence path is covered separately.
const chartElement = document.getElementById("chart")!;
const reactRoot = createRoot(document.getElementById("root")!);
const bars = Array.from({ length: 48 }, (_, index) => ({ time: Date.parse("2026-09-15T08:00:00Z") / 1000 + index * 60, open: 100, high: 101, low: 99, close: 100, volume: 10 }));
const paint = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
let chart: IChartApi | undefined, installed: ReturnType<typeof installPineChartPlots> | undefined;
let source = "", definitions: any[] = [], inputs: Record<string, any> = {}, owner = "first", enabled = true, generation = 0;
const ledger: any[] = [], results: any[] = [];
let last: any;
function render() {
  flushSync(() => reactRoot.render(chart && installed?.series[0] ? <PineInputAnchors chart={chart} series={installed.series[0] as any} bars={bars}
    definitions={definitions} inputs={inputs} contextKey={owner} enabled={enabled} onCommit={patch => {
      ledger.push(structuredClone(patch)); inputs = { ...inputs, ...patch };
      void execute();
    }} /> : null));
}
async function execute() {
  const epoch = ++generation;
  const result = await createPineRuntimeJob({ action: "run", source, bars, inputs, context: { symbol: "TEST", timeframe: "1", mintick: .01, pointvalue: 1 }, mode: "historical" }).promise;
  if (epoch !== generation || !chart) return;
  last = result; results.push(structuredClone(result)); installed?.dispose();
  installed = installPineChartPlots(chart, adaptPineChartResult(result, bars).plots);
  chart.timeScale().setVisibleLogicalRange({ from: 5, to: 40 }); render(); await paint();
}
export async function boot(next: string) {
  generation++; flushSync(() => reactRoot.render(null)); installed?.dispose(); chart?.remove();
  source = next; owner = "first"; enabled = true; ledger.length = 0; results.length = 0; inputs = {};
  const metadata = await createPineRuntimeJob({ action: "prepare", source }).promise;
  if (metadata.kind !== "prepare") throw new Error("Expected actual native input definitions");
  definitions = metadata.inputDefinitions;
  chart = createChart(chartElement, { width: chartElement.clientWidth, height: 300,
    layout: { background: { color: "#111827" }, textColor: "#cbd5e1" }, grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    crosshair: { vertLine: { visible: false }, horzLine: { visible: false } }, rightPriceScale: { borderVisible: false },
    timeScale: { timeVisible: true }, handleScroll: false, handleScale: false });
  await execute(); return summary();
}
export function summary() { return { definitions, inputs, ledger, results, last, owner, enabled, pane: chart?.paneSize() }; }
export function projected(time: number, price: number) {
  const rect = chart!.chartElement().getBoundingClientRect(), left = chart!.priceScale("left").width();
  const x = chart!.timeScale().timeToCoordinate(time as any), y = installed!.series[0].priceToCoordinate(price);
  return { x, y, pageX: x! + rect.left + left, pageY: y! + rect.top, pane: chart!.paneSize() };
}
export function inverse(pageX: number, pageY: number) {
  const rect = chart!.chartElement().getBoundingClientRect();
  const x = pageX - rect.left - chart!.priceScale("left").width(), y = pageY - rect.top;
  return { price: installed!.series[0].coordinateToPrice(y), time: chart!.timeScale().coordinateToTime(x) };
}
export async function scale(mode: number, invertScale: boolean) { chart!.priceScale("right").applyOptions({ mode, invertScale }); await paint(); return summary(); }
export async function changeOwner(next: string) { owner = next; render(); await paint(); return summary(); }
export async function show(value: boolean) { enabled = value; render(); await paint(); return summary(); }
export async function resize(width: number) {
  const visible = chart!.timeScale().getVisibleLogicalRange(); chart!.resize(width, 270);
  // This coordinate probe keeps its chosen window; LWC's default resize policy
  // otherwise keeps bar spacing/right edge and may move the anchor offscreen.
  if (visible) chart!.timeScale().setVisibleLogicalRange(visible);
  await paint(); return summary();
}
export async function pan(from: number, to: number) { chart!.timeScale().setVisibleLogicalRange({ from, to }); await paint(); return summary(); }
export async function dispose() { generation++; flushSync(() => reactRoot.render(null)); installed?.dispose(); chart?.remove(); chart = undefined; installed = undefined; await paint(); }
