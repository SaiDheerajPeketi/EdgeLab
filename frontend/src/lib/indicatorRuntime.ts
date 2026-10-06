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
  let cancelJob: () => void = () => undefined;
  const timeoutMs = mode === "live" ? 350 : 1_200;
  const promise = new Promise<EdgeIndicatorExecutionResult>((resolve, reject) => {
    let worker: Worker | null = null;
    let timeout: number | undefined;
    let settled = false;
    const finish = (result?: EdgeIndicatorExecutionResult, failure?: IndicatorWorkerError) => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
      }
      if (failure) reject(failure);
      else resolve(result!);
    };
    cancelJob = () => finish(undefined, new IndicatorWorkerError("CANCELLED", "Indicator execution was cancelled."));
    try {
      worker = new Worker(new URL("../workers/indicatorRuntime.worker.ts", import.meta.url), {
        name: "EdgeLab indicator runtime",
        type: "module",
      });
      timeout = window.setTimeout(() => finish(undefined, new IndicatorWorkerError(
        "TIME_LIMIT", `Indicator worker exceeded its ${timeoutMs} ms time limit.`,
      )), timeoutMs);
      worker.onmessage = (event: MessageEvent<EdgeIndicatorWorkerResponse>) => {
        if (event.data.id !== id || settled) return;
        if (event.data.status === "completed") finish(event.data.result);
        else finish(undefined, new IndicatorWorkerError(event.data.error.code, event.data.error.message));
      };
      worker.onerror = (event) => finish(undefined, new IndicatorWorkerError(
        "WORKER_ERROR", event.message || "The isolated indicator worker failed.",
      ));
      worker.onmessageerror = () => finish(undefined, new IndicatorWorkerError(
        "WORKER_ERROR", "The isolated indicator worker returned an unreadable result.",
      ));
      const request: EdgeIndicatorWorkerRequest = { bars, id, inputs, mode, source };
      worker.postMessage(request);
    } catch (failure) {
      finish(undefined, new IndicatorWorkerError(
        "WORKER_ERROR", failure instanceof Error ? failure.message : "The isolated indicator worker could not start.",
      ));
    }
  });
  return {
    id,
    promise,
    cancel: () => cancelJob(),
  };
}
