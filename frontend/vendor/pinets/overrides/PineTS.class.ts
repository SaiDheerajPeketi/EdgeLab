// EdgeLab modification, 2026-10-09: explicit realtime rollback and chart-owned historical intrabar fill scheduling.
// Original PineTS 0.11.0 source; licensed AGPL-3.0-only. Upstream notices retained below.
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo
import { IProvider, ISymbolInfo } from './marketData/IProvider';
import { Context } from './Context.class';
import { splitTickerModifier, withTickerModifier } from './tickerModifier';
import { createSyminfo } from './namespaces/Syminfo';
import { Series } from './Series';
import { PineArrayObject } from './namespaces/array/PineArrayObject';
import { getSliceView } from './namespaces/array/sliceView';
import { PineMapObject } from './namespaces/map/PineMapObject';
import { PineMatrixObject } from './namespaces/matrix/PineMatrixObject';
import { PineTypeObject } from './namespaces/PineTypeObject';
import { ChartPointObject } from './namespaces/chart/ChartPointObject';
import { Indicator } from './Indicator';
import { LineObject } from './namespaces/line/LineObject';
import { LineHelper } from './namespaces/line/LineHelper';
import { LinefillObject } from './namespaces/linefill/LinefillObject';
import { LinefillHelper } from './namespaces/linefill/LinefillHelper';
import { processHistoricalFillBar, processStrategyOrders, processOrdersOnClose, processExitOrders, processMarginCall, finalizeStrategyBar, finalizeStrategyRun, isAdverseFirstBar, applyPendingCloseMarginCall, snapshotStrategyState, restoreStrategyState } from './namespaces/strategy/utils';

import { parseTimeframe, timeframeSeconds } from './timeframe';

function getTimeframeDurationMs(timeframe: string | undefined): number {
    const tf = parseTimeframe(timeframe);
    return tf ? timeframeSeconds(tf) * 1000 : 86_400_000; // default to 1D when timeframe is unknown
}

/** Realtime retained-state limits; these do not limit transient allocations in user code. */
const REALTIME_LIMITS = Object.freeze({ nodes: 16_384, cells: 262_144, seriesSlots: 1_280_000 });
type RealtimeLimits = { nodes: number; cells: number; seriesSlots: number };
type RealtimeOptions = { initialTail?: 'open' | 'historical'; limits?: Partial<RealtimeLimits> };
const REALTIME_SCOPES = ['const', 'var', 'let', 'params', 'varip'];
function limitError(metric: string, counts: { nodes: number; mutableCells: number; seriesSlots?: number }) {
    const error: any = new Error(`Realtime retained-state ${metric} limit exceeded.`);
    error.code = 'REALTIME_STATE_LIMIT';
    error.stats = { ...counts };
    return error;
}
function* realtimeContainers(context: any): Generator<any> {
    yield context;
    if (context.lctx) yield* context.lctx.values();
}
function realtimeSlots(context: any, limits: RealtimeLimits): number {
    let slots = 0;
    for (const container of realtimeContainers(context)) for (const kind of REALTIME_SCOPES)
        for (const key in container[kind] ?? {}) {
            const item = container[kind][key];
            if (item instanceof Series) {
                // Each binding is counted: ordinary aliases make independent history copies.
                slots += item.data.length;
                if (slots > limits.seriesSlots) throw limitError('Series slots', { nodes: 0, mutableCells: 0, seriesSlots: slots });
            }
        }
    return slots;
}
function* realtimeRoots(context: any, varipOnly = false): Generator<any> {
    for (const container of realtimeContainers(context)) for (const kind of varipOnly ? ['varip'] : REALTIME_SCOPES)
        for (const key in container[kind] ?? {}) {
            const item = container[kind][key];
            if (item instanceof Series) yield* item.data;
        }
    if (!varipOnly) {
        yield context.taState; yield context.cache;
        // Drawing objects remain active even when their creation result is discarded.
        // Only the known line payload list is a root; never traverse helper/context closures.
        for (const helper of context._drawingHelpers ?? [])
            if (helper instanceof LineHelper) yield (helper as any)._lines;
            else if (helper instanceof LinefillHelper) yield (helper as any)._linefills;
    }
}
const realtimePayload = (value: any): any => value instanceof PineArrayObject ? value.array
    : value instanceof PineMapObject ? value.map : value instanceof PineMatrixObject ? value.matrix : value;
function realtimeFields(value: any): readonly string[] | null {
    if (value instanceof LinefillObject) return ['line1', 'line2', 'color', '_deleted', '_createdAtBar'];
    if (value instanceof LineObject) return ['x1', 'y1', 'x2', 'y2', 'xloc', 'extend', 'color', 'style', 'width', 'force_overlay', '_deleted', '_createdAtBar'];
    if (!(value instanceof PineTypeObject)) return null;
    return value._udt?._definitionKeys ?? Object.keys(value.__def__);
}
const realtimeVaripFields = (value: any): ReadonlySet<string> => value?._udt?.__pineVaripFields ?? new Set<string>();
function realtimePlain(value: any): boolean {
    const prototype = Object.getPrototypeOf(value);
    return value instanceof ChartPointObject || prototype === Object.prototype || prototype === null;
}
function realtimeWeight(target: any, remaining: number): number | null {
    const fields = realtimeFields(target);
    if (fields) return fields.length;
    const view = getSliceView(target);
    if (view) return view.target.length;
    if (Array.isArray(target)) return target.length; // Sparse length is also reserved mutable state.
    if (target instanceof Map) return target.size * 2; // Both key and value graphs are owned.
    if (!realtimePlain(target)) return null;
    let count = 0;
    // Do not allocate Object.entries/keys before establishing the budget.
    for (const key in target) if (Object.prototype.hasOwnProperty.call(target, key)) {
        if (++count > remaining) return count;
    }
    return count;
}
function* realtimeChildren(target: any): Generator<any> {
    const fields = realtimeFields(target);
    if (fields) { for (const key of fields) yield target[key]; return; }
    const view = getSliceView(target);
    if (view) { yield view.parent; return; }
    if (Array.isArray(target)) { for (let i = 0; i < target.length; i++) yield target[i]; return; }
    if (target instanceof Map) { for (const [key, item] of target) { yield key; yield item; } return; }
    if (realtimePlain(target)) for (const key in target)
        if (Object.prototype.hasOwnProperty.call(target, key)) yield target[key];
}
type RealtimeNode = { weight: number; restore: () => void; children: () => Iterable<any> };
/** A rollback graph stores Pine payloads in place, never engine/context closures. */
function realtimeGraph(context: any, limits: RealtimeLimits) {
    const nodes = new Map<any, RealtimeNode>();
    const baseline = new Set<any>();
    const newborns = new WeakSet<object>();
    let prunedNodes = 0;
    // Iterative traversal counts retained rollback references and current reachable payloads
    // jointly. A changing payload reserves max(saved,current) cells, once per identity.
    const measure = (extra?: any) => {
        const seriesSlots = realtimeSlots(context, limits);
        const weights = new Map<any, number>();
        let mutableCells = 0;
        const visit = (target: any, weight: number) => {
            const previous = weights.get(target) ?? 0;
            if (!weights.has(target) && weights.size >= limits.nodes)
                throw limitError('nodes', { nodes: weights.size + 1, mutableCells, seriesSlots });
            mutableCells += Math.max(previous, weight) - previous;
            if (mutableCells > limits.cells)
                throw limitError('mutable cells', { nodes: weights.size + (weights.has(target) ? 0 : 1), mutableCells, seriesSlots });
            weights.set(target, Math.max(previous, weight));
        };
        for (const [target, record] of nodes) visit(target, record.weight);
        const seen = new Set<any>();
        const roots = function* () { yield* realtimeRoots(context); if (extra !== undefined) yield extra;
            for (const record of nodes.values()) yield* record.children(); };
        const stack: Iterator<any>[] = [roots()];
        while (stack.length) {
            const next = stack[stack.length - 1].next();
            if (next.done) { stack.pop(); continue; }
            const value = next.value;
            if (!value || typeof value !== 'object') continue;
            const target = realtimePayload(value);
            if (seen.has(target)) continue;
            const weight = realtimeWeight(target, limits.cells - mutableCells + (weights.get(target) ?? 0));
            if (weight === null) continue;
            visit(target, weight);
            seen.add(target);
            stack.push(realtimeChildren(target));
        }
        return { nodes: weights.size, mutableCells, seriesSlots, baselineNodes: baseline.size,
            newbornNodes: nodes.size - baseline.size, prunedNodes };
    };
    const capture = (root: any, resolved = false, allRoots = false) => {
        measure(allRoots ? undefined : root); // Bounds precede slice/spread/entry-copy allocations.
        const seen = new Set<any>();
        const stack: Iterator<any>[] = [allRoots ? root[Symbol.iterator]() : [root][Symbol.iterator]()];
        while (stack.length) {
            const next = stack[stack.length - 1].next();
            if (next.done) { stack.pop(); continue; }
            const value = next.value;
            if (!value || typeof value !== 'object') continue;
            const target = realtimePayload(value);
            if (seen.has(target)) continue;
            seen.add(target);
            const fields = realtimeFields(target);
            if (nodes.has(target) && !(resolved && target === root && fields)) continue;
            const weight = realtimeWeight(target, limits.cells)!;
            if (weight === null) continue;
            let record: RealtimeNode;
            if (fields) {
                const entries = fields.filter(key => !realtimeVaripFields(value).has(key))
                    .map(key => [key, value[key], Object.prototype.hasOwnProperty.call(value, key)] as const);
                record = { weight, restore: () => { for (const [key, item, present] of entries)
                    if (present) value[key] = item; else delete value[key]; },
                    children: function* () { for (const [, item] of entries) yield item;
                        for (const key of realtimeVaripFields(value)) yield value[key]; } };
            } else if (getSliceView(target)) {
                const view = getSliceView(target)!;
                const length = view.target.length;
                record = { weight, restore: () => { view.target.length = length; }, children: () => [view.parent] };
            } else if (Array.isArray(target)) {
                const entries = target.slice();
                record = { weight, restore: () => { target.length = entries.length;
                    for (let i = 0; i < entries.length; i++) if (i in entries) target[i] = entries[i]; else delete target[i]; },
                    children: () => entries };
            } else if (target instanceof Map) {
                const entries = [...target.entries()];
                record = { weight, restore: () => { target.clear(); for (const [key, item] of entries) target.set(key, item); },
                    children: function* () { for (const [key, item] of entries) { yield key; yield item; } } };
            } else {
                const entries = Object.entries(target);
                record = { weight, restore: () => {
                    for (const key in target) if (Object.prototype.hasOwnProperty.call(target, key)) delete target[key];
                    for (const [key, item] of entries) target[key] = item;
                }, children: function* () { for (const [, item] of entries) yield item; } };
            }
            nodes.set(target, record);
            stack.push(record.children()[Symbol.iterator]());
        }
    };
    // Only committed objects and genuinely surviving varip roots may discover field
    // exemptions. Dead newborns never exempt an aliased committed collection.
    const projected = () => {
        const persistent = new Set<any>();
        const seenOrdinary = new Set<any>();
        const seenPersistent = new Set<any>();
        const reachable = new Set<any>();
        const seeds = function* () {
            for (const target of baseline) yield [target, false] as const;
            for (const value of realtimeRoots(context, true)) yield [value, true] as const;
        };
        const stack: Iterator<readonly [any, boolean]>[] = [seeds()];
        while (stack.length) {
            const next = stack[stack.length - 1].next();
            if (next.done) { stack.pop(); continue; }
            const [value, retain] = next.value;
            if (!value || typeof value !== 'object') continue;
            const target = realtimePayload(value);
            const seen = retain ? seenPersistent : seenOrdinary;
            if (seen.has(target)) continue;
            const weight = realtimeWeight(target, limits.cells);
            if (weight === null) continue;
            seen.add(target);
            reachable.add(target);
            const fields = realtimeFields(target);
            const record = nodes.get(target);
            if (fields) {
                stack.push((function* () {
                    for (const key of realtimeVaripFields(value)) yield [value[key], true] as const;
                    // Birth/rollback references keep ordinary fields of surviving UDTs alive.
                    for (const child of record ? record.children() : realtimeChildren(target)) yield [child, false] as const;
                })());
            } else {
                if (retain) persistent.add(target);
                const children = retain || !record ? realtimeChildren(target) : record.children();
                stack.push((function* () { for (const child of children) yield [child, retain] as const; })());
            }
        }
        return { persistent, reachable };
    };
    // One preflight and one iterative walk cover the complete initial graph.
    capture(realtimeRoots(context), false, true);
    for (const target of nodes.keys()) baseline.add(target);
    return {
        capture: (value: any, resolved = false) => {
            if (!value || typeof value !== 'object') return;
            if (resolved) { if (newborns.has(value)) capture(value, true); }
            else { newborns.add(value); capture(value); }
        },
        restore: () => { measure(); const { persistent } = projected();
            for (const [target, record] of nodes) if (!persistent.has(target)) record.restore(); },
        prune: () => { const { reachable } = projected();
            for (const target of nodes.keys()) if (!baseline.has(target) && !reachable.has(target)) {
                nodes.delete(target); newborns.delete(target); prunedNodes++;
            }
        },
        measure,
    };
}

