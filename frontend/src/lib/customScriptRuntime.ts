import type { Candle } from "./api";
import type { EdgeIndicatorExecutionResult, EdgeIndicatorInputValue } from "./indicatorDsl";
import { createIndicatorRuntimeJob } from "./indicatorRuntime";
import { isPineScriptSource } from "./customIndicators";
import { createPineRuntimeJob } from "./pineRuntime";
import { migratePineEnumInputs } from "./pineInputMigration";
import { PineProtocolError } from "./pineProtocol";
import type { PineContext, PineExecutionResult, PineStrategySettings, PinePrepareResult, PineSourceSnapshot, PineViewport } from "./pineProtocol";
import { createPineMarketDataResolver, type PineMarketDataScope } from "./pineMarketDataResolver";

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
  marketDataScope?: PineMarketDataScope;
}): { id: string; cancel(): void; promise: Promise<EdgeIndicatorExecutionResult | PineExecutionResult> } {
  if (!isPineScriptSource(options.source)) return createIndicatorRuntimeJob(options);
  const { marketDataScope, ...executionOptions } = options;
  // The stored declaration proves whether saved strings were labels or member IDs.
  const saved = options.inputMetadata;
  if (saved?.source === options.source && saved.inputDefinitions.some((item) => item.type === "enum" && item.enumVersion !== 1)) {
    // The migration worker belongs to the same durable identity as the later run.
    let guard: ReturnType<typeof createPineMarketDataResolver> | undefined;
    try { if (marketDataScope) guard = createPineMarketDataResolver(marketDataScope); }
    catch (error) { return { id: "pine-migration-unavailable", cancel: () => {}, promise: Promise.reject(error) }; }
    const preparation = createPineRuntimeJob({ action: "prepare", source: options.source });
    let cancelled = false, cancel = preparation.cancel;
    const stop = () => { cancelled = true; cancel(); guard?.cancel(); };
    guard?.signal.addEventListener("abort", stop, { once: true });
    return { id: preparation.id, cancel: stop, promise: preparation.promise.then((prepared) => {
      if (cancelled) throw new PineProtocolError("CANCELLED", "Pine execution was cancelled.");
      guard?.assertActive();
      if (prepared.kind !== "prepare") throw new Error("Native Pine preparation returned execution data.");
      const inputs = migratePineEnumInputs(saved, prepared, options.inputs).inputs;
      const job = createPineRuntimeJob({ ...executionOptions, inputs, action: "run" }, { marketScope: marketDataScope });
      cancel = job.cancel;
      return job.promise;
    }).then((result) => {
      guard?.assertActive();
      if (result.kind !== "run") throw new Error("Native Pine execution returned preparation metadata.");
      return result;
    }).finally(() => { guard?.signal.removeEventListener("abort", stop); guard?.cancel(); }) };
  }
  const job = createPineRuntimeJob({ ...executionOptions, action: "run" }, { marketScope: marketDataScope });
  return { ...job, promise: job.promise.then((result) => {
    if (result.kind !== "run") throw new Error("Native Pine execution returned preparation metadata.");
    return result;
  }) };
}
