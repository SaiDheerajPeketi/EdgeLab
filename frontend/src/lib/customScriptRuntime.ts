import type { Candle } from "./api";
import type { EdgeIndicatorExecutionResult, EdgeIndicatorInputValue } from "./indicatorDsl";
import { createIndicatorRuntimeJob } from "./indicatorRuntime";
import { isPineScriptSource } from "./customIndicators";
import { createPineRuntimeJob } from "./pineRuntime";
import { migratePineEnumInputs } from "./pineInputMigration";
import { PineProtocolError } from "./pineProtocol";
import type { PineContext, PineExecutionResult, PineStrategySettings, PinePrepareResult, PineSourceSnapshot, PineViewport } from "./pineProtocol";

export function createCustomScriptRuntimeJob(options: {
  source: string;
  bars: Candle[];
  sourceSnapshot?: PineSourceSnapshot;
  viewport?: PineViewport | null;
  inputs?: Record<string, EdgeIndicatorInputValue>;
  mode: "historical" | "live";
  context?: PineContext;
  strategySettings?: PineStrategySettings;
  inputMetadata?: PinePrepareResult;
}): { id: string; cancel(): void; promise: Promise<EdgeIndicatorExecutionResult | PineExecutionResult> } {
  if (!isPineScriptSource(options.source)) return createIndicatorRuntimeJob(options);
  // The stored declaration proves whether saved strings were labels or member IDs.
  const saved = options.inputMetadata;
  if (saved?.source === options.source && saved.inputDefinitions.some((item) => item.type === "enum" && item.enumVersion !== 1)) {
    const preparation = createPineRuntimeJob({ action: "prepare", source: options.source });
    let cancelled = false, cancel = preparation.cancel;
    return { id: preparation.id, cancel: () => { cancelled = true; cancel(); }, promise: preparation.promise.then((prepared) => {
      if (cancelled) throw new PineProtocolError("CANCELLED", "Pine execution was cancelled.");
      if (prepared.kind !== "prepare") throw new Error("Native Pine preparation returned execution data.");
      const inputs = migratePineEnumInputs(saved, prepared, options.inputs).inputs;
      const job = createPineRuntimeJob({ ...options, inputs, action: "run" });
      cancel = job.cancel;
      return job.promise;
    }).then((result) => {
      if (result.kind !== "run") throw new Error("Native Pine execution returned preparation metadata.");
      return result;
    }) };
  }
  const job = createPineRuntimeJob({ ...options, action: "run" });
  return { ...job, promise: job.promise.then((result) => {
    if (result.kind !== "run") throw new Error("Native Pine execution returned preparation metadata.");
    return result;
  }) };
}