/**
 * This class is a wrapper for the Pine Script language, it allows to run Pine Script code in a JavaScript environment
 */
export class PineTS {
    public data: any = [];

    //#region [Pine Script built-in variables]
    public open: any = [];
    public high: any = [];
    public low: any = [];
    public close: any = [];
    public volume: any = [];
    public hl2: any = [];
    public hlc3: any = [];
    public ohlc4: any = [];
    public hlcc4: any = [];
    public openTime: any = [];
    public closeTime: any = [];
    //#endregion

    //#region run context
    // private _periods: number = undefined;
    // public get periods() {
    //     return this._periods;
    // }
    //#endregion

    //public fn: Function;

    private _realtimeMode = false;
    private _realtimeContext: Context | null = null;
    private _realtimeUpdating = false;
    private _realtimeInitialTail: 'open' | 'historical' = 'open';
    private _realtimeLimits: RealtimeLimits = { ...REALTIME_LIMITS };
    /** Opt-in indicator tick execution; explicit events, never wall-clock inference. */
    public setRealtimeMode(enabled: boolean, options: RealtimeOptions = {}) {
        if (typeof enabled !== 'boolean' || this._transpiledCode) throw new Error('Realtime mode must be selected before running.');
        if (!options || Object.getPrototypeOf(options) !== Object.prototype)
            throw new Error('Invalid realtime options.');
        const selected: RealtimeOptions = {};
        for (const key of Reflect.ownKeys(options)) {
            if (key !== 'initialTail' && key !== 'limits') throw new Error('Invalid realtime options.');
            const descriptor = Object.getOwnPropertyDescriptor(options, key);
            if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value'))
                throw new Error('Realtime options must contain only data fields.');
            selected[key] = descriptor.value;
        }
        if (selected.initialTail !== undefined && selected.initialTail !== 'open' && selected.initialTail !== 'historical')
            throw new Error('Invalid realtime initial tail.');
        const limits = selected.limits === undefined ? {} : selected.limits;
        if (!limits || Object.getPrototypeOf(limits) !== Object.prototype)
            throw new Error('Invalid realtime limits.');
        const configured: RealtimeLimits = { ...REALTIME_LIMITS };
        for (const key of Reflect.ownKeys(limits)) {
            if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(REALTIME_LIMITS, key))
                throw new Error('Invalid realtime limits.');
            const descriptor = Object.getOwnPropertyDescriptor(limits, key);
            if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value'))
                throw new Error('Realtime limits must contain only data fields.');
            const value = descriptor.value;
            const field = key as keyof RealtimeLimits;
            if (!Number.isSafeInteger(value) || value <= 0 || value > REALTIME_LIMITS[field])
                throw new Error('Realtime limits must be positive integers no larger than the hard caps.');
            configured[field] = value;
        }
        this._realtimeMode = enabled;
        this._realtimeInitialTail = selected.initialTail ?? 'open';
        this._realtimeLimits = configured;
    }

    /** A copied diagnostic snapshot, limited to this engine's owned realtime context. */
    public getRealtimeStats(context: Context = this._realtimeContext): any {
        if (!context || context !== this._realtimeContext) throw new Error('Realtime stats require the owning context.');
        return { ...((context as any)._realtimeMetrics ?? { nodes: 0, mutableCells: 0, seriesSlots: 0,
            baselineNodes: 0, newbornNodes: 0, prunedNodes: 0 }),
            failed: !!(context as any)._realtimeLifecycle?.failed, limits: { ...this._realtimeLimits } };
    }

    private _measureRealtimeState(context: Context) {
        try {
            const graph = (context as any)._realtimeSnapshot?.graph;
            (context as any)._realtimeMetrics = graph ? graph.measure() : realtimeGraph(context, this._realtimeLimits).measure();
        } catch (error) {
            (context as any)._realtimeLifecycle.failed = true;
            (context as any)._realtimeMetrics = { nodes: 0, mutableCells: 0, seriesSlots: 0,
                baselineNodes: 0, newbornNodes: 0, prunedNodes: 0, ...(error as any).stats };
            throw error;
        }
    }

    private _readyPromise: Promise<any> = null;

    private _ready = false;

    private _debugSettings = {
        ln: false,
        debug: false,
    };

    private _transpiledCode: Function | String = null;
    public get transpiledCode() {
        return this._transpiledCode;
    }

    // Tracks the most recently prepared Indicator. Used by the back-compat
    // forwarding paths (e.g. `usesVisibleRange()`) and by the internal
    // _initializeContext to surface the original pineTSCode on the Context.
    private _currentIndicator: Indicator | null = null;

    private _isSecondaryContext: boolean = false;
    public markAsSecondary() {
        this._isSecondaryContext = true;
    }

    private _syminfo: ISymbolInfo;
    private _chartTimezone: string | null = null;

    /**
     * Set the chart display timezone (like TradingView's timezone picker).
     * This only affects log timestamp formatting — it does NOT change the timezone
     * used by computation functions (timestamp(), dayofmonth, hour, etc.), which
     * always use the exchange timezone from syminfo.timezone.
     * @param timezone IANA timezone name (e.g. 'America/New_York'), UTC offset ('UTC+5'), or 'UTC'
     */
    public setTimezone(timezone: string) {
        this._chartTimezone = timezone;
    }

    private _maxLoops: number = 500000;

    /**
     * Set the maximum number of iterations allowed per loop.
     * Mirrors TradingView's internal loop protection. If a for/while loop
     * exceeds this limit, a runtime error is thrown.
     * @param maxLoops Maximum iterations per loop (default: 500000)
     */
    public setMaxLoops(maxLoops: number) {
        this._maxLoops = maxLoops;
    }

    private _alertMode: 'realtime' | 'all' = 'realtime';

    /**
     * Set alert mode.
     * - 'realtime' (default): alerts only fire on the last (realtime) bar,
     *   matching TradingView behavior.
     * - 'all': alerts fire on every bar, useful for backtesting alert strategies.
     * @param mode Alert firing mode
     */
    public setAlertMode(mode: 'realtime' | 'all') {
        this._alertMode = mode;
    }

    // ── Visible-range / host environment ────────────────────────────────
    // Values come from the host (UI). When unset, Pine built-ins like
    // `chart.left_visible_bar_time` fall back to marketData-derived defaults
    // (first/last loaded bar's openTime).
    private _viewportLeft: number | undefined = undefined;
    private _viewportRight: number | undefined = undefined;

    // Set by `run()` from the prepared Indicator. Mirrors the Indicator's own
    // `usesVisibleRange` flag on the PineTS instance so legacy callers of
    // `pine.usesVisibleRange()` keep working.
    // True iff the script references any built-in in VIEWPORT_DEPENDENT_BUILTINS.
    // Consumers should check this before re-running on viewport changes — non-
    // viewport-dependent scripts produce identical output regardless of viewport.
    private _usesVisibleRange: boolean = false;

    // Snapshot of viewport at the time of the last update()-cached run, used to
    // decide whether an update() call can return the cached result.
    private _lastRunViewport: { left?: number; right?: number } = {};
    private _lastResult: Context | null = null;
    private _lastPineTSCode: Indicator | Function | String | null = null;

    /**
     * Set the visible range of bars from the host (e.g. chart UI viewport).
     * Affects `chart.left_visible_bar_time` and `chart.right_visible_bar_time`.
     * Defaults derive from `marketData[0]/[last].openTime` if never called.
     *
     * The setter only stores values; it does NOT trigger a re-run. Call
     * `update()` afterwards to apply the change. For scripts that don't
     * reference visible-range built-ins, `update()` is a no-op.
     *
     * @param left  openTime of the leftmost visible bar
     * @param right openTime of the rightmost visible bar
     */
    public setVisibleRange(left: number, right: number): void {
        this._viewportLeft = left;
        this._viewportRight = right;
    }

    /**
     * Whether the loaded script references any visible-range built-in
     * (e.g. `chart.left_visible_bar_time`). Detected statically during
     * transpile. Consumers fanning viewport changes across many indicators
     * should skip non-tagged instances to avoid unnecessary re-runs.
     */
    public usesVisibleRange(): boolean {
        return this._usesVisibleRange;
    }

    /** Current viewport left (undefined if setter never called). */
    public get visibleRangeLeft(): number | undefined {
        return this._viewportLeft;
    }

    /** Current viewport right (undefined if setter never called). */
    public get visibleRangeRight(): number | undefined {
        return this._viewportRight;
    }

    /**
     * Smart re-run: executes `run()` only if a re-run is actually needed.
     *
     * - First call: behaves like `run()` (always executes).
     * - Subsequent calls: returns the cached previous result UNLESS the script
     *   is viewport-dependent (`usesVisibleRange()`) AND the viewport has
     *   changed since the last cached run.
     *
     * The typical pattern for a chart consumer with multiple indicators:
     *
     *     // user pans the chart
     *     for (const p of indicators) {
     *         p.setVisibleRange(left, right);
     *         await p.update(code);   // no-op for non-viewport indicators
     *     }
     *
     * The pineTSCode argument is optional after the first call — the same code
     * is reused. Pass it again only when the script source itself has changed.
     */
    public async update(pineTSCode?: Indicator | Function | String): Promise<Context> {
        const codeToRun = pineTSCode ?? this._lastPineTSCode;
        if (!codeToRun) {
            throw new Error('pine.update(): pineTSCode is required on the first call.');
        }

        const isFirstRun = this._lastResult === null;
        const viewportChanged = this._viewportLeft !== this._lastRunViewport.left
            || this._viewportRight !== this._lastRunViewport.right;

        const needsRun = isFirstRun || (this._usesVisibleRange && viewportChanged);
        if (!needsRun) return this._lastResult as Context;

        this._lastPineTSCode = codeToRun;
        this._lastRunViewport = { left: this._viewportLeft, right: this._viewportRight };
        this._lastResult = (await this.run(codeToRun)) as Context;
        return this._lastResult;
    }

    constructor(
        private source: IProvider | any[],
        private tickerId?: string,
        private timeframe?: string,
        private limit?: number,
        private sDate?: number,
        private eDate?: number,
    ) {
        this._readyPromise = new Promise((resolve) => {
            this.loadMarketData(source, tickerId, timeframe, limit, sDate, eDate).then((data) => {
                const marketData = data;

                //this._periods = marketData.length;
                this.data = marketData;

                const _open = marketData.map((d) => d.open);
                const _close = marketData.map((d) => d.close);
                const _high = marketData.map((d) => d.high);
                const _low = marketData.map((d) => d.low);
                const _volume = marketData.map((d) => d.volume);
                const _hlc3 = marketData.map((d) => (d.high + d.low + d.close) / 3);
                const _hl2 = marketData.map((d) => (d.high + d.low) / 2);
                const _ohlc4 = marketData.map((d) => (d.high + d.low + d.open + d.close) / 4);
                const _hlcc4 = marketData.map((d) => (d.high + d.low + d.close + d.close) / 4);
                const _openTime = marketData.map((d) => d.openTime);
                // Providers should supply closeTime as session close time (TV convention).
                // Safety-net for array-based data or providers that omit closeTime:
                // estimate as openTime + timeframe duration (accurate for 24/7 crypto).
                const tfDurationMs = getTimeframeDurationMs(this.timeframe);
                const _closeTime = marketData.map((d) =>
                    d.closeTime != null ? d.closeTime : d.openTime + tfDurationMs
                );

                this.open = _open;
                this.close = _close;
                this.high = _high;
                this.low = _low;
                this.volume = _volume;
                this.hl2 = _hl2;
                this.hlc3 = _hlc3;
                this.ohlc4 = _ohlc4;
                this.hlcc4 = _hlcc4;
                this.openTime = _openTime;
                this.closeTime = _closeTime;

                if (source && (source as IProvider).getSymbolInfo) {
                    const symbolInfo = (source as IProvider)
                        .getSymbolInfo(tickerId)
                        .then((symbolInfo) => {
                            this._syminfo = symbolInfo;
                            this._ready = true;
                            resolve(true);
                        })
                        .catch((error) => {
                            console.warn('Failed to get symbol info, using default values:', error);
                            this._ready = true;
                            resolve(true);
                        });
                } else {
                    this._ready = true;
                    resolve(true);
                }
            });
        });
    }

    public setDebugSettings({ ln, debug }: { ln: boolean; debug: boolean }) {
        this._debugSettings.ln = ln;
        this._debugSettings.debug = debug;
    }

    private async loadMarketData(source: IProvider | any[], tickerId: string, timeframe: string, limit?: number, sDate?: number, eDate?: number) {
        if (Array.isArray(source)) {
            return source;
        } else {
            return (source as IProvider).getMarketData(tickerId, timeframe, limit, sDate, eDate);
        }
    }

    public async ready() {
        if (this._ready) return true;
        if (!this._readyPromise) throw new Error('PineTS is not ready');
        return this._readyPromise;
    }

    /**
     * Run the Pine Script code and return the resulting context.
     * @param pineTSCode
     * @param periods
     * @returns Promise<Context>
     */
    public run(pineTSCode: Indicator | Function | String, periods?: number): Promise<Context>;
    /**
     * Run the Pine Script code with pagination, yielding results page by page.
     * @param pineTSCode
     * @param periods
     * @param pageSize
     * @returns AsyncGenerator<Context>
     */
    public run(pineTSCode: Indicator | Function | String, periods: number | undefined, pageSize: number): AsyncGenerator<Context>;
    /**
     * Run the Pine Script code and return the resulting context.
     * if pageSize is provided, the function will return an iterator that will yield the results page by page.
     * each page contains the results of "pageSize" periods.
     * @param pineTSCode
     * @param periods
     * @param pageSize
     * @returns Context if pageSize is 0 or undefined, or AsyncGenerator<Context> if pageSize > 0
     */
    public run(pineTSCode: Indicator | Function | String, periods?: number, pageSize?: number): Promise<Context> | AsyncGenerator<Context> {
        const ind = Indicator.from(pineTSCode as any);
        this._currentIndicator = ind;
        // NB: `ind.prepare()` may throw synchronously for malformed Pine /
        // unparseable JS. We push it inside the async path so the throw
        // surfaces as a Promise rejection (matches the pre-refactor contract:
        // `await pine.run(badCode)` rejects, never throws synchronously).

        if (pageSize && pageSize > 0) {
            const enableLiveStream = typeof this.eDate === 'undefined' && !Array.isArray(this.source);
            return this._runPaginated(ind, periods, pageSize, enableLiveStream);
        } else {
            return this._runComplete(ind, periods);
        }
    }

    /**
     * Stream the results of the Pine Script code.
     * Provides an event-based interface for handling streaming data.
     * @param pineTSCode The Pine Script code to execute
     * @param options Streaming options
     * @returns Object with on(event, callback) and stop() methods
     */
    public stream(
        pineTSCode: Indicator | Function | String,
        options: { pageSize?: number; live?: boolean; interval?: number } = {},
    ): { on: (event: 'data' | 'error' | 'warning' | 'alert', callback: Function) => void; stop: () => void } {
        const { live = true, interval = 1000 } = options;
        const pageSize = options.pageSize || this.data.length; // Default pageSize to full data if not provided

        const ind = Indicator.from(pineTSCode as any);
        this._currentIndicator = ind;
        // prepare() is deferred to inside _runPaginated so transpile errors
        // surface as Promise rejections on the stream's `error` event.

        const listeners: { [key: string]: Function[] } = { data: [], error: [], warning: [], alert: [] };
        let stopped = false;

        const emit = (event: string, ...args: any[]) => {
            if (listeners[event]) {
                listeners[event].forEach((cb) => cb(...args));
            }
        };

        const on = (event: 'data' | 'error' | 'warning' | 'alert', callback: Function) => {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(callback);
        };

        const stop = () => {
            stopped = true;
        };

        // Start execution
        (async () => {
            try {
                // When live streaming is requested with an eDate, clamp eDate to now
                // to avoid gaps between historical data end and live data start
                if (live && typeof this.eDate !== 'undefined') {
                    this.eDate = Math.max(this.eDate, Date.now());
                }

                // Determine if live streaming is possible and requested
                const isLiveCapable = !Array.isArray(this.source);
                const enableLiveStream = isLiveCapable && live;

                // Pass undefined for periods to include all data
                // We use the generator version directly to control enableLiveStream
                const iterator = this._runPaginated(ind, undefined, pageSize, enableLiveStream);

                for await (const ctx of iterator) {
                    if (stopped) break;

                    if (ctx === null) {
                        // No new data
                        // This block is only reached if enableLiveStream is true and provider yields no data

                        // Wait and retry
                        await new Promise((resolve) => setTimeout(resolve, interval));
                        continue;
                    }

                    emit('data', ctx);

                    // Emit any NEW runtime warnings accumulated since last tick
                    if (ctx.warnings && ctx.warnings.length > 0) {
                        for (const w of ctx.warnings) {
                            emit('warning', w);
                        }
                        // Clear so next tick only emits newly added warnings
                        ctx.warnings.length = 0;
                    }

                    // Emit any NEW alert events accumulated since last tick
                    if (ctx.alerts && ctx.alerts.length > 0) {
                        for (const a of ctx.alerts) {
                            emit('alert', a);
                        }
                        // Clear so next tick only emits newly added alerts
                        ctx.alerts.length = 0;
                    }

                    // If live streaming is enabled, wait for the interval before fetching next data
                    // This prevents hammering the API when new data is available immediately or in rapid succession
                    if (enableLiveStream && !stopped) {
                        const currentCandle = ctx.marketData[ctx.idx];
                        const isHistorical = currentCandle && currentCandle.closeTime < Date.now();
                        const isLastBar = ctx.idx >= ctx.marketData.length - 1;

                        // Always throttle when on the last bar (caught up to current data).
                        // For mid-stream historical pages, skip the delay so initial load is fast.
                        if (!isHistorical || isLastBar) {
                            await new Promise((resolve) => setTimeout(resolve, interval));
                        }
                    }
                }
            } catch (error) {
                emit('error', error);
            }
        })();

        return { on, stop };
    }

    /**
     * Run an already-transpiled PineTS function in this instance — no
     * additional transpile/parse pass. Used by `request.security_lower_tf`'s
     * slow path to execute the slice produced at primary-transpile time
     * (a truncated body containing only the prefix up to the call). The
     * caller is responsible for ensuring `transpiledFn` was produced by
     * this transpiler against the same source — calling this with an
     * arbitrary function is unsafe.
     */
    public async runPretranspiled(transpiledFn: Function, inputs: Record<string, any> = {}, periods?: number): Promise<Context> {
        await this.ready();
        if (!periods) periods = this.data.length;

        const context = this._initializeContext(null as any, inputs, this._isSecondaryContext);
        context.pineVersion = (transpiledFn as any)._pineVersion ?? null;
        this._transpiledCode = transpiledFn;
        // Preserve slice attribution on the context so any nested LTF
        // request inside the slice can keep using the same map.
        const slices = (transpiledFn as any)._ltfSlices;
        if (slices) (context as any)._ltfTruncatedBodies = slices;

        await this._executeIterations(context, transpiledFn, this.data.length - periods, this.data.length);

        return context;
    }

    /**
     * Run the script completely and return the final context.
     *
     * Execution is split: all bars except the last are processed first, then a
     * var-state snapshot is taken, then the last bar is processed. This gives
     * updateTail() a reliable snapshot-based restore point, matching the
     * pattern used by _runPaginated and eliminates the pop-based drift that
     * occurred when var variables were modified in-place during re-execution.
     * @private
     */
    private async _runComplete(ind: Indicator, periods?: number): Promise<Context> {
        await this.ready();
        if (!periods) periods = this.data.length;

        const prepared = ind.prepare(this._debugSettings);
        this._usesVisibleRange = prepared.usesVisibleRange;

        const context = this._initializeContext(ind.source ?? null as any, prepared.inputs, this._isSecondaryContext);
        context.pineVersion = (prepared.fn as any)._pineVersion ?? null;
        this._transpiledCode = prepared.fn;
        // Propagate transpile-time slices (one per request.security_lower_tf
        // call site) onto the Context so the slow path of the LTF runtime
        // can pick the right truncated body to run in the secondary
        // instead of the FULL user script.
        if (prepared.ltfSlices) (context as any)._ltfTruncatedBodies = prepared.ltfSlices;

        // Split execution: process all bars except the last, snapshot, then
        // process the last bar. This gives updateTail() a reliable restore
        // point, matching the pattern used by _runPaginated.
        const startIdx = this.data.length - periods;
        const endIdx = this.data.length;

        if (this._realtimeMode) {
            this._realtimeContext = context;
            const historical = this._realtimeInitialTail === 'historical';
            (context as any)._realtimeLifecycle = { index: historical ? endIdx : endIdx - 1, confirmed: historical, newBar: !historical };
            try {
                if (endIdx === 0) throw new Error('Realtime execution requires at least one initial bar.');
                if (historical) {
                    await this._executeIterations(context, prepared.fn, startIdx, endIdx);
                    (context as any)._realtimeLifecycle.index = endIdx - 1;
                } else {
                    await this._executeIterations(context, prepared.fn, startIdx, endIdx - 1);
                    (context as any)._realtimeSnapshot = this._takeRealtimeSnapshot(context);
                    await this._executeIterations(context, prepared.fn, endIdx - 1, endIdx);
                }
                this._measureRealtimeState(context);
                return context;
            } catch (error) {
                (context as any)._realtimeLifecycle.failed = true;
                if ((error as any).stats) (context as any)._realtimeMetrics = { nodes: 0, mutableCells: 0,
                    seriesSlots: 0, baselineNodes: 0, newbornNodes: 0, prunedNodes: 0, ...(error as any).stats };
                throw error;
            }
        }

        if (endIdx - startIdx > 1) {
            await this._executeIterations(context, prepared.fn, startIdx, endIdx - 1);
            (context as any)._varSnapshot = this._snapshotVarState(context);
            await this._executeIterations(context, prepared.fn, endIdx - 1, endIdx);
        } else {
            // Single bar: no meaningful pre-last range to snapshot; execute directly.
            // updateTail() will fall back to _removeLastResult on this context.
            await this._executeIterations(context, prepared.fn, startIdx, endIdx);
        }

        return context;
    }

    /**
     * Run the script with pagination, yielding results page by page
     * Each page contains only the new results for that page, not cumulative results
     * Uses a unified loop that handles both historical and live streaming data
     * @private
     */
    private async *_runPaginated(
        ind: Indicator,
        periods: number | undefined,
        pageSize: number,
        enableLiveStream: boolean = false,
    ): AsyncGenerator<Context> {
        if (this._realtimeMode) throw new Error('Explicit realtime mode uses run() and updateTail(), not paginated streaming.');
        await this.ready();
        if (!periods) periods = this.data.length;

        const prepared = ind.prepare(this._debugSettings);
        this._usesVisibleRange = prepared.usesVisibleRange;

        const context = this._initializeContext(ind.source ?? null as any, prepared.inputs, this._isSecondaryContext);
        context.pineVersion = (prepared.fn as any)._pineVersion ?? null;
        this._transpiledCode = prepared.fn;
        if (prepared.ltfSlices) (context as any)._ltfTruncatedBodies = prepared.ltfSlices;

        const startIdx = this.data.length - periods;
        let processedUpToIdx = startIdx; // Track what we've fully processed
        let varSnapshot: any = null; // Snapshot of var state before last bar processing

        // Unified loop handles both historical and live data
        while (true) {
            const availableData = this.data.length;
            const unprocessedCount = availableData - processedUpToIdx;

            // #1: If we have unprocessed data, process it
            if (unprocessedCount > 0) {
                const toProcess = Math.min(unprocessedCount, pageSize);
                const previousResultLength = this._getResultLength(context.result);

                // If this batch includes the last bar AND live streaming is enabled,
                // snapshot the state BEFORE processing the last bar so we can restore
                // it cleanly on streaming re-execution.
                const batchEnd = processedUpToIdx + toProcess;
                if (enableLiveStream && batchEnd >= availableData && toProcess > 1) {
                    // Process all bars except the last one
                    await this._executeIterations(context, this._transpiledCode, processedUpToIdx, batchEnd - 1);
                    // Snapshot state before the last bar
                    varSnapshot = this._snapshotVarState(context);
                    // Now process the last bar
                    await this._executeIterations(context, this._transpiledCode, batchEnd - 1, batchEnd);
                } else if (enableLiveStream && batchEnd >= availableData && toProcess === 1) {
                    // Only 1 bar to process (the last one) — snapshot is already set from previous batch
                    await this._executeIterations(context, this._transpiledCode, processedUpToIdx, batchEnd);
                } else {
                    await this._executeIterations(context, this._transpiledCode, processedUpToIdx, batchEnd);
                }

                processedUpToIdx += toProcess;

                // Yield the page with new results
                const pageContext = this._createPageContext(context, previousResultLength);
                yield pageContext;
                continue;
            }

            // UNUSED — snapshot is now taken in #1 before processing the last bar

            // #2: Caught up to current data (processedUpToIdx === this.data.length)

            // If not live streaming, we're done
            if (!enableLiveStream || Array.isArray(this.source)) {
                break;
            }

            // #3: Fetch new data, always starting from last candle's openTime
            // Throttle: minimum 1 second between API fetches to prevent hammering
            const fetchStart = Date.now();
            const { newCandles, updatedLastCandle } = await this._updateMarketData();
            const fetchDuration = Date.now() - fetchStart;

            if (newCandles === 0 && !updatedLastCandle) {
                // No new data available, yield null to signal caller
                yield null as any;
                continue;
            }

            // If only the last candle was updated (no new bars), throttle to avoid
            // rapid-fire fetching when the market is closed or candle is still forming
            if (newCandles === 0 && updatedLastCandle && fetchDuration < 1000) {
                await new Promise((resolve) => setTimeout(resolve, 1000 - fetchDuration));
            }

            // #4: Data changed — bump version so secondary contexts know to refresh
            context.dataVersion++;

            // Update context.length so barstate.islast (which checks
            // context.idx === context.length - 1) works correctly for new bars.
            // Without this, barstate.islast stays false after new candles arrive,
            // and any `if barstate.islast` drawing logic never executes.
            context.length = this.data.length;

            // Restore variable state to the snapshot (before last bar was processed).
            // This is more reliable than _removeLastResult's pop-based approach for
            // var variables, which can drift when re-executing modifies values in-place.
            // _restoreVarState handles var/let/const/params Series truncation,
            // so we skip _removeLastResult (which would double-pop).
            this._restoreVarState(context, varSnapshot);

            // Still need to remove last result and market data series entries
            // (these are not covered by _restoreVarState)
            if (Array.isArray(context.result)) {
                context.result.pop();
            } else if (typeof context.result === 'object' && context.result !== null) {
                for (let key in context.result) {
                    if (Array.isArray(context.result[key])) {
                        context.result[key].pop();
                    }
                }
            }
            // Pop market data series (close, open, high, low, volume, etc.)
            context.data.close.data.pop();
            context.data.open.data.pop();
            context.data.high.data.pop();
            context.data.low.data.pop();
            context.data.volume.data.pop();
            context.data.hl2.data.pop();
            context.data.hlc3.data.pop();
            context.data.ohlc4.data.pop();
            context.data.hlcc4.data.pop();
            context.data.openTime.data.pop();
            if (context.data.closeTime) context.data.closeTime.data.pop();
            context.data.bar_index.data.pop();

            // Step back one position to reprocess last candle
            processedUpToIdx = this.data.length - (newCandles + 1);

            // Roll back drawing objects created during the previous processing of
            // these bars so they don't accumulate on each streaming tick.
            context.rollbackDrawings(processedUpToIdx);

            // If new candles arrived, invalidate snapshot (will re-snapshot after next full process)
            if (newCandles > 0) {
                varSnapshot = null;
            }

            // Next iteration of loop will process from updated position (#1)

            //barstate.isnew becomes false on live bars
            context.pine.barstate.setLive();
        }
    }

    /**
     * Get the length of the result (works for arrays and objects)
     * @private
     */
    private _getResultLength(result: any): number {
        if (Array.isArray(result)) {
            return result.length;
        } else if (typeof result === 'object' && result !== null) {
            const keys = Object.keys(result);
            if (keys.length > 0 && Array.isArray(result[keys[0]])) {
                return result[keys[0]].length;
            }
        }
        return 0;
    }

    /**
     * Create a context containing only the new results for the current page
     * @private
     */
    private _createPageContext(fullContext: Context, previousResultLength: number): Context {
        // console.log('_createPageContext fullContext.inputs keys:', fullContext.inputs ? Object.keys(fullContext.inputs) : 'undefined');
        const pageContext = new Context({
            marketData: this.data,
            source: this.source,
            tickerId: this.tickerId,
            timeframe: this.timeframe,
            limit: this.limit,
            sDate: this.sDate,
            eDate: this.eDate,
            fullContext,
            inputs: fullContext.inputs,
        });

        pageContext.pineTSCode = fullContext.pineTSCode;
        pageContext.idx = fullContext.idx;

        // Copy only the new results for this page
        if (Array.isArray(fullContext.result)) {
            pageContext.result = fullContext.result.slice(previousResultLength);
        } else if (typeof fullContext.result === 'object' && fullContext.result !== null) {
            pageContext.result = {};
            for (let key in fullContext.result) {
                if (Array.isArray(fullContext.result[key])) {
                    pageContext.result[key] = fullContext.result[key].slice(previousResultLength);
                } else {
                    pageContext.result[key] = fullContext.result[key];
                }
            }
        } else {
            pageContext.result = fullContext.result;
        }

        // Copy plots metadata
        pageContext.plots = { ...fullContext.plots };

        // Copy runtime warnings
        pageContext.warnings = fullContext.warnings;

        // Copy alert events
        pageContext.alerts = fullContext.alerts;

        return pageContext;
    }

    /**
     * Update market data from the last known candle to now (or eDate if provided)
     * Intelligently replaces the last candle if it's still open, or appends new candles
     * @param eDate - Optional end date, defaults to now
     * @returns Object containing: { newCandles: number, updatedLastCandle: boolean }
     * @private
     */
    private async _updateMarketData(eDate?: number): Promise<{ newCandles: number; updatedLastCandle: boolean }> {
        // Can only update if source is a Provider
        if (Array.isArray(this.source)) {
            return { newCandles: 0, updatedLastCandle: false };
        }

        const provider = this.source as IProvider;
        const lastCandleIdx = this.data.length - 1;
        const lastCandle = this.data[lastCandleIdx];
        const lastCandleOpenTime = lastCandle.openTime;

        try {
            // Fetch new data starting from the last candle's open time
            const newData = await provider.getMarketData(this.tickerId!, this.timeframe!, undefined, lastCandleOpenTime, eDate);

            if (!newData || newData.length === 0) {
                return { newCandles: 0, updatedLastCandle: false };
            }

            let updatedLastCandle = false;
            let newCandles = 0;

            // Process the fetched data
            for (let i = 0; i < newData.length; i++) {
                const candle = newData[i];

                // Check if this candle is an update to our last candle
                if (candle.openTime === lastCandleOpenTime) {
                    // Update the existing last candle
                    this._replaceCandle(lastCandleIdx, candle);
                    updatedLastCandle = true;
                } else if (candle.openTime > lastCandleOpenTime) {
                    // This is a new candle, append it
                    this._appendCandle(candle);
                    newCandles++;
                }
                // Skip candles with openTime < lastCandleOpenTime (shouldn't happen)
            }

            return { newCandles, updatedLastCandle };
        } catch (error) {
            console.error('Error updating market data:', error);
            return { newCandles: 0, updatedLastCandle: false };
        }
    }

    /**
     * Replace a candle at a specific index with new data
     * @private
     */
    private _replaceCandle(index: number, candle: any): void {
        this.data[index] = candle;
        this.open[index] = candle.open;
        this.close[index] = candle.close;
        this.high[index] = candle.high;
        this.low[index] = candle.low;
        this.volume[index] = candle.volume;
        this.hl2[index] = (candle.high + candle.low) / 2;
        this.hlc3[index] = (candle.high + candle.low + candle.close) / 3;
        this.ohlc4[index] = (candle.high + candle.low + candle.open + candle.close) / 4;
        this.hlcc4[index] = (candle.high + candle.low + candle.close + candle.close) / 4;
        this.openTime[index] = candle.openTime;
        this.closeTime[index] = candle.closeTime;
    }

    /**
     * Append a new candle to the end of market data arrays
     * @private
     */
    private _appendCandle(candle: any): void {
        this.data.push(candle);
        this.open.push(candle.open);
        this.close.push(candle.close);
        this.high.push(candle.high);
        this.low.push(candle.low);
        this.volume.push(candle.volume);
        this.hl2.push((candle.high + candle.low) / 2);
        this.hlc3.push((candle.high + candle.low + candle.close) / 3);
        this.ohlc4.push((candle.high + candle.low + candle.open + candle.close) / 4);
        this.hlcc4.push((candle.high + candle.low + candle.close + candle.close) / 4);
        this.openTime.push(candle.openTime);
        this.closeTime.push(candle.closeTime);
    }

    /**
     * Update the secondary context's tail with fresh market data.
     *
     * Uses snapshot-restore for reliable var state rollback, matching the
     * approach used by _runPaginated. The pop-based _removeLastResult is
     * only used as a fallback for contexts that have no snapshot (e.g. those
     * produced by runPretranspiled, which skips the split-execute pattern).
     *
     * After restoring state and re-executing, a fresh snapshot is taken before
     * the last bar so that subsequent updateTail() calls also have a valid
     * restore point.
     *
     * @param context - The cached secondary context to update
     * @returns true if data was updated, false if no changes
     */
    public async updateTail(context: Context, event?: { confirmed: boolean; received?: boolean }): Promise<boolean> {
        if (this._realtimeMode) {
            if (this._realtimeUpdating) throw new Error('A realtime update is already running.');
            this._realtimeUpdating = true;
            try { return await this._updateRealtimeTail(context, event); }
            catch (error) {
                if (context === this._realtimeContext && (error as any).code === 'REALTIME_STATE_LIMIT') {
                    (context as any)._realtimeLifecycle.failed = true;
                    (context as any)._realtimeMetrics = { nodes: 0, mutableCells: 0, seriesSlots: 0,
                        baselineNodes: 0, newbornNodes: 0, prunedNodes: 0, ...(error as any).stats };
                }
                throw error;
            }
            finally { this._realtimeUpdating = false; }
        }
        // Guard: skip if no data (e.g. secondary context failed to load from provider)
        if (this.data.length === 0 || Array.isArray(this.source)) return false;

        const { newCandles, updatedLastCandle } = await this._updateMarketData();
        if (newCandles === 0 && !updatedLastCandle) return false;

        // Use snapshot-restore for reliable var state rollback.
        // _removeLastResult's pop-based approach drifts when re-executing
        // modifies var values in-place (see _runPaginated comment, line 591).
        const snapshot = (context as any)._varSnapshot;
        if (snapshot) {
            this._restoreVarState(context, snapshot);
        } else {
            // No snapshot available (context from runPretranspiled or single-bar
            // _runComplete) — fall back to pop-based rollback.
            this._removeLastResult(context);
        }

        // Pop result + market-data series.
        // _restoreVarState handles var/let/const/params Series but does NOT
        // cover result arrays or the market data series on context.data —
        // those must be popped explicitly here.
        if (Array.isArray(context.result)) {
            context.result.pop();
        } else if (typeof context.result === 'object' && context.result !== null) {
            for (let key in context.result) {
                if (Array.isArray(context.result[key])) {
                    context.result[key].pop();
                }
            }
        }

        context.data.close.data.pop();
        context.data.open.data.pop();
        context.data.high.data.pop();
        context.data.low.data.pop();
        context.data.volume.data.pop();
        context.data.hl2.data.pop();
        context.data.hlc3.data.pop();
        context.data.ohlc4.data.pop();
        context.data.hlcc4.data.pop();
        context.data.openTime.data.pop();
        if (context.data.closeTime) context.data.closeTime.data.pop();
        context.data.bar_index.data.pop();

        context.dataVersion = (context.dataVersion || 0) + 1;
        context.length = this.data.length;

        const processFrom = this.data.length - (newCandles + 1);
        context.rollbackDrawings(processFrom);

        // Split execution: process bars before last → snapshot → last bar.
        // Ensures the next updateTail() call has a fresh, valid restore point.
        const endIdx = this.data.length;

        if (processFrom < endIdx - 1) {
            // Multiple bars to re-execute: snapshot before the last one.
            await this._executeIterations(context, this._transpiledCode as Function, processFrom, endIdx - 1);
            (context as any)._varSnapshot = this._snapshotVarState(context);
            await this._executeIterations(context, this._transpiledCode as Function, endIdx - 1, endIdx);
        } else {
            // Only 1 bar to re-execute (same-bar tick update).
            // The existing snapshot remains valid as "before this bar" — no refresh needed.
            await this._executeIterations(context, this._transpiledCode as Function, processFrom, endIdx);
        }

        return true;
    }

    private _takeRealtimeSnapshot(context: Context): any {
        // Establish graph and per-binding history bounds before allocating any copies.
        const graph = realtimeGraph(context, this._realtimeLimits);
        const scopes = new Map<any, any>();
        for (const container of realtimeContainers(context)) {
            const state: any = {};
            for (const kind of ['const', 'var', 'let', 'params']) {
                state[kind] = new Map(Object.entries(container[kind] ?? {}).map(([key, item]: [string, any]) =>
                    [key, { item, data: item instanceof Series ? item.data.slice() : null }]));
            }
            scopes.set(container, state);
        }
        (context as any)._captureRealtimeObject = graph.capture;
        const plots = new Map(Object.entries(context.plots).map(([key, plot]: [string, any]) => [key, { plot, length: plot.data.length }]));
        // syncToPlot compacts by replacing its backing array. Retain that root's
        // identity so rollback can restore deleted/evicted objects as well as setters.
        const lineRoots = new Map(context._drawingHelpers.filter(helper => helper instanceof LineHelper)
            .map(helper => [helper, (helper as any)._lines]));
        const lineFillRoots = new Map(context._drawingHelpers.filter(helper => helper instanceof LinefillHelper)
            .map(helper => [helper, (helper as any)._linefills]));
        return { scopes, graph, plots, lineRoots, lineFillRoots, result: this._getResultLength(context.result), data: context.data.close.data.length };
    }

    private _restoreRealtimeSnapshot(context: Context, snapshot: any) {
        for (const [helper, lines] of snapshot.lineRoots ?? []) (helper as any)._lines = lines;
        for (const [helper, fills] of snapshot.lineFillRoots ?? []) (helper as any)._linefills = fills;
        snapshot.graph.restore();
        for (const container of [context, ...context.lctx.values()]) {
            const state = snapshot.scopes.get(container);
            for (const kind of ['const', 'var', 'let', 'params']) {
                const current = container[kind] ?? {};
                const saved = state?.[kind] ?? new Map();
                for (const key of Object.keys(current)) if (!saved.has(key)) delete current[key];
                for (const [key, entry] of saved) {
                    current[key] = entry.item;
                    if (entry.data) { entry.item.data.length = entry.data.length; for (let i = 0; i < entry.data.length; i++) entry.item.data[i] = entry.data[i]; }
                }
            }
            // Keep the latest intrabar value, but remove the extra history slot.
            for (const item of Object.values(container.varip ?? {}) as any[]) {
                if (!(item instanceof Series)) continue;
                const value = item.get(0);
                const length = (item as any)._realtimeSlotLength;
                if (length !== undefined) { item.data.length = length; item.data[length - 1] = value; }
            }
        }
        for (const key of Object.keys(context.plots)) if (!snapshot.plots.has(key)) delete context.plots[key];
        for (const [key, { plot, length }] of snapshot.plots) { context.plots[key] = plot; plot.data.length = length; }
        if (Array.isArray(context.result)) context.result.length = snapshot.result;
        else for (const value of Object.values(context.result ?? {}) as any[]) if (Array.isArray(value)) value.length = snapshot.result;
        for (const item of Object.values(context.data) as any[]) if (item instanceof Series) item.data.length = snapshot.data;
        context.rollbackDrawings(snapshot.data);
        snapshot.graph.prune(); // Scope rollback has removed transient roots; release only dead births.
    }

    private async _updateRealtimeTail(context: Context, event?: { confirmed: boolean; received?: boolean }): Promise<boolean> {
        if (context !== this._realtimeContext || !event || typeof event.confirmed !== 'boolean' || (event.received !== undefined && typeof event.received !== 'boolean') || Object.keys(event).some(key => key !== 'confirmed' && key !== 'received'))
            throw new Error('Realtime update requires the owning context and a boolean confirmed event.');
        if (Array.isArray(this.source)) throw new Error('Realtime updates require a provider.');
        const lifecycle = (context as any)._realtimeLifecycle;
        if (lifecycle.failed) throw new Error('Realtime execution is halted after a script runtime error.');
        const previous = this.data[this.data.length - 1];
        const fetched = await (this.source as IProvider).getMarketData(this.tickerId!, this.timeframe!, undefined, previous.openTime, this.eDate);
        if (!fetched?.length) return false;
        const relevant = fetched.filter((bar: any) => bar.openTime >= previous.openTime);
        if (!relevant.length) return false;
        if (relevant.some((bar: any, i: number) => !Number.isFinite(bar.openTime) || (i > 0 && bar.openTime <= relevant[i - 1].openTime)))
            throw new Error('Realtime provider bars must have strictly increasing times.');
        const appended = relevant.filter((bar: any) => bar.openTime > previous.openTime);
        const replacement = relevant.find((bar: any) => bar.openTime === previous.openTime);
        if (appended.length) {
            if (!lifecycle.confirmed || appended.length !== 1) throw new Error('Close the current bar before opening exactly one next bar.');
            if (replacement && ['open','high','low','close','volume','closeTime'].some(key => replacement[key] !== previous[key]))
                throw new Error('A committed bar cannot be revised.');
            this._appendCandle(appended[0]);
            lifecycle.index++;
            lifecycle.confirmed = event.confirmed;
            lifecycle.newBar = true;
            context.length = this.data.length;
            (context as any)._realtimeSnapshot = this._takeRealtimeSnapshot(context);
        } else {
            if (lifecycle.confirmed) {
                if (!event.confirmed && replacement && ['open','high','low','close','volume','closeTime'].every(key => replacement[key] === previous[key])) return false;
                throw new Error('A committed bar cannot receive another tick.');
            }
            if (!replacement) return false;
            if (!event.confirmed && event.received !== true && ['open','high','low','close','volume','closeTime'].every(key => replacement[key] === previous[key])) return false;
            this._restoreRealtimeSnapshot(context, (context as any)._realtimeSnapshot);
            this._replaceCandle(lifecycle.index, replacement);
            lifecycle.confirmed = event.confirmed;
            lifecycle.newBar = false;
        }
        context.dataVersion = (context.dataVersion || 0) + 1;
        await this._executeIterations(context, this._transpiledCode as Function, lifecycle.index, lifecycle.index + 1);
        this._measureRealtimeState(context);
        return true;
    }

    /**
     * Remove the last result from context (for updating an open candle)
     * @private
     */
    private _removeLastResult(context: Context): void {
        if (Array.isArray(context.result)) {
            context.result.pop();
        } else if (typeof context.result === 'object' && context.result !== null) {
            for (let key in context.result) {
                if (Array.isArray(context.result[key])) {
                    context.result[key].pop();
                }
            }
        }

        // Also remove from context.data arrays (last element = most recent in forward array)
        context.data.close.data.pop();
        context.data.open.data.pop();
        context.data.high.data.pop();
        context.data.low.data.pop();
        context.data.volume.data.pop();
        context.data.hl2.data.pop();
        context.data.hlc3.data.pop();
        context.data.ohlc4.data.pop();
        context.data.hlcc4.data.pop();
        context.data.openTime.data.pop();
        if (context.data.closeTime) {
            context.data.closeTime.data.pop();
        }
        context.data.bar_index.data.pop();

        // Fix: Rollback context variables (let, var, const, params)
        const contextVarNames = ['const', 'var', 'let', 'params', 'varip'];
        const rollbackVariables = (container: any) => {
            for (let ctxVarName of contextVarNames) {
                if (!container[ctxVarName]) continue;
                for (let key in container[ctxVarName]) {
                    const item = container[ctxVarName][key];
                    if (item instanceof Series) {
                        item.data.pop();
                    } else if (Array.isArray(item)) {
                        item.pop();
                    }
                }
            }
        };

        rollbackVariables(context);
        if (context.lctx) {
            context.lctx.forEach((lctx: any) => rollbackVariables(lctx));
        }
    }

    /**
     * Snapshot the var/let/const/params Series state — plus the strategy
     * ledger, via snapshotStrategyState — for streaming rollback.
     * Captures the data array length and last value for each variable so we can
     * restore to this exact state before re-executing the last bar.
     *
     * PERF NOTE: This currently snapshots ALL scopes (const, var, let, params).
     * In practice, only `var` variables need snapshot/restore because:
     *   - `let` variables are re-initialized every bar via $.init() — they reset naturally
     *   - `const` variables are set once and never modified
     *   - `params` are function parameters, not modified across bars
     * Only `var` variables persist and get modified in-place by $.set() (e.g. n += 1),
     * which causes drift on streaming re-execution.
     * If this becomes a bottleneck, narrow to `['var']` only.
     *
     * An even lighter alternative: make $.set() on var Series append-only (push
     * instead of in-place modify). Then the existing pop-based _removeLastResult
     * would correctly revert var state without any snapshot. This would require
     * changes to the core Series/set mechanics.
     *
     * @private
     */
    private _snapshotVarState(context: Context): any {
        const contextVarNames = ['const', 'var', 'let', 'params', 'varip'];
        const snapshot: any = { main: {}, lctx: [] };

        const snapContainer = (container: any) => {
            const snap: any = {};
            for (const ctxVarName of contextVarNames) {
                if (!container[ctxVarName]) continue;
                snap[ctxVarName] = {};
                for (const key in container[ctxVarName]) {
                    const item = container[ctxVarName][key];
                    if (item instanceof Series) {
                        // Save length AND the last value so we can restore both
                        const len = item.data.length;
                        const lastVal = len > 0 ? item.data[len - 1] : undefined;
                        snap[ctxVarName][key] = { len, lastVal };
                    }
                }
            }
            return snap;
        };

        snapshot.main = snapContainer(context);
        if (context.lctx) {
            const lctxSnaps: any[] = [];
            context.lctx.forEach((lctx: any) => lctxSnaps.push(snapContainer(lctx)));
            snapshot.lctx = lctxSnaps;
        }

        // Strategy ledger (pending_orders / opentrades / position / equity /
        // peaks). Without this, orders queued by a discarded execution of the
        // forming bar survive the rollback and fill as duplicates on the next
        // bar. Null for indicator contexts.
        snapshot.strategy = snapshotStrategyState(context.strategy);

        // Also snapshot result and data array lengths
        snapshot.resultLength = this._getResultLength(context.result);
        snapshot.dataLength = context.data.close?.data?.length ?? 0;

        return snapshot;
    }

    /**
     * Restore var/let/const/params Series state from a snapshot.
     * Truncates each Series' data array back to the snapshotted length.
     * @private
     */
    private _restoreVarState(context: Context, snapshot: any): void {
        if (!snapshot) return;
        const contextVarNames = ['const', 'var', 'let', 'params', 'varip'];

        const restoreContainer = (container: any, snap: any) => {
            for (const ctxVarName of contextVarNames) {
                if (!snap[ctxVarName] || !container[ctxVarName]) continue;
                for (const key in snap[ctxVarName]) {
                    const item = container[ctxVarName][key];
                    const snapInfo = snap[ctxVarName][key];
                    if (item instanceof Series && snapInfo && typeof snapInfo.len === 'number') {
                        // Truncate back to snapshot length
                        if (item.data.length > snapInfo.len) {
                            item.data.length = snapInfo.len;
                        }
                        // Restore the last value (which may have been modified in-place)
                        if (snapInfo.len > 0 && snapInfo.lastVal !== undefined) {
                            item.data[snapInfo.len - 1] = snapInfo.lastVal;
                        }
                    }
                }
            }
        };

        restoreContainer(context, snapshot.main);
        if (context.lctx && snapshot.lctx) {
            let i = 0;
            context.lctx.forEach((lctx: any) => {
                if (snapshot.lctx[i]) restoreContainer(lctx, snapshot.lctx[i]);
                i++;
            });
        }

        // Roll the strategy ledger back to its pre-last-bar state (no-op for
        // indicators). Mutates context.strategy in place — its identity is
        // public API.
        restoreStrategyState(context.strategy, snapshot.strategy);
    }

    /**
     * Initialize a new context for running Pine Script code
     * @private
     */
    private _initializeContext(pineTSCode: Function | String, inputs: Record<string, any> = {}, isSecondary: boolean = false): Context {
        const context = new Context({
            marketData: this.data,
            source: this.source,
            tickerId: this.tickerId,
            timeframe: this.timeframe,
            limit: this.limit,
            sDate: this.sDate,
            eDate: this.eDate,
            inputs,
        });

        context.pine.syminfo = createSyminfo(this._syminfo);
        // THE CHART TYPE IS THE TICKER (single source of truth): a non-standard chart is
        // addressed by an extended ticker — `new PineTS(source, "SYM;heikinashi", …)` — so
        // the data source can distinguish the chart series from standard-data requests.
        // Everything else derives from that modifier here: `context.chartStyle` (behind
        // `chart.is_*`) and the `syminfo.tickerid` suffix (a CLONE — the provider's cached
        // syminfo object, which is always modifier-free since providers strip, must stay
        // untouched). PineTS never transforms bars: the source of an extended ticker is
        // expected to serve the chart-type view already.
        const chartModifier = splitTickerModifier(String(this.tickerId ?? '')).modifier;
        context.chartStyle = chartModifier === 'heikinashi' ? 'heikinashi' : 'standard';
        if (this._syminfo && chartModifier === 'heikinashi') {
            context.pine.syminfo = createSyminfo({
                ...this._syminfo,
                tickerid: withTickerModifier(String(this._syminfo.tickerid ?? this.tickerId), 'heikinashi'),
            });
        }
        // Chart timezone only affects display formatting (log timestamps).
        // It does NOT override syminfo.timezone, which drives computation
        // (timestamp(), hour, dayofmonth, time_tradingday, etc.).
        if (this._chartTimezone) {
            context.chartTimezone = this._chartTimezone;
        }
        // Host-bound viewport overrides (chart.left/right_visible_bar_time).
        // Undefined values mean "use marketData-derived defaults" — see ChartHelper.
        context.viewportLeft = this._viewportLeft;
        context.viewportRight = this._viewportRight;

        context.__maxLoops = this._maxLoops;
        context._alertMode = this._alertMode;

        // User-explicit prop overrides flow from the Indicator to the runtime.
        // Read by Core.indicator() and initializeStrategy/strategy.any() to
        // merge on top of source-code declaration args.
        context._propOverrides = this._currentIndicator?.getRuntimePropOverrides() ?? {};

        context.pineTSCode = pineTSCode;
        context.isSecondaryContext = isSecondary; // Set secondary context flag
        context.data.close = new Series([]);
        context.data.open = new Series([]);
        context.data.high = new Series([]);
        context.data.low = new Series([]);
        context.data.volume = new Series([]);
        context.data.hl2 = new Series([]);
        context.data.hlc3 = new Series([]);
        context.data.ohlc4 = new Series([]);
        context.data.hlcc4 = new Series([]);
        context.data.openTime = new Series([]);
        context.data.closeTime = new Series([]);

        context.length = this.data.length;

        return context;
    }

    /**
     * Execute iterations from startIdx to endIdx, updating the context
     * @private
     */
    private async _executeIterations(context: Context, transpiledFn: Function, startIdx: number, endIdx: number): Promise<void> {
        const contextVarNames = ['const', 'var', 'let', 'params', 'varip'];

        for (let i = startIdx; i < endIdx; i++) {
            context.idx = i;
            if (this._realtimeMode) {
                const live = (context as any)._realtimeLifecycle;
                const realtime = i === live.index;
                (context as any)._explicitBarstate = {
                    isfirst: i === 0, islast: i === context.length - 1,
                    ishistory: !realtime, isrealtime: realtime,
                    isnew: !realtime || live.newBar, isconfirmed: !realtime || live.confirmed,
                    islastconfirmedhistory: !realtime && i === live.index - 1,
                };
            }
            context._execTick = (context._execTick || 0) + 1;

            context.data.close.data.push(this.close[i]);
            context.data.open.data.push(this.open[i]);
            context.data.high.data.push(this.high[i]);
            context.data.low.data.push(this.low[i]);
            context.data.volume.data.push(this.volume[i]);
            context.data.hl2.data.push(this.hl2[i]);
            context.data.hlc3.data.push(this.hlc3[i]);
            context.data.ohlc4.data.push(this.ohlc4[i]);
            context.data.hlcc4.data.push(this.hlcc4[i]);
            context.data.openTime.data.push(this.openTime[i]);
            context.data.closeTime.data.push(this.closeTime[i]);
            context.data.bar_index.data.push(i);

            // Fill recalculation snapshots only script state; orders and varip remain live.
            const historicalSnapshot = !this._realtimeMode && (context.strategy?.config.calc_on_order_fills === true ||
                (!context.strategy && this._currentIndicator?.getDeclarationType() === 'strategy')) ? this._takeRealtimeSnapshot(context) : null;
            let calculated = false;
            const calculate = async () => {
                if (calculated && historicalSnapshot) {
                    this._restoreRealtimeSnapshot(context, historicalSnapshot);
                    context.rollbackDrawings(i);
                    context._execTick++;
                }
                calculated = true;
                try { return await transpiledFn(context); }
                catch (error) {
                    if (this._realtimeMode) (context as any)._realtimeLifecycle.failed = true;
                    throw error;
                }
            };
            let result: any;
            if (!this._realtimeMode && (context.strategy?.config.calc_on_order_fills === true || context.strategy?.config.use_bar_magnifier === true)) {
                result = await processHistoricalFillBar(context, calculate);
            } else {
                // Process strategy orders at the START of the bar (filling at Open).
                // Entry-category orders fill first (market/limit/stop pending
                // orders), then exit-category orders evaluate against the bar's
                // open/high/low — so an exit gap-firing at the open covers trades
                // that filled at that same open (entry-first precedence). TV
                // evidence is majority-but-not-unanimous here: 3 of 4 gap events
                // in the QA pyramiding xlsx (2021-02-24, 2021-09-08, 2024-02-29)
                // catch the same-open entry; one (2024-03-21) spares it. The
                // 'open' phase of processExitOrders implements the minority
                // (exit-first) semantics and is currently not wired in.
                if (context.strategy) {
                    // Book a second margin call scheduled on the PREVIOUS bar
                    // by the phantom re-check (it fills at that bar's close,
                    // after its script evaluation — see processMarginCall and
                    // applyPendingCloseMarginCall). Must run before entries so
                    // a reversal queued at that close (qty frozen at queue
                    // time) overshoots by exactly the deferred quantity, as TV
                    // does.
                    applyPendingCloseMarginCall(context);
                    processStrategyOrders(context);
                    // Margin checkpoints along the intra-bar path (TV broker
                    // emulator): first at the OPEN right after entries fill;
                    // then at the adverse extreme — BEFORE exit fills when the
                    // bar's first move is adverse for the position (the
                    // extreme precedes the favorable exits on the path), AFTER
                    // them otherwise (favorable exits free margin first). The
                    // 'extreme' checkpoint may schedule a deferred second
                    // margin call at this bar's close (phantom re-check).
                    processMarginCall(context, 'open');
                    const adverseFirst = isAdverseFirstBar(context);
                    if (adverseFirst) processMarginCall(context, 'extreme');
                    processExitOrders(context, 'intrabar');
                    if (!adverseFirst) processMarginCall(context, 'extreme');
                    // Latch max_drawdown / max_runup ONCE at the end of the bar so
                    // trades closed mid-bar by TP / SL contribute their realized
                    // P&L (not phantom intra-bar excursions against the raw H/L).
                    finalizeStrategyBar(context);
                }

                result = await calculate();
                // The first declaration becomes available during the first calculation.
                if (!this._realtimeMode && (context.strategy?.config.calc_on_order_fills === true || context.strategy?.config.use_bar_magnifier === true))
                    result = await processHistoricalFillBar(context, calculate, { result });
                else if (context.strategy) processOrdersOnClose(context);
            }
            if (historicalSnapshot) (context as any)._captureRealtimeObject = undefined;

            //collect results
            if (typeof result === 'object') {
                if (typeof context.result !== 'object') {
                    context.result = {};
                }
                for (let key in result) {
                    if (context.result[key] === undefined) {
                        context.result[key] = [];
                    }

                    let val;
                    if (result[key] instanceof Series) {
                        val = result[key].get(0);
                    } else if (Array.isArray(result[key])) {
                        val = result[key][result[key].length - 1];
                    } else {
                        val = result[key];
                    }

                    context.result[key].push(val);
                }
            } else {
                if (!Array.isArray(context.result)) {
                    context.result = [];
                }

                context.result.push(result);
            }

            // Sync drawing object plots after all mutations for this bar.
            // Serializes the current state of labels/lines/boxes/etc. into plain objects
            // so that context.plots contains safe, JSON-serializable data.
            for (const helper of context._drawingHelpers) {
                if (helper.syncToPlot) helper.syncToPlot();
            }

            if (this._realtimeMode) {
                for (const container of [context, ...context.lctx.values()])
                    for (const item of Object.values(container.varip ?? {}) as any[])
                        if (item instanceof Series) (item as any)._realtimeSlotLength = item.data.length;
                if (context.strategy) throw new Error('Realtime strategy order scheduling is not supported.');
            }

            //shift context
            const shiftVariables = (container: any) => {
                for (let ctxVarName of contextVarNames) {
                    if (!container[ctxVarName]) continue;
                    for (let key in container[ctxVarName]) {
                        const item = container[ctxVarName][key];

                        if (item instanceof Series) {
                            const val = item.get(0);
                            item.data.push(val);
                        } else if (Array.isArray(item)) {
                            // Legacy array support during transition
                            const val = item[item.length - 1];
                            item.push(val);
                        }
                    }
                }
            };

            shiftVariables(context);
            if (context.lctx) {
                context.lctx.forEach((lctx: any) => shiftVariables(lctx));
            }
            if (this._realtimeMode) realtimeSlots(context, this._realtimeLimits);
        }

        // End-of-run: compute the risk-adjusted performance ratios
        // (Sharpe / Sortino) from the monthly equity curve accumulated
        // across the bar loop. Runs once, after the last bar.
        if (context.strategy) {
            finalizeStrategyRun(context);
        }
    }
}

export default PineTS;