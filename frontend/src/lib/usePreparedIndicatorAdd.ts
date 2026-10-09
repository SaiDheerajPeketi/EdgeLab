import { useCallback, useEffect, useRef, useState } from "react";
import { assertAppDataAccess, captureAppDataAccess, type AppDataAccess } from "./appDataBarrier";
import { subscribeAuthSession } from "./authSession";
import { isPineScriptSource, sanitizePinePrepared, type CustomIndicatorScript } from "./customIndicators";
import { createPineRuntimeJob } from "./pineRuntime";

type Scope = { activePaneLabel: string; symbol: string; timeframe: string; sourceTimeframe: string | null };
type Pending = { id: string; source: string; scope: number; access: AppDataAccess | null; invalidated: boolean; cancel(): void };
const sameAccess = (a: AppDataAccess | null, b: AppDataAccess | null) => a?.owner === b?.owner && a?.token === b?.token && a?.epoch === b?.epoch;

/** Compile raw Pine before either library or favorite actions reach the chart. */
export function usePreparedIndicatorAdd(scope: Scope, scripts: readonly CustomIndicatorScript[], onAdd?: (script: CustomIndicatorScript) => void) {
  const key = JSON.stringify([scope.activePaneLabel, scope.symbol, scope.timeframe, scope.sourceTimeframe]);
  const current = useRef({ key, generation: 0, scripts, onAdd });
  if (current.current.key !== key) current.current.generation++;
  current.current = { key, generation: current.current.generation, scripts, onAdd };
  const mounted = useRef(false), pending = useRef<Pending>();
  const [state, setState] = useState<{ pendingId?: string; message?: string }>({});
  const active = pending.current;
  if (active && (active.scope !== current.current.generation || !scripts.some(script => script.id === active.id && script.source === active.source))) active.invalidated = true;

  const retire = useCallback(() => {
    const job = pending.current;
    if (job) { job.invalidated = true; pending.current = undefined; job.cancel(); }
    if (mounted.current) setState({});
  }, []);
  useEffect(() => {
    mounted.current = true;
    const check = () => {
      const job = pending.current;
      if (!job) return;
      try { assertAppDataAccess(job.access); if (!sameAccess(job.access, captureAppDataAccess())) retire(); }
      catch { retire(); }
    };
    const unsubscribe = subscribeAuthSession(check);
    const storage = (event: StorageEvent) => { if (event.key === null) retire(); else check(); };
    window.addEventListener("edgelab:auth-session-change", retire);
    window.addEventListener("edgelab:app-data-state-change", check);
    window.addEventListener("storage", storage);
    return () => {
      mounted.current = false; retire(); unsubscribe();
      window.removeEventListener("edgelab:auth-session-change", retire);
      window.removeEventListener("edgelab:app-data-state-change", check);
      window.removeEventListener("storage", storage);
    };
  }, [retire]);
  useEffect(() => {
    if (pending.current?.invalidated) retire();
  }, [scripts, retire]);
  useEffect(retire, [key, retire]);

  const add = useCallback((script: CustomIndicatorScript) => {
    if (!mounted.current || pending.current || !current.current.onAdd) return;
    try {
      const captured = structuredClone(script), access = captureAppDataAccess(), onAdd = current.current.onAdd;
      assertAppDataAccess(access);
      const prepared = isPineScriptSource(captured.source) ? sanitizePinePrepared(captured.pinePrepared, captured.source) : undefined;
      if (prepared && captured.origin === "first-party" && prepared.declaration !== "indicator") throw new Error("Built-in studies require an indicator declaration.");
      if (!isPineScriptSource(captured.source) || prepared) {
        onAdd({ ...captured, ...(prepared ? { pinePrepared: prepared } : {}) }); setState({}); return;
      }
      const job = createPineRuntimeJob({ action: "prepare", source: captured.source });
      const owner: Pending = { id: captured.id, source: captured.source, scope: current.current.generation, access, invalidated: false, cancel: job.cancel };
      pending.current = owner; setState({ pendingId: captured.id, message: `Adding ${captured.name}…` });
      const owns = () => mounted.current && pending.current === owner && !owner.invalidated && owner.scope === current.current.generation
        && current.current.scripts.some(item => item.id === owner.id && item.source === owner.source);
      void job.promise.then(result => {
        if (!owns()) return;
        assertAppDataAccess(access);
        if (!sameAccess(access, captureAppDataAccess())) { retire(); return; }
        const metadata = result.kind === "prepare" ? sanitizePinePrepared(result, captured.source) : undefined;
        if (!metadata) throw new Error("Indicator preparation did not return its source-owned metadata.");
        if (captured.origin === "first-party" && metadata.declaration !== "indicator") throw new Error("Built-in studies require an indicator declaration.");
        onAdd({ ...captured, pinePrepared: metadata });
        if (owns()) setState({});
      }).catch(() => {
        if (owns()) setState({ message: `Could not add ${captured.name}. Try again, or reload the chart.` });
      }).finally(() => {
        if (pending.current !== owner) return;
        pending.current = undefined;
        if (owner.invalidated && mounted.current) setState({});
      });
    } catch {
      setState({ message: `Could not add ${script.name}. Try again, or reload the chart.` });
    }
  }, [retire]);
  return { add, ...state };
}
