import { binanceChartPlan, loadBinanceRequestHistory } from "./binanceChartFeed";
import { bucketTime } from "./charting";
import { pineFeedNextSourceTime } from "./pineLiveFeed";
import { pineLiveObservationCutoff } from "./pineLiveObservation";
import { createPineLiveMarketDataResolver } from "./pineLiveMarketTransport";
import { advancePineLiveMarkets, assertPineLiveMarketBudget, createPineLiveMarketLedger, pineLiveMarketKey,
  type PineLiveMarketEvent, type PineLiveMarketState } from "./pineLiveMarkets";
import { PINE_LIVE_PROTOCOL, PINE_LIVE_QUEUE_LIMIT, validatePineLiveRequest, type PineLiveRequest } from "./pineLiveProtocol";
import { migratePineEnumInputs } from "./pineInputMigration";
import { parsePineMarketDemand, pineMarketChartTimeframe, pineMarketSymbol, type PineMarketDemand, type PineMarketSnapshot } from "./pineMarketProtocol";
import type { PineMarketDataScope } from "./pineMarketDataResolver";
import { PINE_LIMITS, PineProtocolError, validatePineRequest, type PineRequest, type PinePrepareResult, type PineExecutionResult } from "./pineProtocol";
import type { PineLiveRuntimeSession } from "./pineRuntime";

type Job = { cancel(): void; promise: Promise<PinePrepareResult | PineExecutionResult> };
type Dependencies = { createJob(request: PineRequest): Job; createSession(request: PineRequest & { marketStreams: { symbol: string; timeframe: string; epoch: number }[] }): PineLiveRuntimeSession;
  createResolver: typeof createPineLiveMarketDataResolver; history: typeof loadBinanceRequestHistory };
type Receipt = { ordinal: number; event: Readonly<PineLiveMarketEvent> };
const retired = () => new DOMException("Requested live indicator markets retired.", "AbortError");
const equal = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);
const sameFields = (a: object, b: object) => equal(Object.entries(a).sort(([a], [b]) => a.localeCompare(b)), Object.entries(b).sort(([a], [b]) => a.localeCompare(b)));
export const PINE_MARKETS_RELOADING = "PINE_MARKETS_RELOADING";

