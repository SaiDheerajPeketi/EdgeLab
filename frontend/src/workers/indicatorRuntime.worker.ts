/// <reference lib="webworker" />

import {
  EdgeIndicatorRuntimeError,
  executeEdgeIndicator,
  type EdgeIndicatorExecutionResult,
  type EdgeIndicatorInputValue,
} from "../lib/indicatorDsl";
import type { Candle } from "../lib/api";

export type EdgeIndicatorWorkerRequest = {
  bars: Candle[];
  id: string;
  inputs?: Record<string, EdgeIndicatorInputValue>;
  mode: "historical" | "live";
  source: string;
};

export type EdgeIndicatorWorkerResponse =
  | { id: string; result: EdgeIndicatorExecutionResult; status: "completed" }
  | { error: { code: string; message: string }; id: string; status: "failed" };

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<EdgeIndicatorWorkerRequest>) => {
  const request = event.data;
  try {
    const result = executeEdgeIndicator(request);
    workerScope.postMessage({ id: request.id, result, status: "completed" } satisfies EdgeIndicatorWorkerResponse);
  } catch (error) {
    const failure = error instanceof EdgeIndicatorRuntimeError
      ? { code: error.code, message: error.message }
      : { code: "RUNTIME_ERROR", message: error instanceof Error ? error.message : "Indicator execution failed." };
    workerScope.postMessage({ error: failure, id: request.id, status: "failed" } satisfies EdgeIndicatorWorkerResponse);
  }
};

export {};
