import { hasLegacyPineEnums, migratePineEnumInputs } from "./pineInputMigration";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPineRuntimeJob } from "./pineRuntime";
import type { PinePrepareResult } from "./pineProtocol";

/** Refresh older saved input metadata through the isolated compiler. */
export function usePineInputMetadata(source: string | undefined, prepared: PinePrepareResult | undefined): PinePrepareResult | undefined {
  const legacy = Boolean(source && prepared?.inputDefinitions.some((item) => (item.active !== undefined && !item.activeCondition) || (item.type === "enum" && item.enumVersion !== 1)));
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

type PineInputMigrationUpdate = {
  prepared: PinePrepareResult;
  inputs: Record<string, import("./pineProtocol").PineInputValue>;
  recovery: Record<string, string>;
};

/** Publish metadata and values together, so a member ID cannot become a legacy label again. */
export function usePineInputMigration(
  saved: PinePrepareResult | undefined,
  current: PinePrepareResult | undefined,
  inputs: Record<string, import("./pineProtocol").PineInputValue> | undefined,
  recovery: Record<string, string> | undefined,
  onMigrate: (update: PineInputMigrationUpdate) => void,
) {
  const effective = useMemo(() => current ? migratePineEnumInputs(saved, current, inputs, recovery) : { inputs: inputs ?? {}, recovery: recovery ?? {} }, [saved, current, inputs, recovery]);
  const submitted = useRef<string>();
  useEffect(() => {
    if (!hasLegacyPineEnums(saved) || !current || saved?.source !== current.source ||
      current.inputDefinitions.some((item) => item.type === "enum" && item.enumVersion !== 1)) {
      submitted.current = undefined;
      return;
    }
    const signature = JSON.stringify([saved, current, inputs ?? {}, recovery ?? {}]);
    if (submitted.current === signature) return;
    submitted.current = signature;
    onMigrate({ prepared: current, ...migratePineEnumInputs(saved, current, inputs, recovery) });
  }, [saved, current, inputs, recovery, onMigrate]);
  return effective;
}
