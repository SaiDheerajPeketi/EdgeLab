import workerAsset from "virtual:pine-worker-url";
import { migratePineEnumInputs } from "./pineInputMigration";
import type { PinePrepareResult } from "./pineProtocol";
import type { Candle } from "./api";
import { createSandboxWorkerJob, createSandboxWorkerSession } from "./pineSandbox";
import { PINE_LIMITS, PineProtocolError, validatePineRequest, validatePineResponse, type PineExecutionResult, type PineRequest, type PineViewport } from "./pineProtocol";
import { advancePineLiveSource, PINE_LIVE_PROTOCOL, PINE_LIVE_QUEUE_LIMIT, pineLiveRequestId, validatePineLiveRequest, validatePineLiveResponse, type PineLiveRequest, type PineLiveSourceEvent } from "./pineLiveProtocol";
import { createPineMarketRuntimeJob } from "./pineMarketRuntime";
import { createPineMarketDataResolver, type PineMarketDataScope } from "./pineMarketDataResolver";

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

export type PineLiveRuntimeSession = {
  id: string;
  promise: Promise<PineExecutionResult>;
  update(bar: Candle, confirmed: boolean, source?: PineLiveSourceEvent): Promise<PineExecutionResult>;
  setViewport(viewport: PineViewport | null): Promise<PineExecutionResult>;
  cancel(): void;
};

/** Initial bars are confirmed history; every subsequent accepted event is ordered. */
export function createPineLiveRuntimeSession(input: Omit<PineRequest, "id" | "action" | "mode"> & { inputMetadata?: PinePrepareResult }): PineLiveRuntimeSession {
  const saved = input.inputMetadata;
  if (saved?.source === input.source && saved.inputDefinitions.some((item) => item.type === "enum" && item.enumVersion !== 1)) {
    const preparation = createPineRuntimeJob({ action: "prepare", source: input.source });
    let halted = false, session: PineLiveRuntimeSession | undefined, pending = 0;
    const cancel = () => { halted = true; preparation.cancel(); session?.cancel(); };
    const ready = preparation.promise.then((prepared) => {
      if (halted) throw new PineProtocolError("LIVE_SESSION_HALTED", "This live Pine session has stopped.");
      if (prepared.kind !== "prepare") throw new Error("Native Pine preparation returned execution data.");
      session = createPineLiveRuntimeSession({ ...input, inputMetadata: undefined, inputs: migratePineEnumInputs(saved, prepared, input.inputs).inputs });
      return session;
    });
    const promise = ready.then((owned) => owned.promise);
    void promise.catch(cancel);
    const enqueue = (run: (owned: PineLiveRuntimeSession) => Promise<PineExecutionResult>) => {
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
    return { id: preparation.id, promise, cancel, update: (bar, confirmed, source) => enqueue(owned => owned.update(bar, confirmed, source)),
      setViewport: viewport => enqueue(owned => owned.setViewport(viewport)) };
  }
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const id = `pine-live-${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")}`;
  const request = validatePineRequest({ ...input, id: pineLiveRequestId(id, 0), action: "run", mode: "live" });
  const command = validatePineLiveRequest({ protocol: PINE_LIVE_PROTOCOL, sessionId: id, sequence: 0, action: "start", request });
  const expected = new Map<number, PineRequest>([[0, request]]);
  let bars = request.bars!;
  let sourceSnapshot = request.sourceSnapshot, sourceConfirmed = true;
  let viewport = request.viewport;
  let sequence = 0, confirmedTail = true, halted = false;
  const session = createSandboxWorkerSession<PineLiveRequest, PineExecutionResult>({
    id, request: command, timeoutMs: 10_000, updateTimeoutMs: 2_000, maxQueued: PINE_LIVE_QUEUE_LIMIT,
    loadWorker: loadTrustedPineWorker,
    requestTimeoutMs: command => command.action === "update" ? 2_000 : 10_000,
    validate: (value, pending) => {
      const owner = expected.get(pending.sequence);
      if (!owner) throw new PineProtocolError("LIVE_SEQUENCE", "Live Pine response has no active command.");
      const result = validatePineLiveResponse(value, pending, owner);
      expected.delete(pending.sequence);
      return result;
    },
  });
  const cancel = () => { halted = true; expected.clear(); session.cancel(); };
  void session.promise.catch(() => { halted = true; expected.clear(); });
  return {
    id,
    promise: session.promise,
    cancel,
    setViewport: value => {
      if (halted) return Promise.reject(new PineProtocolError("LIVE_SESSION_HALTED", "This live Pine session has stopped."));
      try {
        const next = validatePineLiveRequest({ protocol: PINE_LIVE_PROTOCOL, sessionId: id, sequence: ++sequence, action: "viewport", viewport: value });
        if (next.action !== "viewport") throw new PineProtocolError("INVALID_LIVE_MESSAGE", "Expected a viewport event.");
        viewport = next.viewport;
        expected.set(next.sequence, { ...request, viewport, sourceSnapshot, id: pineLiveRequestId(id, next.sequence), bars });
        return session.send(next).catch(error => { cancel(); throw error; }).finally(() => expected.delete(next.sequence));
      } catch (error) {
        cancel();
        return Promise.reject(error);
      }
    },
    update: (bar, confirmed, source) => {
      if (halted) return Promise.reject(new PineProtocolError("LIVE_SESSION_HALTED", "This live Pine session has stopped. Reapply the indicator to restart."));
      try {
        const next = validatePineLiveRequest({ protocol: PINE_LIVE_PROTOCOL, sessionId: id, sequence: ++sequence, action: "update", bar, confirmed, ...(source ? { source } : {}) });
        if (next.action !== "update") throw new PineProtocolError("INVALID_LIVE_MESSAGE", "Expected an update event.");
        sourceSnapshot = advancePineLiveSource(sourceSnapshot, sourceConfirmed, next, request.context!.timeframe);
        if (next.source) sourceConfirmed = next.source.confirmed;
        const last = bars.at(-1)!;
        if (next.bar.time === last.time) {
          if (confirmedTail) throw new PineProtocolError("LIVE_COMMITTED_BAR", "A confirmed live bar cannot receive another update.");
          bars = [...bars.slice(0, -1), next.bar];
        } else {
          if (next.bar.time < last.time || !confirmedTail) throw new PineProtocolError("LIVE_BAR_ORDER", "The current bar must close before the next bar opens.");
          if (bars.length >= PINE_LIMITS.bars) throw new PineProtocolError("BAR_LIMIT", "Live Pine reached 20,000 bars. Reapply the indicator to start a fresh history window.");
          bars = [...bars, next.bar];
        }
        confirmedTail = next.confirmed;
        expected.set(next.sequence, { ...request, viewport, sourceSnapshot, id: pineLiveRequestId(id, next.sequence), bars });
        return session.send(next).catch(error => { cancel(); throw error; }).finally(() => expected.delete(next.sequence));
      } catch (error) {
        cancel();
        return Promise.reject(error);
      }
    },
  };
}
