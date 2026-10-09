import workerAsset from "virtual:pine-worker-url";
import { migratePineEnumInputs } from "./pineInputMigration";
import type { PinePrepareResult } from "./pineProtocol";
import type { Candle } from "./api";
import { createSandboxWorkerJob, createSandboxWorkerSession } from "./pineSandbox";
import { PINE_LIMITS, PineProtocolError, canonicalPineTimeframe, validatePineRequest, validatePineResponse, type PineAlertConditionDefinition, type PineContext, type PineExecutionResult, type PineRequest, type PineViewport } from "./pineProtocol";
import { preparePineCalculationPrefix, selectPineCalculationSnapshot, type PineCalculationPrefix } from "./pineCalculationSnapshot";
import type { PineConditionSampleProof } from "./pineConditionSamples";
import { pineMarketSymbol } from "./pineMarketProtocol";
import { advancePineLiveSource, PINE_LIVE_PROTOCOL, PINE_LIVE_QUEUE_LIMIT, pineLiveRequestId, validatePineLiveRequest, validatePineLiveResponse, validatePineLiveMarketResponse, type PineLiveRequest, type PineLiveSourceEvent } from "./pineLiveProtocol";
import { advancePineLiveMarkets, assertPineLiveMarketBudget, createPineLiveMarketLedger, validatePineLiveMarketEvents, validatePineLiveMarketStreams, type PineLiveMarketStream, type PineLiveMarketEvent, type PineLiveMarketLedger, type PineLiveMarketReceipt } from "./pineLiveMarkets";
import { createPineMarketRuntimeJob } from "./pineMarketRuntime";
import { createPineMarketDataResolver, type PineMarketDataScope } from "./pineMarketDataResolver";
import { createPineLiveMarketCoordinator } from "./pineLiveMarketCoordinator";
import { createPineLiveMarketDataResolver } from "./pineLiveMarketTransport";
import { loadBinanceRequestHistory } from "./binanceChartFeed";

async function loadTrustedPineWorker(signal: AbortSignal) {
  const url = new URL(workerAsset, location.href);
  if (url.origin !== location.origin) throw new Error("The trusted Pine engine must be served by this application.");
  const response = await fetch(url, { signal, credentials: "omit", redirect: "error", cache: "force-cache" });
  if (!response.ok) throw new Error("The trusted Pine engine asset is unavailable.");
  return response.text();
}

