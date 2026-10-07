import { PINE_LIMITS, PineProtocolError, boundedPineMetadataBytes } from "./pineProtocol";
import type { PinePlot, PineResult, PineScalar } from "./pineProtocol";

export type PinePlotPoint = { time: number; value: number | boolean | null | number[]; options: Record<string, PineScalar> };
export type PinePackedPlot = Omit<PinePlot, "points"> & { packed: {
  count: number; slots: number; arity: 1 | 4; values: number; kinds: number; optionIndices: number;
  optionTable: Record<string, PineScalar>[]; numericOptions?: string[];
} };
export type PinePackedResponse = { id: string; status: "completed"; encoding: "pine-packed-v1"; result: Omit<Extract<PineResult, { kind: "run" }>, "plots"> & { plots: PinePackedPlot[] }; buffers: ArrayBuffer[] };
export type PinePackedView = { values: Float64Array; kinds: Uint8Array; optionIndices: Uint16Array; optionTable: Record<string, PineScalar>[]; arity: 1 | 4; count: number; slots: number; numericOptions: string[]; numericValues: Float64Array; numericKinds: Uint8Array };
const backing = new WeakMap<object, PinePackedView>();
const times = new WeakMap<object, readonly { time: number }[]>();
function fail(message: string, code = "INVALID_MESSAGE"): never { throw new PineProtocolError(code, message); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("Expected plain packed metadata.");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail("Unexpected packed metadata field.");
}
export function validatePinePlotOptions(value: unknown): Record<string, PineScalar> {
  const raw = object(value), entries = Object.entries(raw);
  if (entries.length > 64) fail("Too many plot option fields.", "RESULT_LIMIT");
  const options: Record<string, PineScalar> = {};
  for (const [key, val] of entries) {
    if (key.length > 128 || ["__proto__", "prototype", "constructor"].includes(key)) fail("Unsafe native plot option key.");
    if (!(val === null || typeof val === "boolean" || (typeof val === "number" && Number.isFinite(val)) || (typeof val === "string" && val.length <= 4096))) fail("Invalid native plot option value.");
    options[key] = val as PineScalar;
  }
  return options;
}

