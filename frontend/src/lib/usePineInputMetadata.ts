import { useEffect, useState } from "react";
import { createPineRuntimeJob } from "./pineRuntime";
import type { PinePrepareResult } from "./pineProtocol";

/** Refresh older saved activation metadata through the isolated compiler. */
export function usePineInputMetadata(source: string | undefined, prepared: PinePrepareResult | undefined): PinePrepareResult | undefined {
  const legacy = Boolean(source && prepared?.inputDefinitions.some((item) => item.active !== undefined && !item.activeCondition));
  const [refreshed, setRefreshed] = useState<PinePrepareResult>();
  useEffect(() => {
    if (!source || !legacy) return;
    let current = true;
    const job = createPineRuntimeJob({ action: "prepare", source });
    void job.promise.then((result) => {
      if (current && result.kind === "prepare") setRefreshed(result);
    }).catch(() => { /* Keep the existing Check script recovery available. */ });
    return () => { current = false; job.cancel(); };
  }, [source, legacy]);
  if (!legacy) return prepared;
  return refreshed?.source === source ? refreshed : undefined;
}
