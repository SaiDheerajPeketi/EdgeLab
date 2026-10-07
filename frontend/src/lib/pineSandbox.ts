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
  const send = (type, payload, transfer = []) => parent.postMessage({nonce, type, payload}, origin, transfer);
  // A fixed transport allowlist, never a recursive collector over worker objects.
  const boundedMetadata = value => {
    const active = new Set(); let nodes = 0, textBytes = 0;
    const countText = text => { textBytes += new TextEncoder().encode(text).length; if (textBytes > 1000000) throw new Error('Metadata too large'); };
    const walk = (item, depth) => {
      if (++nodes > 100000 || depth > 12) throw new Error('Metadata structure too large');
      if (item === null || typeof item === 'boolean') return;
      if (typeof item === 'number') { if (!Number.isFinite(item)) throw new Error('Nonfinite metadata'); return; }
      if (typeof item === 'string') { if (item.length > 20000) throw new Error('Metadata string too large'); countText(item); return; }
      if (!item || typeof item !== 'object' || active.has(item)) throw new Error('Invalid metadata');
      active.add(item);
      if (Array.isArray(item)) {
        if (Object.getPrototypeOf(item) !== Array.prototype || item.length > 65536 || Reflect.ownKeys(item).some(key => typeof key !== 'string' || (key !== 'length' && (!/^(0|[1-9]\\d*)$/.test(key) || Number(key) >= item.length)))) throw new Error('Invalid metadata array');
        for (const child of item) walk(child, depth + 1);
      } else {
        if (![Object.prototype,null].includes(Object.getPrototypeOf(item))) throw new Error('Nonplain metadata');
        for (const key of Reflect.ownKeys(item)) {
          if (typeof key !== 'string' || key.length > 128 || ['__proto__','prototype','constructor'].includes(key)) throw new Error('Invalid metadata key');
          const descriptor = Object.getOwnPropertyDescriptor(item,key);
          if (!('value' in descriptor) || !descriptor.enumerable) throw new Error('Invalid metadata field');
          countText(key); walk(descriptor.value,depth + 1);
        }
      }
      active.delete(item);
    };
    walk(value,0);
    const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
    if (bytes > 1000000) throw new Error('Metadata too large');
    return bytes;
  };
  const transferBuffers = payload => {
    if (payload?.encoding !== 'pine-packed-v1') {
      boundedMetadata(payload);
      if (payload?.result?.language === 'pine' && payload.result.kind === 'run') {
        const plots = payload.result.plots;
        if (!Array.isArray(plots) || plots.length * payload.result.audit?.bars > 4096 || plots.reduce((total,plot) => total + (Array.isArray(plot.points) ? plot.points.length : Infinity),0) > 4096) throw new Error('Plain Pine sample limit exceeded');
      }
      return [];
    }
    if (Object.keys(payload).some(key => !['id','status','encoding','result','buffers'].includes(key)) || payload.status !== 'completed') throw new Error('Invalid packed envelope fields');
    if (!payload.result || Object.keys(payload.result).some(key => !['kind','source','language','pineVersion','declaration','name','overlay','inputDefinitions','diagnostics','inputs','plots','strategy','audit'].includes(key))) throw new Error('Invalid packed result fields');
    const plots = payload.result?.plots, buffers = payload.buffers;
    if (!Array.isArray(plots) || plots.length > 64 || !Array.isArray(buffers) || Object.getPrototypeOf(buffers) !== Array.prototype || Reflect.ownKeys(buffers).some(key => typeof key !== 'string' || (key !== 'length' && (!/^(0|[1-9]\\d*)$/.test(key) || Number(key) >= buffers.length))) || buffers.length !== plots.length * 3) throw new Error('Invalid packed envelope');
    let bytes = 0;
    const seen = new Set(), used = new Set();
    for (const buffer of buffers) {
      if (!buffer || Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype || Reflect.ownKeys(buffer).length || buffer.resizable === true || seen.has(buffer)) throw new Error('Invalid packed buffer');
      new Uint8Array(buffer); seen.add(buffer); bytes += buffer.byteLength;
      if (bytes > 16000000) throw new Error('Packed output too large');
    }
    for (const plot of plots) {
      const data = plot?.packed;
      if (!data || !Number.isInteger(data.slots) || data.slots < 1 || data.slots > 20000 || ![1,4].includes(data.arity)) throw new Error('Invalid packed dimensions');
      for (const [key, size] of [['values',data.slots * data.arity * 8],['kinds',data.slots],['optionIndices',data.slots * 2]]) {
        const index = data[key];
        if (!Number.isInteger(index) || index < 0 || index >= buffers.length || used.has(index) || buffers[index].byteLength !== size) throw new Error('Invalid packed buffer reference');
        used.add(index);
      }
    }
    if (used.size !== buffers.length) throw new Error('Unreferenced packed buffer');
    const metadata = {...payload,buffers:[]};
    const metadataBytes = boundedMetadata(metadata);
    if (metadataBytes > 1000000 || bytes + metadataBytes > 16000000) throw new Error('Packed metadata too large');
    return buffers;
  };
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
      worker.onmessage = message => {
        stop();
        try { send('result', message.data, transferBuffers(message.data)); }
        catch { send('result', {id:event.data.request.id,status:'failed',error:{code:'INVALID_MESSAGE',message:'The isolated worker returned invalid packed transport.'}}); }
      };
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