/** Check every owned buffer and the aggregate allocation before creating typed views. */
export function validatePinePackedBuffers(value: unknown, channels: number): { buffers: ArrayBuffer[]; bytes: number } {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).some((key) => typeof key !== "string" || (key !== "length" && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))) || value.length !== channels * 3 || value.length > PINE_LIMITS.plots * 3) fail("Invalid packed buffer count.");
  const seen = new Set<ArrayBuffer>();
  let bytes = 0;
  const buffers = value.map((item) => {
    if (!item || Object.getPrototypeOf(item) !== ArrayBuffer.prototype || Reflect.ownKeys(item).length || (item as { resizable?: boolean }).resizable === true) fail("Packed data requires fixed owned ArrayBuffers.");
    const buffer = item as ArrayBuffer;
    if (seen.has(buffer)) fail("Aliased packed buffers are not allowed.");
    seen.add(buffer);
    try { new Uint8Array(buffer); bytes += buffer.byteLength; } catch { fail("Detached or invalid packed buffer."); }
    if (bytes > PINE_LIMITS.resultBytes) fail("Packed output exceeds 16 MB.", "RESULT_LIMIT");
    return buffer;
  });
  return { buffers, bytes };
}
function optionsAt(view: PinePackedView, index: number): Record<string, PineScalar> {
  const base = view.optionTable[view.optionIndices[index]];
  if (!view.numericOptions.length) return base;
  const options = { ...base };
  view.numericOptions.forEach((key, lane) => {
    const cell = lane * view.slots + index;
    if (view.numericKinds[cell]) options[key] = view.numericValues[cell];
  });
  return options;
}
/** Stream option variants without projecting or retaining packed point objects. */
export function pinePlotOptionSets(plot: PinePlot): Iterable<Record<string, PineScalar>> & {
  some(predicate: (options: Record<string, PineScalar>) => boolean): boolean;
  every(predicate: (options: Record<string, PineScalar>) => boolean): boolean;
} {
  const view = backing.get(plot.points);
  function* entries() {
    if (!view) { for (const point of plot.points) yield point.options; }
    else if (!view.numericOptions.length) yield* view.optionTable;
    else for (let index = 0; index < view.slots; index++) if (view.kinds[index]) yield optionsAt(view, index);
  }
  return {
    [Symbol.iterator]: entries,
    some(predicate) { for (const options of entries()) if (predicate(options)) return true; return false; },
    every(predicate) { for (const options of entries()) if (!predicate(options)) return false; return true; },
  };
}
function read(view: PinePackedView, bars: readonly { time: number }[], index: number): PinePlotPoint | undefined {
  if (!Number.isInteger(index) || index < 0 || index >= view.slots) return undefined;
  const kind = view.kinds[index];
  if (!kind) return undefined;
  const start = index * view.arity;
  const value = kind === 1 ? null : kind === 2 ? false : kind === 3 ? true : kind === 5 ? Array.from(view.values.subarray(start, start + 4)) : view.values[start];
  return { time: bars[index].time, value, options: optionsAt(view, index) };
}
export function getPackedPinePlot(plot: PinePlot): PinePackedView | undefined { return backing.get(plot.points); }
export function pointAtBar(plot: PinePlot, barIndex: number): PinePlotPoint | undefined {
  const view = backing.get(plot.points), bars = times.get(plot.points);
  return view && bars ? read(view, bars, barIndex) : undefined;
}
function pointView(view: PinePackedView, bars: readonly { time: number }[]): readonly PinePlotPoint[] {
  // Only sparse channels need an index map; no point objects are retained.
  const indices = view.count === view.slots ? undefined : new Uint16Array(view.count);
  if (indices) { let cursor = 0; for (let index = 0; index < view.slots; index++) if (view.kinds[index]) indices[cursor++] = index; }
  const target = Object.freeze(Object.assign(Object.create(Array.prototype), { length: view.count }));
  const collection = new Proxy(target, {
    get(item, key) {
      if (typeof key === "string" && /^(0|[1-9]\d*)$/.test(key)) { const index = Number(key); return index < view.count ? read(view, bars, indices?.[index] ?? index) : undefined; }
      return Reflect.get(item, key);
    },
    has(item, key) { return typeof key === "string" && /^(0|[1-9]\d*)$/.test(key) ? Number(key) < view.count : Reflect.has(item, key); },
    set() { return false; }, defineProperty() { return false; }, deleteProperty() { return false; },
  }) as readonly PinePlotPoint[];
  backing.set(collection, view); times.set(collection, bars);
  return collection;
}