/** Evaluated discovery and actual native history handoff; primary ticks during loading are not replayed. */
export function createPineLiveMarketCoordinator(input: PineRequest, scope: PineMarketDataScope, epoch: number,
  dependencies: Dependencies, inputMetadata?: PinePrepareResult) {
  const initial = validatePineRequest(input), saved = inputMetadata ? structuredClone(inputMetadata) : undefined;
  scope = { ...scope, range: { ...scope.range } };
  if (initial.action !== "run" || initial.mode !== "live" || !initial.bars?.length || !initial.context
    || pineMarketSymbol(initial.context.symbol) !== pineMarketSymbol(scope.chartSymbol) || scope.range.from !== initial.bars[0].time
    || scope.range.to !== scope.asOf - 1 || scope.asOf !== pineFeedNextSourceTime(initial.bars.at(-1)!.time, pineMarketChartTimeframe(initial.context.timeframe))) {
    throw new PineProtocolError("INVALID_LIVE_MARKET", "Requested live startup needs its owned completed chart window.");
  }
  const pair = dependencies.createResolver(scope, epoch);
  const snapshots = new Map<string, PineMarketSnapshot>(), depths = new Map<string, number>(), invalidSymbols = new Set<string>();
  const states = new Map<string, PineLiveMarketState>();
  const stateBytes = new Map<string, number>();
  const hold = (key: string, state: PineLiveMarketState) => {
    stateBytes.set(key, new TextEncoder().encode(JSON.stringify(state)).byteLength);
    if ([...stateBytes.values()].reduce((sum, size) => sum + size + 1, 2) > PINE_LIMITS.resultBytes) throw new PineProtocolError("REQUEST_LIMIT", "Requested live market history exceeds the memory limit.");
    states.set(key, state);
  };
  let sourceInputs = initial.inputs, stopped: Error | undefined, job: Job | undefined, ready = false, requiredCutoff = scope.asOf;
  let receipts: Receipt[] = [], candidate: { session: PineLiveRuntimeSession; receive(events: PineLiveMarketEvent[]): void; halt(error: Error): void } | undefined;
  let rejectFailure: (error: Error) => void = () => {};
  const failure = new Promise<never>((_, reject) => { rejectFailure = reject; }); void failure.catch(() => {});
  const cancelWith = (error: Error) => {
    if (stopped) return;
    stopped = error; clearTimeout(timer); job?.cancel(); candidate?.halt(error); pair.cancel(); unsubscribe(); receipts = []; states.clear(); stateBytes.clear(); snapshots.clear(); rejectFailure(error);
  };
  const cancel = () => cancelWith(retired());
  const assertActive = () => { if (stopped) throw stopped; pair.assertActive(); };
  const timer = setTimeout(() => cancelWith(new PineProtocolError("TIMEOUT", "Requested live indicator markets took too long to start. Reapply the indicator.")), 45_000);
  let unsubscribe = () => {};
  const fold = () => {
    for (const [key, state] of states) {
      const closed = state.confirmed ? state.bars.at(-1) : state.bars.at(-2);
      if (!closed) continue;
      const end = pineFeedNextSourceTime(closed.time, pineMarketChartTimeframe(state.timeframe));
      requiredCutoff = Math.max(requiredCutoff, end);
      receipts = receipts.filter(item => pineLiveMarketKey(item.event) !== key || item.event.bar.time >= end);
    }
  };
  const collect = () => {
    try {
      assertActive();
      const incoming = pair.transport.drain();
      for (const receipt of incoming) {
        const key = pineLiveMarketKey(receipt.event), state = states.get(key);
        receipts.push(receipt);
        if (state) hold(key, advancePineLiveMarkets([state], [receipt.event], initial)[0]);
      }
      assertPineLiveMarketBudget([...states.values()], initial); fold();
      if (receipts.length > 128 || receipts.some(item => receipts.filter(other => pineLiveMarketKey(other.event) === pineLiveMarketKey(item.event)).length > 32)
        || new TextEncoder().encode(JSON.stringify(receipts)).byteLength > 1_000_000) throw new PineProtocolError("LIVE_QUEUE_LIMIT", "Requested live market loading exceeded its buffer. Reapply the indicator.");
      candidate?.receive(incoming.map(item => item.event as PineLiveMarketEvent));
    } catch (error) { cancelWith(error instanceof Error ? error : new Error("Requested live markets failed.")); }
  };
  try { unsubscribe = pair.transport.subscribe(collect); } catch (error) { cancelWith(error as Error); throw error; }
  void pair.transport.failure.catch(cancelWith);
  const merge = (a: readonly PineLiveMarketState["bars"][number][], b: readonly PineLiveMarketState["bars"][number][]) => {
    const bars = new Map(a.map(bar => [bar.time, bar]));
    for (const bar of b) {
      const held = bars.get(bar.time);
      if (held && !["time", "open", "high", "low", "close", "volume"].every(key => held[key as keyof typeof held] === bar[key as keyof typeof bar])) throw new PineProtocolError("INVALID_LIVE_MARKET", "Requested history conflicts with its received native candles.");
      bars.set(bar.time, bar);
    }
    return [...bars.values()].sort((a, b) => a.time - b.time);
  };
  const load = async (demand: PineMarketDemand) => {
    const key = `${demand.symbol}:${demand.timeframe}`, warmupPeriods = Math.max(1000, demand.calcBarsCount ?? 0);
    if ((depths.get(key) ?? -1) >= warmupPeriods || !depths.has(key) && depths.size >= 64 || warmupPeriods > 16_000) throw new PineProtocolError("REQUEST_LIMIT", "This indicator exceeded its requested market contexts or history depth.");
    depths.set(key, warmupPeriods);
    let loaded;
    try { loaded = await pair.resolve({ symbol: demand.symbol, timeframe: demand.timeframe, warmupPeriods }); }
    catch (error) {
      assertActive();
      if (error instanceof PineProtocolError && error.code === "INVALID_REQUEST_SYMBOL" && demand.ignoreInvalidSymbol) { invalidSymbols.add(demand.symbol); return; }
      throw error;
    }
    assertActive();
    if (loaded.coverage.capped) throw new PineProtocolError("REQUEST_LIMIT", "Requested market history exceeds the candle limit. Use a shorter chart window.");
    const snapshot: PineMarketSnapshot = { context: { ...loaded.context, timeframe: loaded.sourceTimeframe }, requestedTimeframe: demand.timeframe,
      bars: loaded.bars.map(bar => ({ ...bar })), asOf: scope.asOf };
    snapshots.set(key, snapshot);
    const nativeKey = pineLiveMarketKey(snapshot.context), stream = pair.transport.streams().find(item => pineLiveMarketKey(item.binding) === nativeKey);
    if (!stream) return; // The primary symbol never gets a secondary transport.
    const first = stream.first!;
    requiredCutoff = Math.max(requiredCutoff, first.bar.time);
    const existing = states.get(nativeKey);
    if (existing) {
      hold(nativeKey, Object.freeze({ ...existing, requestedTimeframes: Object.freeze([...new Set([...existing.requestedTimeframes, demand.timeframe])]),
        bars: Object.freeze(merge(snapshot.bars.filter(bar => bar.time < first.bar.time), existing.bars)) }));
    } else {
      const frame = pineMarketChartTimeframe(loaded.sourceTimeframe), plan = binanceChartPlan(frame)!;
      let bars = snapshot.bars.filter(bar => bar.time < first.bar.time);
      const from = bars.length ? pineFeedNextSourceTime(bars.at(-1)!.time, frame) : bucketTime(scope.asOf, frame);
      if (from < first.bar.time) {
        const bridge = await dependencies.history(loaded.providerSymbol, plan, { from, to: first.bar.time - 1, warmupPeriods: 0,
          candleLimit: 16_000, signal: pair.signal, owns: () => { try { assertActive(); return true; } catch { return false; } } });
        assertActive();
        if (bridge.capped) throw new PineProtocolError("REQUEST_LIMIT", "Requested live history exceeds the loading limit.");
        if (bridge.bars.some((bar, index) => bar.time !== (index ? pineFeedNextSourceTime(bridge.bars[index - 1].time, frame) : bars.length ? from : bar.time))) throw new PineProtocolError("UNAVAILABLE_DATA", "Requested live history has a gap during loading. Reapply the indicator.");
        bars = merge(bars, bridge.bars.filter(bar => pineFeedNextSourceTime(bar.time, frame) <= first.bar.time));
      }
      if (bars.length && pineFeedNextSourceTime(bars.at(-1)!.time, frame) !== first.bar.time) throw new PineProtocolError("UNAVAILABLE_DATA", "Requested live history has a gap before its received candle. Reapply the indicator.");
      const seeded = createPineLiveMarketLedger({ ...initial, marketData: { provider: "binance", snapshots: [{ ...snapshot, bars, asOf: first.bar.time }] } }, [stream.binding])[0];
      const events = receipts.filter(item => pineLiveMarketKey(item.event) === nativeKey).map(item => item.event);
      hold(nativeKey, events.length ? advancePineLiveMarkets([seeded], events, initial)[0] : seeded);
    }
    assertPineLiveMarketBudget([...states.values()], initial); fold();
  };
  const historical = (request: PineRequest, marketSnapshots: PineMarketSnapshot[]) => {
    const end = pineFeedNextSourceTime(request.bars!.at(-1)!.time, pineMarketChartTimeframe(request.context!.timeframe));
    return validatePineRequest({ ...request, mode: "historical", liveObservation: undefined,
      sourceSnapshot: request.sourceSnapshot ? { ...request.sourceSnapshot, bars: request.sourceSnapshot.bars.filter(bar => pineFeedNextSourceTime(bar.time, pineMarketChartTimeframe(request.sourceSnapshot!.timeframe)) <= end) } : undefined,
      marketData: { provider: "binance", invalidSymbols: [...invalidSymbols], snapshots: marketSnapshots.map(snapshot => ({ ...snapshot, asOf: end,
        bars: snapshot.bars.filter(bar => pineFeedNextSourceTime(bar.time, pineMarketChartTimeframe(snapshot.context.timeframe)) <= end) })) } });
  };
  const execute = async (request: PineRequest) => {
    assertActive(); job = dependencies.createJob(request);
    try { const result = await Promise.race([job.promise, failure]); assertActive(); if (result.kind === "prepare") throw new Error("Pine discovery returned preparation data."); return result; }
    finally { job?.cancel(); job = undefined; }
  };
  const promise = (async () => {
    if (saved?.source === initial.source && saved.inputDefinitions.some(item => item.type === "enum" && item.enumVersion !== 1)) {
      job = dependencies.createJob({ id: initial.id, action: "prepare", source: initial.source });
      const prepared = await Promise.race([job.promise, failure]); assertActive(); job.cancel(); job = undefined;
      if (prepared.kind !== "prepare") throw new Error("Pine input migration returned execution data.");
      sourceInputs = migratePineEnumInputs(saved, prepared, initial.inputs).inputs;
    }
    for (let attempt = 0; attempt <= 64; attempt++) {
      try { await execute(historical({ ...initial, inputs: sourceInputs }, [...snapshots.values()])); ready = true; return; }
      catch (error) { assertActive(); const demand = parsePineMarketDemand(error); if (!demand) throw error; await load(demand); }
    }
    throw new PineProtocolError("REQUEST_LIMIT", "This indicator requested too many market contexts.");
  })().catch(error => { cancelWith(error); throw error; });
  void promise.catch(() => {});
  const start = (fresh: PineRequest): PineLiveRuntimeSession | undefined => {
    assertActive(); if (!ready || candidate) return undefined;
    fresh = validatePineRequest(fresh);
    if (fresh.action !== "run" || fresh.mode !== "live" || !fresh.context || !fresh.bars?.length || fresh.source !== initial.source
      || !sameFields(fresh.inputs ?? {}, initial.inputs ?? {}) || !sameFields(fresh.strategySettings ?? {}, initial.strategySettings ?? {})
      || !sameFields(fresh.context, initial.context!) || fresh.bars[0].time < initial.bars![0].time) throw new PineProtocolError("INVALID_LIVE_MARKET", "Live startup belongs to a different script, inputs or chart.");
    const cutoff = pineLiveObservationCutoff(fresh.context!, fresh.bars!, fresh.sourceSnapshot, fresh.liveObservation);
    if (cutoff < requiredCutoff) return undefined;
    const marketSnapshots = [...snapshots.values()].map(snapshot => {
      const state = states.get(pineLiveMarketKey(snapshot.context));
      const closed = state ? (state.confirmed ? state.bars : state.bars.slice(0, -1)) : snapshot.bars;
      return { ...snapshot, bars: closed.map(bar => ({ ...bar })), asOf: cutoff };
    });
    const request = validatePineRequest({ ...fresh, inputs: sourceInputs, marketData: { provider: "binance", snapshots: marketSnapshots, invalidSymbols: [...invalidSymbols] } });
    const bindings = [...states.values()].map(({ symbol, timeframe, epoch }) => ({ symbol, timeframe, epoch }));
    const counters = new Map(bindings.map(binding => [pineLiveMarketKey(binding), 0]));
    const id = `pine-startup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    let inner: PineLiveRuntimeSession | undefined, halted: Error | undefined, sequence = 0, admitted = false;
    const pending: { command: Exclude<PineLiveRequest, { action: "start" }>; resolve(value: unknown): void; reject(error: Error): void }[] = [];
    let rejectStart: (error: Error) => void = () => {};
    const stoppedStart = new Promise<never>((_, reject) => { rejectStart = reject; }); void stoppedStart.catch(() => {});
    const halt = (error: Error) => { if (halted) return; halted = error; inner?.cancel(); rejectStart(error); for (const item of pending.splice(0)) item.reject(error); };
    const reloadFor = (demand: PineMarketDemand) => {
      if (halted) return halted;
      assertActive();
      if (candidate?.session !== session) return retired();
      ready = false; candidate = undefined;
      const reload = new PineProtocolError(PINE_MARKETS_RELOADING, "Requested indicator markets are loading.");
      halt(reload);
      void load(demand).then(() => { assertActive(); ready = true; }).catch(cancelWith);
      return reload;
    };
    const send = (command: Exclude<PineLiveRequest, { action: "start" }>) => (command.action === "update" ? inner!.update(command.bar, command.confirmed, command.source)
      : command.action === "viewport" ? inner!.setViewport(command.viewport) : inner!.updateMarkets(command.events)).catch(error => {
        if (halted) throw halted;
        const demand = command.action === "viewport" && parsePineMarketDemand(error);
        if (demand) throw reloadFor(demand);
        cancelWith(error); throw error;
      });
    const enqueue = <T,>(value: object): Promise<T> => {
      try {
        assertActive(); if (halted) throw halted;
        const command = validatePineLiveRequest({ ...value, protocol: PINE_LIVE_PROTOCOL, sessionId: id, sequence: ++sequence });
        if (command.action === "start") throw new Error("Unexpected live startup command.");
        if (inner && admitted) return send(command) as Promise<T>;
        if (pending.length >= PINE_LIVE_QUEUE_LIMIT) throw new PineProtocolError("LIVE_QUEUE_LIMIT", "Live updates exceeded the startup queue. Reapply the indicator.");
        return new Promise<T>((resolve, reject) => { pending.push({ command, resolve: value => resolve(value as T), reject }); });
      } catch (error) { if ((error as PineProtocolError).code !== PINE_MARKETS_RELOADING) cancelWith(error as Error); return Promise.reject(error); }
    };
    const receive = (events: PineLiveMarketEvent[]) => {
      const owned = events.filter(event => counters.has(pineLiveMarketKey(event))).map(event => {
        const key = pineLiveMarketKey(event), sequence = counters.get(key)! + 1; counters.set(key, sequence); return { ...event, sequence };
      });
      if (owned.length) void enqueue({ action: "markets", events: owned }).catch(error => { if (error.code !== PINE_MARKETS_RELOADING) cancelWith(error); });
    };
    const session: PineLiveRuntimeSession = { id, promise: Promise.resolve(undefined as never),
      cancel: () => { if ((halted as PineProtocolError)?.code === PINE_MARKETS_RELOADING) return; cancel(); },
      update: (bar, confirmed, source) => enqueue({ action: "update", bar, confirmed, ...(source ? { source } : {}) }),
      setViewport: viewport => enqueue({ action: "viewport", viewport }),
      updateMarkets: () => Promise.reject(new PineProtocolError("INVALID_LIVE_MARKET", "Requested live updates belong to the coordinator's native transports.")),
    };
    candidate = { session, receive, halt };
    receive(receipts.map(item => item.event as PineLiveMarketEvent));
    session.promise = Promise.race([(async () => {
      let result: PineExecutionResult;
      try { inner = dependencies.createSession({ ...request, marketStreams: bindings }); result = await Promise.race([inner.promise, failure]); }
      catch (error) {
        assertActive(); const demand = parsePineMarketDemand(error); if (!demand) throw error;
        throw reloadFor(demand);
      }
      assertActive(); if (halted) throw halted;
      admitted = true;
      for (const item of pending.splice(0)) void send(item.command).then(item.resolve, item.reject);
      clearTimeout(timer); return result;
    })(), stoppedStart]).catch(error => { if (error.code !== PINE_MARKETS_RELOADING) cancelWith(error); throw error; });
    void session.promise.catch(() => {});
    return session;
  };
  return { promise, failure, start, cancel, assertActive, hasRequestedMarkets: () => depths.size > 0 };
}
