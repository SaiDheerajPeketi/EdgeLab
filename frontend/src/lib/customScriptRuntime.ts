import type { Candle } from "./api";
import type { EdgeIndicatorExecutionResult, EdgeIndicatorInputValue } from "./indicatorDsl";
import { createIndicatorRuntimeJob } from "./indicatorRuntime";
import { isPineScriptSource } from "./customIndicators";
import { createPineRuntimeJob } from "./pineRuntime";
import type { PineContext, PineExecutionResult } from "./pineProtocol";

export function createCustomScriptRuntimeJob(options: {
  source: string;
  bars: Candle[];
  inputs?: Record<string, EdgeIndicatorInputValue>;
  mode: "historical" | "live";
  context?: PineContext;
}): { id: string; cancel(): void; promise: Promise<EdgeIndicatorExecutionResult | PineExecutionResult> } {
  if (!isPineScriptSource(options.source)) return createIndicatorRuntimeJob(options);
  const job = createPineRuntimeJob({ ...options, action: "run" });
  return { ...job, promise: job.promise.then((result) => {
    if (result.kind !== "run") throw new Error("Native Pine execution returned preparation metadata.");
    return result;
  }) };
}