export function decodePinePackedPlots(metadata: unknown[], buffers: ArrayBuffer[], bars: readonly { time: number }[]): PinePlot[] {
  const used = new Set<number>();
  let slots = 0;
  const plots = metadata.map((item): PinePlot => {
    const plot = object(item); keys(plot, ["id", "name", "style", "overlay", "options", "packed"]);
    if (typeof plot.id !== "string" || !plot.id || plot.id.length > 128 || typeof plot.name !== "string" || plot.name.length > 4096 || typeof plot.style !== "string" || plot.style.length > 64 || typeof plot.overlay !== "boolean") fail("Invalid packed plot identity.");
    const raw = object(plot.packed); keys(raw, ["count", "slots", "arity", "values", "kinds", "optionIndices", "optionTable", "numericOptions"]);
    if (raw.slots !== bars.length || !Number.isInteger(raw.count) || (raw.count as number) < 0 || (raw.count as number) > bars.length || ![1, 4].includes(raw.arity as number)) fail("Invalid packed plot dimensions.");
    slots += bars.length;
    if (slots > PINE_LIMITS.points) fail("Packed output exceeds 1,280,000 bar slots.", "RESULT_LIMIT");
    const arity = raw.arity as 1 | 4;
    const numericOptions = raw.numericOptions === undefined ? [] : raw.numericOptions;
    if (!Array.isArray(numericOptions) || numericOptions.length > 64 || new Set(numericOptions).size !== numericOptions.length || numericOptions.some((key) => typeof key !== "string" || !key.length || key.length > 128 || ["__proto__", "prototype", "constructor"].includes(key))) fail("Invalid packed numeric option names.");
    const names = numericOptions as string[];
    function buffer(key: "values" | "kinds" | "optionIndices", bytes: number) {
      const index = raw[key];
      if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= buffers.length || used.has(index as number)) fail("Invalid or repeated packed buffer reference.");
      used.add(index as number);
      const result = buffers[index as number];
      if (result.byteLength !== bytes) fail("Misaligned or incorrectly sized packed buffer.");
      return result;
    }
    const valueBuffer = buffer("values", bars.length * (arity + names.length) * 8);
    const kindBuffer = buffer("kinds", bars.length * (1 + names.length));
    const values = new Float64Array(valueBuffer, 0, bars.length * arity);
    const kinds = new Uint8Array(kindBuffer, 0, bars.length);
    const numericValues = new Float64Array(valueBuffer, values.byteLength);
    const numericKinds = new Uint8Array(kindBuffer, kinds.byteLength);
    const optionIndices = new Uint16Array(buffer("optionIndices", bars.length * 2));
    if (!Array.isArray(raw.optionTable) || !raw.optionTable.length || raw.optionTable.length > 65_536) fail("Invalid packed option dictionary.");
    const optionTable = raw.optionTable.map((entry) => Object.freeze(validatePinePlotOptions(entry)));
    for (const entry of optionTable) if (names.some((key) => typeof entry[key] === "number")) fail("Numeric option dictionary contradicts lane ownership.");
    const optionSizes = optionTable.map((entry) => Object.keys(entry).length);
    const usedNumeric = new Uint8Array(names.length);
    let count = 0;
    for (let index = 0; index < kinds.length; index++) {
      const kind = kinds[index];
      if (kind > 5 || (kind === 5 && arity !== 4) || optionIndices[index] >= optionTable.length) fail("Invalid packed kind or option reference.");
      if (kind) count++;
      for (let lane = 0; lane < arity; lane++) {
        const val = values[index * arity + lane];
        if (!Number.isFinite(val) || ((kind < 4 || (kind === 4 && lane > 0)) && val !== 0)) fail("Invalid packed numeric cell.");
      }
      let fields = optionSizes[optionIndices[index]];
      for (let lane = 0; lane < names.length; lane++) {
        const cell = lane * bars.length + index, present = numericKinds[cell], val = numericValues[cell];
        if (present > 1 || !Number.isFinite(val) || (!present && val !== 0) || (!kind && present)) fail("Invalid packed numeric option cell.");
        if (present) {
          if (Object.prototype.hasOwnProperty.call(optionTable[optionIndices[index]], names[lane])) fail("Numeric option has contradictory dictionary ownership.");
          usedNumeric[lane] = 1; fields++;
        }
      }
      if (fields > 64) fail("Too many reconstructed plot option fields.", "RESULT_LIMIT");
    }
    if (usedNumeric.some((used) => !used)) fail("Unused packed numeric option lane.");
    if (count !== raw.count) fail("Packed point count does not match kinds.");
    const view: PinePackedView = { values, kinds, optionIndices, optionTable, arity, count, slots: bars.length, numericOptions: names, numericValues, numericKinds };
    return { id: plot.id, name: plot.name, style: plot.style, overlay: plot.overlay, options: validatePinePlotOptions(plot.options), points: pointView(view, bars) };
  });
  if (used.size !== buffers.length) fail("Unreferenced packed buffer.");
  return plots;
}

