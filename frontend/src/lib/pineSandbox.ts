export type SandboxJob<T> = { id: string; cancel(): void; promise: Promise<T> };

export class PineSandboxError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "PineSandboxError"; }
}

// This bridge is fixed trusted code. Source, bars and results travel as messages,
// never HTML. Blob creation inside the opaque frame inherits its restrictive CSP.
const bridge = `(() => {
  const nonce = document.currentScript.dataset.job;
  const origin = document.currentScript.dataset.origin;
  let worker = null, url = null, initialized = false;
  const send = (type, payload) => parent.postMessage({nonce, type, payload}, origin);
  const stop = () => {
    if (worker) {
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate(); worker = null;
    }
    if (url) { URL.revokeObjectURL(url); url = null; }
  };
  addEventListener('message', event => {
    if (event.source !== parent || event.origin !== origin || event.data?.nonce !== nonce) return;
    if (event.data.type === 'stop') { stop(); send('stopped'); return; }
    if (initialized || event.data.type !== 'start') return;
    initialized = true;
    try {
      url = URL.createObjectURL(new Blob([event.data.workerSource], {type:'text/javascript'}));
      worker = new Worker(url);
      worker.onmessage = event => { stop(); send('result', event.data); };
      worker.onerror = () => { stop(); send('failure', 'The isolated Pine worker failed.'); };
      worker.onmessageerror = () => { stop(); send('failure', 'The isolated Pine worker returned unreadable data.'); };
      worker.postMessage(event.data.request);
    } catch { stop(); send('failure', 'This browser could not start the isolated Pine worker.'); }
  });
  send('ready');
})();`;

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Internal transport. validate must treat every worker result as untrusted. */
export function createSandboxWorkerJob<T>(options: {
  request: { id: string };
  loadWorker(signal: AbortSignal): Promise<string>;
  validate(value: unknown): T;
  timeoutMs: number;
}): SandboxJob<T> {
  const { request, loadWorker, validate, timeoutMs } = options;
  let cancel = () => undefined as void;
  const promise = new Promise<T>((resolve, reject) => {
    if (typeof document === "undefined" || typeof Worker === "undefined" || typeof crypto === "undefined" || !crypto.getRandomValues || location.origin === "null") {
      reject(new PineSandboxError("ISOLATION_UNAVAILABLE", "This browser cannot start an isolated Pine worker."));
      return;
    }
    const nonce = randomId();
    const frame = document.createElement("iframe");
    const abort = new AbortController();
    let settling = false;
    let settled = false;
    let loaded = false;
    let ready = false;
    let workerSource = "";
    let terminationTimer: ReturnType<typeof setTimeout> | undefined;
    let completion: { result?: T; error?: unknown } | undefined;
    frame.hidden = true;
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("referrerpolicy", "no-referrer");
    const origin = location.origin.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const csp = `default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-eval'; worker-src blob:; connect-src 'none'; child-src 'none'; img-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
    frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><script nonce="${nonce}" data-job="${nonce}" data-origin="${origin}">${bridge}</script>`;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (terminationTimer !== undefined) clearTimeout(terminationTimer);
      abort.abort();
      window.removeEventListener("message", receive);
      frame.remove();
      if (completion?.error) reject(completion.error);
      else resolve(completion!.result!);
    };
    const finish = (result?: T, error?: unknown, alreadyStopped = false) => {
      if (settling || settled) return;
      settling = true;
      completion = { result, error };
      clearTimeout(deadline);
      abort.abort();
      if (alreadyStopped || !ready) { cleanup(); return; }
      // The fixed bridge explicitly terminates its worker before acknowledging.
      frame.contentWindow?.postMessage({ nonce, type: "stop" }, "*");
      terminationTimer = setTimeout(cleanup, 150);
    };
    const start = () => {
      if (!loaded || !ready || settling || settled) return;
      frame.contentWindow?.postMessage({ nonce, type: "start", workerSource, request }, "*");
      loaded = false;
      workerSource = "";
    };
    const receive = (event: MessageEvent) => {
      if (settled || event.source !== frame.contentWindow || event.origin !== "null" || event.data?.nonce !== nonce) return;
      if (event.data.type === "stopped") { if (settling) cleanup(); return; }
      if (settling) return;
      if (event.data.type === "ready") { ready = true; start(); }
      else if (event.data.type === "result") {
        try { finish(validate(event.data.payload), undefined, true); }
        catch (error) { finish(undefined, error, true); }
      } else if (event.data.type === "failure") {
        finish(undefined, new PineSandboxError("WORKER_ERROR", "The isolated Pine worker could not complete this script."), true);
      }
    };
    const deadline = setTimeout(() => finish(undefined, new PineSandboxError("TIME_LIMIT", `Pine execution exceeded its ${timeoutMs} ms time limit.`)), timeoutMs);
    cancel = () => finish(undefined, new PineSandboxError("CANCELLED", "Pine execution was cancelled."));
    window.addEventListener("message", receive);
    try { document.body.appendChild(frame); }
    catch { finish(undefined, new PineSandboxError("ISOLATION_UNAVAILABLE", "This browser cannot create an isolated Pine frame.")); return; }
    void loadWorker(abort.signal).then(source => {
      if (settling || settled) return;
      if (typeof source !== "string" || source.length > 8_000_000 || !source.length) {
        finish(undefined, new PineSandboxError("WORKER_ASSET", "The trusted Pine engine asset is invalid.")); return;
      }
      workerSource = source; loaded = true; start();
    }).catch(() => finish(undefined, new PineSandboxError("WORKER_ASSET", "The trusted Pine engine could not be loaded.")));
  });
  return { id: request.id, promise, cancel: () => cancel() };
}