export function createPineRuntimeJob(input: Omit<PineRequest, "id">, options: { marketScope?: PineMarketDataScope } = {}) {
  const id = `pine-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let request: PineRequest;
  try { request = validatePineRequest({ ...input, id }); }
  catch (error) { return { id, cancel: () => undefined, promise: Promise.reject(error) }; }
  const createJob = (request: PineRequest) => createSandboxWorkerJob({
    request,
    timeoutMs: request.action === "prepare" ? 3_000 : request.mode === "live" ? 2_000 : 10_000,
    validate: value => validatePineResponse(value, request),
    loadWorker: loadTrustedPineWorker,
  });
  if (options.marketScope && request.action === "run") return createPineMarketRuntimeJob(request, options.marketScope, { createJob, createResolver: createPineMarketDataResolver });
  return createJob(request);
}

export type PineConditionState = {
  conditions: PineAlertConditionDefinition[]; timeframe: string;
  frontier: { time: number; confirmed: boolean }; context: PineContext;
};
export type PineLiveRuntimeSession = {
  id: string;
  promise: Promise<PineExecutionResult>;
  update(bar: Candle, confirmed: boolean, source?: PineLiveSourceEvent, collectAlerts?: boolean, collectConditions?: boolean): Promise<PineExecutionResult>;
  setViewport(viewport: PineViewport | null): Promise<PineExecutionResult>;
  updateMarkets(events: PineLiveMarketEvent[]): Promise<PineLiveMarketReceipt>;
  readConditionState(): PineConditionState | undefined;
  cancel(): void;
};

export function createPineLiveMarketRuntime(input: Omit<PineRequest, "id" | "action" | "mode"> & { inputMetadata?: PinePrepareResult }, scope: PineMarketDataScope, epoch: number) {
  return createPineLiveMarketCoordinator({ ...input, id: "pine-live-market-startup", action: "run", mode: "live" }, scope, epoch,
    { createJob: request => createPineRuntimeJob(request), createSession: createPineLiveRuntimeSession,
      createResolver: createPineLiveMarketDataResolver, history: loadBinanceRequestHistory }, input.inputMetadata);
}

/** Initial bars are confirmed history; every subsequent accepted event is ordered. */
export function createPineLiveRuntimeSession(input: Omit<PineRequest, "id" | "action" | "mode"> & { inputMetadata?: PinePrepareResult; marketStreams?: PineLiveMarketStream[] }): PineLiveRuntimeSession {
  const saved = input.inputMetadata;
  if (saved?.source === input.source && saved.inputDefinitions.some((item) => item.type === "enum" && item.enumVersion !== 1)) {
    // Migration waits for a worker: capture the admitted histories and epochs
    // before that await, just as ordinary live initialization does.
    const captured = validatePineRequest({ ...input, id: "pine-live-input-migration", action: "run", mode: "live" });
    const marketStreams = input.marketStreams === undefined ? undefined : validatePineLiveMarketStreams(input.marketStreams);
    const provenance = structuredClone(saved);
    const preparation = createPineRuntimeJob({ action: "prepare", source: captured.source });
    let halted = false, session: PineLiveRuntimeSession | undefined, pending = 0;
    const cancel = () => { halted = true; preparation.cancel(); session?.cancel(); };
    const ready = preparation.promise.then((prepared) => {
      if (halted) throw new PineProtocolError("LIVE_SESSION_HALTED", "This live Pine session has stopped.");
      if (prepared.kind !== "prepare") throw new Error("Native Pine preparation returned execution data.");
      session = createPineLiveRuntimeSession({ ...captured, ...(marketStreams !== undefined ? { marketStreams } : {}), inputs: migratePineEnumInputs(provenance, prepared, captured.inputs).inputs });
      return session;
    });
    const promise = ready.then((owned) => owned.promise);
    void promise.catch(cancel);
    const enqueue = <T,>(run: (owned: PineLiveRuntimeSession) => Promise<T>) => {
      if (halted) return Promise.reject(new PineProtocolError("LIVE_SESSION_HALTED", "This live Pine session has stopped."));
      if (pending >= PINE_LIVE_QUEUE_LIMIT) {
        cancel();
        return Promise.reject(new PineProtocolError("LIVE_QUEUE_LIMIT", "Live Pine updates exceeded the queue limit."));
      }
      pending++;
      return ready.then((owned) => {
        if (halted) throw new PineProtocolError("LIVE_SESSION_HALTED", "This live Pine session has stopped.");
        return run(owned);
      }).catch((error) => { cancel(); throw error; }).finally(() => { pending--; });
    };
    return { id: preparation.id, promise, cancel, readConditionState: () => halted ? undefined : session?.readConditionState(), update: (bar, confirmed, source, collectAlerts, collectConditions) => enqueue(owned => owned.update(bar, confirmed, source, collectAlerts, collectConditions)),
      setViewport: viewport => enqueue(owned => owned.setViewport(viewport)), updateMarkets: events => {
        try { const ownedEvents = validatePineLiveMarketEvents(events); return enqueue(owned => owned.updateMarkets(ownedEvents)); }
        catch (error) { cancel(); return Promise.reject(error); }
      } };
  }
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const id = `pine-live-${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")}`;
  const request = validatePineRequest({ ...input, id: pineLiveRequestId(id, 0), action: "run", mode: "live" });
  const command = validatePineLiveRequest({ protocol: PINE_LIVE_PROTOCOL, sessionId: id, sequence: 0, action: "start", request, ...(input.marketStreams !== undefined ? { marketStreams: input.marketStreams } : {}) });
  if (command.action !== "start") throw new PineProtocolError("INVALID_LIVE_MESSAGE", "Expected live initialization.");
  let marketLedger = command.marketStreams === undefined ? Object.freeze([]) : createPineLiveMarketLedger(request, command.marketStreams);
  const expectedMarkets = new Map<number, PineLiveMarketLedger>();
  const expected = new Map<number, PineRequest>([[0, request]]);
  const expectedConditions = new Map<number, { ledger: PineLiveMarketLedger; sourceConfirmed: boolean; revision: number }>();
  const initialSource = request.sourceSnapshot ?? { timeframe: canonicalPineTimeframe(request.context!.timeframe), bars: request.bars! };
  let conditionOwner: { conditions: readonly PineAlertConditionDefinition[]; timeframe: string; prefix?: PineCalculationPrefix } | undefined;
  let conditionFrontier: { revision: number; ledger: PineLiveMarketLedger; value: PineConditionState["frontier"] } | undefined;
  let revision = 0;
  let bars = request.bars!;
  let sourceSnapshot = request.sourceSnapshot, sourceConfirmed = true;
  let liveObservation = request.liveObservation;
  let viewport = request.viewport;
  let sequence = 0, confirmedTail = true, halted = false;
  const session = createSandboxWorkerSession<PineLiveRequest, PineExecutionResult | PineLiveMarketReceipt>({
    id, request: command, timeoutMs: 10_000, updateTimeoutMs: 2_000, maxQueued: PINE_LIVE_QUEUE_LIMIT,
    loadWorker: loadTrustedPineWorker,
    requestTimeoutMs: command => ["update", "markets"].includes(command.action) ? 2_000 : 10_000,
    validate: (value, pending) => {
      const owner = expected.get(pending.sequence);
      if (!owner) throw new PineProtocolError("LIVE_SEQUENCE", "Live Pine response has no active command.");
      if (pending.action === "markets" && !expectedMarkets.has(pending.sequence)) throw new PineProtocolError("LIVE_SEQUENCE", "Requested-market response has no owned history.");
      let proof: PineConditionSampleProof | undefined;
      if (pending.action === "update" && pending.collectConditions === true) {
        const captured = expectedConditions.get(pending.sequence);
        if (!conditionOwner || !captured) throw new PineProtocolError("INVALID_LIVE_MESSAGE", "Condition collection has no fresh compiled owner or captured update.");
        proof = { conditions: conditionOwner.conditions, calculation: selectPineCalculationSnapshot({
          request: owner, timeframe: conditionOwner.timeframe, realtime: true, chartConfirmed: pending.confirmed,
          sourceConfirmed: captured.sourceConfirmed, revision: captured.revision, initialSource,
          marketLedger: captured.ledger, prefix: conditionOwner.prefix,
        }) };
      }
      const result = pending.action === "markets"
        ? validatePineLiveMarketResponse(value, pending, owner, expectedMarkets.get(pending.sequence)!)
        : validatePineLiveResponse(value, pending, owner, proof);
      if (pending.action === "start" && result.kind === "run" && result.declaration === "indicator") {
        const binding = result.calculationInputs;
        const value = binding ? result.inputs[binding.timeframeInputId] ?? binding.defaultTimeframe : "";
        if (typeof value !== "string") throw new PineProtocolError("INVALID_LIVE_MESSAGE", "Calculation timeframe input has no fresh string value.");
        const timeframe = canonicalPineTimeframe(value || request.context!.timeframe);
        let prefix: PineCalculationPrefix | undefined;
        if (timeframe !== canonicalPineTimeframe(request.context!.timeframe) && timeframe !== canonicalPineTimeframe(initialSource.timeframe)) {
          let symbol: string | undefined;
          try { symbol = pineMarketSymbol(request.context!.symbol); } catch { /* Legacy chart identities have no provider snapshot. */ }
          const snapshot = request.marketData?.snapshots.find(item => item.context.symbol === symbol && item.requestedTimeframe === timeframe);
          if (snapshot) prefix = preparePineCalculationPrefix(initialSource, snapshot);
        }
        // Capture before resolving the caller's promise: UI/cache mutation cannot change this owner.
        conditionOwner = { timeframe, prefix, conditions: Object.freeze((result.alertConditions ?? []).map(item => Object.freeze({ ...item }))) };
      }
      expected.delete(pending.sequence);
      expectedMarkets.delete(pending.sequence);
      expectedConditions.delete(pending.sequence);
      return result;
    },
  });
  const cancel = () => { halted = true; expected.clear(); expectedMarkets.clear(); expectedConditions.clear(); conditionOwner = undefined; conditionFrontier = undefined; marketLedger = Object.freeze([]); session.cancel(); };
  void session.promise.catch(cancel);
  const chartResult = (result: PineExecutionResult | PineLiveMarketReceipt): PineExecutionResult => {
    if (result.kind === "market-update") throw new PineProtocolError("INVALID_LIVE_MESSAGE", "A chart command returned a market acknowledgement.");
    return result;
  };
  return {
    id,
    promise: session.promise.then(chartResult),
    cancel,
    readConditionState: () => {
      if (halted || !conditionOwner) return undefined;
      if (!conditionFrontier || conditionFrontier.revision !== revision || conditionFrontier.ledger !== marketLedger) {
        try {
          const selected = selectPineCalculationSnapshot({ request: { ...request, bars, sourceSnapshot },
            timeframe: conditionOwner.timeframe, realtime: true, chartConfirmed: confirmedTail, sourceConfirmed,
            revision, initialSource, marketLedger, prefix: conditionOwner.prefix });
          const tail = selected.bars.at(-1);
          if (!tail) return undefined;
          conditionFrontier = { revision, ledger: marketLedger, value: { time: tail.time, confirmed: selected.confirmed } };
        } catch { return undefined; }
      }
      return { conditions: conditionOwner.conditions.map(item => ({ ...item })), timeframe: conditionOwner.timeframe,
        frontier: { ...conditionFrontier.value }, context: { ...request.context! } };
    },
    setViewport: value => {
      if (halted) return Promise.reject(new PineProtocolError("LIVE_SESSION_HALTED", "This live Pine session has stopped."));
      try {
        const next = validatePineLiveRequest({ protocol: PINE_LIVE_PROTOCOL, sessionId: id, sequence: ++sequence, action: "viewport", viewport: value });
        if (next.action !== "viewport") throw new PineProtocolError("INVALID_LIVE_MESSAGE", "Expected a viewport event.");
        viewport = next.viewport;
        expected.set(next.sequence, { ...request, liveObservation, viewport, sourceSnapshot, id: pineLiveRequestId(id, next.sequence), bars });
        return session.send(next).then(chartResult).catch(error => { cancel(); throw error; }).finally(() => expected.delete(next.sequence));
      } catch (error) {
        cancel();
        return Promise.reject(error);
      }
    },
    updateMarkets: events => {
      if (halted) return Promise.reject(new PineProtocolError("LIVE_SESSION_HALTED", "This live Pine session has stopped."));
      try {
        const next = validatePineLiveRequest({ protocol: PINE_LIVE_PROTOCOL, sessionId: id, sequence: ++sequence, action: "markets", events });
        if (next.action !== "markets") throw new PineProtocolError("INVALID_LIVE_MESSAGE", "Expected a requested-market event.");
        const ledger = advancePineLiveMarkets(marketLedger, next.events, { bars, sourceSnapshot });
        expected.set(next.sequence, { ...request, liveObservation, viewport, sourceSnapshot, id: pineLiveRequestId(id, next.sequence), bars });
        expectedMarkets.set(next.sequence, ledger);
        marketLedger = ledger;
        return session.send(next).then(result => {
          if (result.kind !== "market-update") throw new PineProtocolError("INVALID_LIVE_MESSAGE", "A requested-market command returned chart output.");
          return result;
        }).catch(error => { cancel(); throw error; }).finally(() => { expected.delete(next.sequence); expectedMarkets.delete(next.sequence); });
      } catch (error) { cancel(); return Promise.reject(error); }
    },
    update: (bar, confirmed, source, collectAlerts, collectConditions) => {
      if (halted) return Promise.reject(new PineProtocolError("LIVE_SESSION_HALTED", "This live Pine session has stopped. Reapply the indicator to restart."));
      try {
        const next = validatePineLiveRequest({ protocol: PINE_LIVE_PROTOCOL, sessionId: id, sequence: ++sequence, action: "update", bar, confirmed, ...(source ? { source } : {}), ...(collectAlerts !== undefined ? { collectAlerts } : {}), ...(collectConditions !== undefined ? { collectConditions } : {}) });
        if (next.action !== "update") throw new PineProtocolError("INVALID_LIVE_MESSAGE", "Expected an update event.");
        const nextSource = advancePineLiveSource(sourceSnapshot, sourceConfirmed, next, request.context!.timeframe);
        const last = bars.at(-1)!;
        if (next.bar.time === last.time) {
          if (confirmedTail) throw new PineProtocolError("LIVE_COMMITTED_BAR", "A confirmed live bar cannot receive another update.");
          const nextBars = [...bars.slice(0, -1), next.bar];
          assertPineLiveMarketBudget(marketLedger, { bars: nextBars, sourceSnapshot: nextSource });
          bars = nextBars;
        } else {
          if (next.bar.time < last.time || !confirmedTail) throw new PineProtocolError("LIVE_BAR_ORDER", "The current bar must close before the next bar opens.");
          if (bars.length >= PINE_LIMITS.bars) throw new PineProtocolError("BAR_LIMIT", "Live Pine reached 20,000 bars. Reapply the indicator to start a fresh history window.");
          const nextBars = [...bars, next.bar];
          assertPineLiveMarketBudget(marketLedger, { bars: nextBars, sourceSnapshot: nextSource });
          bars = nextBars;
        }
        sourceSnapshot = nextSource;
        if (next.source) sourceConfirmed = next.source.confirmed;
        confirmedTail = next.confirmed;
        liveObservation = undefined;
        revision++;
        expected.set(next.sequence, { ...request, liveObservation, viewport, sourceSnapshot, id: pineLiveRequestId(id, next.sequence), bars });
        if (next.collectConditions === true) expectedConditions.set(next.sequence, { ledger: marketLedger, sourceConfirmed, revision });
        return session.send(next).then(chartResult).catch(error => { cancel(); throw error; }).finally(() => { expected.delete(next.sequence); expectedConditions.delete(next.sequence); });
      } catch (error) {
        cancel();
        return Promise.reject(error);
      }
    },
  };
}