type PlotInput = Omit<PinePlot, "points"> & { points: Iterable<PinePlotPoint> };
export function encodePinePackedPlots(plots: readonly PlotInput[], bars: readonly { time: number }[]): { plots: PinePackedPlot[]; buffers: ArrayBuffer[] } {
  if (plots.length > PINE_LIMITS.plots) fail("Native Pine output exceeds 64 channels.", "PLOT_LIMIT");
  if (plots.length * bars.length > PINE_LIMITS.points) fail("Native Pine output exceeds 1,280,000 bar slots.", "POINT_LIMIT");
  const barIndices = new Map(bars.map((bar, index) => [bar.time, index]));
  const buffers: ArrayBuffer[] = [];
  let bytes = 0, dictionaryBytes = 0;
  const metadata = plots.map((plot): PinePackedPlot => {
    const retained = backing.get(plot.points);
    if (retained && times.get(plot.points)?.length === bars.length && times.get(plot.points)!.every((bar, index) => bar.time === bars[index].time)) {
      const offset = buffers.length; buffers.push(retained.values.buffer as ArrayBuffer, retained.kinds.buffer as ArrayBuffer, retained.optionIndices.buffer as ArrayBuffer);
      bytes += retained.values.buffer.byteLength + retained.kinds.buffer.byteLength + retained.optionIndices.buffer.byteLength;
      if (bytes > PINE_LIMITS.resultBytes) fail("Packed output exceeds 16 MB.", "RESULT_LIMIT");
      return { id: plot.id, name: plot.name, style: plot.style, overlay: plot.overlay, options: plot.options, packed: { count: retained.count, slots: retained.slots, arity: retained.arity, values: offset, kinds: offset + 1, optionIndices: offset + 2, optionTable: retained.optionTable, ...(retained.numericOptions.length ? { numericOptions: retained.numericOptions } : {}) } };
    }
    // The style determines OHLC arity; arrays in scalar channels are rejected rather than lost.
    const arity = ["candle", "candles", "plotcandle", "bar", "plotbar"].includes(plot.style.replace(/^(?:plot\.)?style_/, "")) ? 4 : 1;
    bytes += bars.length * (arity * 8 + 3);
    if (bytes > PINE_LIMITS.resultBytes) fail("Native Pine output exceeds 16 MB.", "RESULT_LIMIT");
    const values = new Float64Array(bars.length * arity), kinds = new Uint8Array(bars.length), optionIndices = new Uint16Array(bars.length);
    let optionTable: Record<string, PineScalar>[] = [{}];
    const dictionary = new Map<string, number>([["{}", 0]]);
    const numeric = new Map<string, { values: Float64Array; kinds: Uint8Array }>();
    const firstNumeric = new Map<string, number>();
    let count = 0, previous = -1;
    for (const point of plot.points) {
      const index = barIndices.get(point.time);
      if (index === undefined || index <= previous) fail("Plot timestamps must be ordered, unique and belong to the chart snapshot.");
      previous = index; count++;
      const val = point.value;
      if (val === null) kinds[index] = 1;
      else if (val === false) kinds[index] = 2;
      else if (val === true) kinds[index] = 3;
      else if (typeof val === "number" && Number.isFinite(val)) { kinds[index] = 4; values[index * arity] = val; }
      else if (Array.isArray(val) && val.length === 4 && arity === 4 && val.every((lane) => typeof lane === "number" && Number.isFinite(lane))) { kinds[index] = 5; values.set(val, index * 4); }
      else fail("Unsupported packed plot value.");
      const options = validatePinePlotOptions(point.options);
      for (const [key, value] of Object.entries(options)) if (typeof value === "number") {
        let lane = numeric.get(key);
        if (!firstNumeric.has(key)) firstNumeric.set(key, value);
        if (!lane && value !== firstNumeric.get(key)) {
          if (numeric.size >= 64) fail("Too many numeric plot option keys.", "RESULT_LIMIT");
          if (bytes + (numeric.size + 1) * bars.length * 9 > PINE_LIMITS.resultBytes) fail("Numeric plot options exceed 16 MB.", "RESULT_LIMIT");
          lane = { values: new Float64Array(bars.length), kinds: new Uint8Array(bars.length) };
          // Promote only changing numbers. Earlier constant samples are recovered from the small dictionary.
          for (let prior = 0; prior < index; prior++) if (kinds[prior]) {
            const earlier = optionTable[optionIndices[prior]][key];
            if (typeof earlier === "number") { lane.values[prior] = earlier; lane.kinds[prior] = 1; }
          }
          numeric.set(key, lane);
        }
        if (lane) { lane.values[index] = value; lane.kinds[index] = 1; delete options[key]; }
      }
      const key = JSON.stringify(Object.fromEntries(Object.entries(options).sort(([a], [b]) => a.localeCompare(b))));
      let option = dictionary.get(key);
      if (option === undefined) {
        dictionaryBytes += new TextEncoder().encode(key).length;
        if (dictionaryBytes > PINE_LIMITS.metadataBytes || optionTable.length >= 65_536) fail("Native plot option dictionary exceeds its metadata budget.", "RESULT_LIMIT");
        option = optionTable.length; dictionary.set(key, option); optionTable.push(options);
      }
      optionIndices[index] = option;
    }
    // Strip historical promoted numbers once, keeping constant and nonnumeric fallbacks in metadata.
    const varying = [...numeric];
    if (varying.length) {
      const folded: Record<string, PineScalar>[] = [{}], foldedKeys = new Map<string, number>([["{}", 0]]);
      const remap = optionTable.map((entry) => {
        const options = { ...entry };
        for (const [key] of varying) if (typeof options[key] === "number") delete options[key];
        const key = JSON.stringify(Object.fromEntries(Object.entries(options).sort(([a], [b]) => a.localeCompare(b))));
        let mapped = foldedKeys.get(key);
        if (mapped === undefined) { mapped = folded.length; foldedKeys.set(key, mapped); folded.push(options); }
        return mapped;
      });
      for (let index = 0; index < bars.length; index++) optionIndices[index] = remap[optionIndices[index]];
      optionTable = folded;
    }
    bytes += varying.length * bars.length * 9;
    if (bytes > PINE_LIMITS.resultBytes) fail("Numeric plot options exceed 16 MB.", "RESULT_LIMIT");
    const packedValues = varying.length ? new Float64Array(bars.length * (arity + varying.length)) : values;
    const packedKinds = varying.length ? new Uint8Array(bars.length * (1 + varying.length)) : kinds;
    if (varying.length) {
      packedValues.set(values); packedKinds.set(kinds);
      varying.forEach(([, lane], index) => {
        packedValues.set(lane.values, bars.length * (arity + index));
        packedKinds.set(lane.kinds, bars.length * (1 + index));
      });
    }
    const offset = buffers.length; buffers.push(packedValues.buffer, packedKinds.buffer, optionIndices.buffer);
    return { id: plot.id, name: plot.name, style: plot.style, overlay: plot.overlay, options: validatePinePlotOptions(plot.options), packed: { count, slots: bars.length, arity, values: offset, kinds: offset + 1, optionIndices: offset + 2, optionTable, ...(varying.length ? { numericOptions: varying.map(([key]) => key) } : {}) } };
  });
  return { plots: metadata, buffers };
}

export function toPineWireResponse(id: string, result: PineResult, bars: readonly { time: number }[] = []): { id: string; status: "completed"; result: PineResult } | PinePackedResponse {
  if (result.kind === "prepare" || (result.plots.length * bars.length <= PINE_LIMITS.legacyPoints && !result.plots.some((plot) => backing.has(plot.points)))) return { id, status: "completed", result };
  const packed = encodePinePackedPlots(result.plots, bars);
  const response: PinePackedResponse = { id, status: "completed", encoding: "pine-packed-v1", result: { ...result, plots: packed.plots }, buffers: packed.buffers };
  const checked = validatePinePackedBuffers(response.buffers, response.result.plots.length);
  const metadataBytes = boundedPineMetadataBytes({ ...response, buffers: [] });
  if (metadataBytes > PINE_LIMITS.metadataBytes || checked.bytes + metadataBytes > PINE_LIMITS.resultBytes) fail("Packed Pine result exceeds its metadata or total byte budget.", "RESULT_LIMIT");
  return response;
}
