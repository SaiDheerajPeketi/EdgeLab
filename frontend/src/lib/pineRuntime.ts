import workerAsset from "virtual:pine-worker-url";
import { createSandboxWorkerJob } from "./pineSandbox";
import { validatePineRequest, validatePineResponse, type PineRequest } from "./pineProtocol";

export function createPineRuntimeJob(input: Omit<PineRequest, "id">) {
  const id = `pine-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let request: PineRequest;
  try { request = validatePineRequest({ ...input, id }); }
  catch (error) { return { id, cancel: () => undefined, promise: Promise.reject(error) }; }
  return createSandboxWorkerJob({
    request,
    timeoutMs: request.action === "prepare" ? 3_000 : request.mode === "live" ? 2_000 : 10_000,
    validate: value => validatePineResponse(value, request),
    loadWorker: async signal => {
      const url = new URL(workerAsset, location.href);
      if (url.origin !== location.origin) throw new Error("The trusted Pine engine must be served by this application.");
      const response = await fetch(url, { signal, credentials: "omit", redirect: "error", cache: "force-cache" });
      if (!response.ok) throw new Error("The trusted Pine engine asset is unavailable.");
      return response.text();
    },
  });
}
