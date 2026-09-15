import type { Candle } from "./api";
import type { EdgeIndicatorExecutionResult, EdgeIndicatorInputValue } from "./indicatorDsl";
import type {
  EdgeIndicatorWorkerRequest,
  EdgeIndicatorWorkerResponse,
} from "../workers/indicatorRuntime.worker";

export type IndicatorRuntimeJob = {
  cancel: () => void;
  id: string;
  promise: Promise<EdgeIndicatorExecutionResult>;
};

export class IndicatorWorkerError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "IndicatorWorkerError";
    this.code = code;
  }
}

export function createIndicatorRuntimeJob({
  bars,
  inputs,
  mode,
  source,
}: {
  bars: Candle[];
  inputs?: Record<string, EdgeIndicatorInputValue>;
  mode: "historical" | "live";
  source: string;
}): IndicatorRuntimeJob {
  const id = `edge-indicator-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  if (typeof Worker === "undefined") {
    return {
      cancel: () => undefined,
      id,
      promise: Promise.reject(new IndicatorWorkerError("WORKER_UNAVAILABLE", "This browser cannot start the isolated indicator worker.")),
    };
  }
  const worker = new Worker(new URL("../workers/indicatorRuntime.worker.ts", import.meta.url), {
    name: "EdgeLab indicator runtime",
    type: "module",
  });
  let settled = false;
  let rejectPromise: (error: Error) => void = () => undefined;
  const timeoutMs = mode === "live" ? 350 : 1_200;
  const promise = new Promise<EdgeIndicatorExecutionResult>((resolve, reject) => {
    rejectPromise = reject;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new IndicatorWorkerError("TIME_LIMIT", `Indicator worker exceeded its ${timeoutMs} ms time limit.`));
    }, timeoutMs);
    const finish = () => window.clearTimeout(timeout);
    worker.onmessage = (event: MessageEvent<EdgeIndicatorWorkerResponse>) => {
      if (event.data.id !== id || settled) return;
      settled = true;
      finish();
      worker.terminate();
      if (event.data.status === "completed") resolve(event.data.result);
      else reject(new IndicatorWorkerError(event.data.error.code, event.data.error.message));
    };
    worker.onerror = (event) => {
      if (settled) return;
      settled = true;
      finish();
      worker.terminate();
      reject(new IndicatorWorkerError("WORKER_ERROR", event.message || "The isolated indicator worker failed."));
    };
    const request: EdgeIndicatorWorkerRequest = { bars, id, inputs, mode, source };
    worker.postMessage(request);
  });
  return {
    id,
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      rejectPromise(new IndicatorWorkerError("CANCELLED", "Indicator execution was cancelled."));
    },
  };
}
