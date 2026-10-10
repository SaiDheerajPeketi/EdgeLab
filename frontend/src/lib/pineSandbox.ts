export type SandboxJob<T> = { id: string; cancel(): void; promise: Promise<T> };
export type SandboxSession<Request, Result> = SandboxJob<Result> & { send(request: Request): Promise<Result> };

export class PineSandboxError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "PineSandboxError"; }
}

// This bridge is fixed trusted code. Source, bars and results travel as messages,
// never HTML. Blob creation inside the opaque frame inherits its restrictive CSP.
const bridge = `(() => {
  const nonce = document.currentScript.dataset.job;
  const origin = document.currentScript.dataset.origin;
  const persistent = document.currentScript.dataset.session === 'true';
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
    if (!payload.result || Object.keys(payload.result).some(key => !['kind','source','language','pineVersion','declaration','name','overlay','behindChart','usesVisibleRange','format','precision','inputDefinitions','diagnostics','inputs','plots','lines','lineFills','boxes','labels','polylines','tables','strategy','audit','alertConditions','alertEvents','calculationInputs','conditionSamples'].includes(key))) throw new Error('Invalid packed result fields');
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
      const names = data.numericOptions === undefined ? [] : data.numericOptions;
      if (!Array.isArray(names) || names.length > 64 || new Set(names).size !== names.length || names.some(key => typeof key !== 'string' || !key.length || key.length > 128 || ['__proto__','prototype','constructor'].includes(key))) throw new Error('Invalid numeric option names');
      for (const [key, size] of [['values',data.slots * (data.arity + names.length) * 8],['kinds',data.slots * (1 + names.length)],['optionIndices',data.slots * 2]]) {
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
    if (persistent && initialized && event.data.type === 'request') {
      if (!worker) { send('failure'); return; }
      worker.postMessage(event.data.request); return;
    }
    if (initialized || event.data.type !== 'start') return;
    initialized = true;
    try {
      url = URL.createObjectURL(new Blob([event.data.workerSource], {type:'text/javascript'}));
      worker = new Worker(url);
      worker.onmessage = message => {
        if (!persistent) stop();
        try {
          if (persistent) {
            const payload = message.data;
            if (!payload || Object.getPrototypeOf(payload) !== Object.prototype || Reflect.ownKeys(payload).some(key => !['protocol','sessionId','sequence','response'].includes(key)) || payload.protocol !== 'pine-live-v1' || typeof payload.sessionId !== 'string' || !Number.isSafeInteger(payload.sequence)) throw new Error('Invalid live envelope');
            const buffers = transferBuffers(payload.response);
            const response = payload.response?.encoding === 'pine-packed-v1' ? {...payload.response,buffers:[]} : payload.response;
            const metadata = boundedMetadata({...payload,response});
            if (metadata + buffers.reduce((bytes,buffer) => bytes + buffer.byteLength,0) > 16000000) throw new Error('Live result too large');
            send('result',payload,buffers);
          } else send('result', message.data, transferBuffers(message.data));
        }
        catch {
          stop();
          if (persistent) send('failure');
          else send('result', {id:event.data.request.id,status:'failed',error:{code:'INVALID_MESSAGE',message:'The isolated worker returned invalid packed transport.'}});
        }
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

/** One opaque worker, ordered bounded commands, and a deadline for each response. */
export function createSandboxWorkerSession<Request, Result>(options: {
  id: string;
  request: Request;
  loadWorker(signal: AbortSignal): Promise<string>;
  validate(value: unknown, request: Request): Result;
  timeoutMs: number;
  maxQueued: number;
  updateTimeoutMs?: number;
  requestTimeoutMs?(request: Request): number;
}): SandboxSession<Request, Result> {
  type Entry = { request: Request; resolve(value: Result): void; reject(error: unknown): void };
  const queue: Entry[] = [];
  const abort = new AbortController();
  let frame: HTMLIFrameElement | undefined;
  let pending: Entry | undefined;
  let ready = false, loaded = false, started = false, stopped = false, settling = false;
  let workerSource = "";
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let terminationTimer: ReturnType<typeof setTimeout> | undefined;
  let stopReason: unknown;
  const nonce = typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function" ? randomId() : "";
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(deadline);
    clearTimeout(terminationTimer);
    abort.abort();
    window.removeEventListener("message", receive);
    frame?.remove();
    frame = undefined;
    workerSource = "";
  };
  const stop = (reason: unknown, alreadyStopped = false) => {
    if (settling || stopped) return;
    settling = true;
    stopReason = reason;
    clearTimeout(deadline);
    abort.abort();
    pending?.reject(reason);
    pending = undefined;
    for (const entry of queue.splice(0)) entry.reject(reason);
    if (!ready || alreadyStopped) { cleanup(); return; }
    frame?.contentWindow?.postMessage({ nonce, type: "stop" }, "*");
    terminationTimer = setTimeout(cleanup, 150);
  };
  const arm = (duration = options.timeoutMs) => {
    clearTimeout(deadline);
    deadline = setTimeout(() => stop(new PineSandboxError("TIME_LIMIT", `Pine execution exceeded its ${duration} ms time limit.`)), duration);
  };
  const dispatch = () => {
    if (!frame || !ready || !loaded || pending || settling || stopped || !queue.length) return;
    pending = queue.shift()!;
    arm(options.requestTimeoutMs?.(pending.request) ?? (started ? options.updateTimeoutMs ?? options.timeoutMs : options.timeoutMs));
    if (!started) {
      started = true;
      frame.contentWindow?.postMessage({ nonce, type: "start", workerSource, request: pending.request }, "*");
      workerSource = "";
    } else frame.contentWindow?.postMessage({ nonce, type: "request", request: pending.request }, "*");
  };
  const receive = (event: MessageEvent) => {
    if (stopped || event.source !== frame?.contentWindow || event.origin !== "null" || event.data?.nonce !== nonce) return;
    if (event.data.type === "stopped") { if (settling) cleanup(); return; }
    if (settling) return;
    if (event.data.type === "ready") {
      if (ready) { stop(new PineSandboxError("INVALID_MESSAGE", "Duplicate isolated-worker initialization.")); return; }
      ready = true;
      dispatch();
    } else if (event.data.type === "result") {
      if (!pending) { stop(new PineSandboxError("INVALID_MESSAGE", "Unexpected live Pine response.")); return; }
      const entry = pending;
      try {
        const result = options.validate(event.data.payload, entry.request);
        pending = undefined;
        clearTimeout(deadline);
        entry.resolve(result);
        dispatch();
      } catch (error) { stop(error); }
    } else if (event.data.type === "failure") stop(new PineSandboxError("WORKER_ERROR", "The isolated live Pine worker failed."), true);
  };
  const send = (request: Request): Promise<Result> => {
    if (settling || stopped) return Promise.reject(stopReason ?? new PineSandboxError("CANCELLED", "Live Pine execution was cancelled."));
    if (queue.length >= options.maxQueued) {
      const error = new PineSandboxError("QUEUE_LIMIT", "Live Pine updates exceeded the pending-update limit. Reapply the indicator to restart.");
      stop(error);
      return Promise.reject(error);
    }
    const promise = new Promise<Result>((resolve, reject) => { queue.push({ request, resolve, reject }); });
    dispatch();
    return promise;
  };
  const promise = send(options.request);
  if (typeof document === "undefined" || typeof Worker === "undefined" || !nonce || typeof location === "undefined" || location.origin === "null") {
    // No frame or browser listeners exist on this path.
    settling = stopped = true;
    stopReason = new PineSandboxError("ISOLATION_UNAVAILABLE", "This browser cannot start an isolated live Pine worker.");
    for (const entry of queue.splice(0)) entry.reject(stopReason);
  } else {
    frame = document.createElement("iframe");
    frame.hidden = true;
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("referrerpolicy", "no-referrer");
    const origin = location.origin.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const csp = `default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-eval'; worker-src blob:; connect-src 'none'; child-src 'none'; img-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
    frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><script nonce="${nonce}" data-job="${nonce}" data-origin="${origin}" data-session="true">${bridge}</script>`;
    arm(); // Loading and initialization are bounded too.
    window.addEventListener("message", receive);
    try { document.body.appendChild(frame); }
    catch { stop(new PineSandboxError("ISOLATION_UNAVAILABLE", "This browser cannot create an isolated live Pine frame.")); }
    if (!settling) void options.loadWorker(abort.signal).then(source => {
      if (settling || stopped) return;
      if (typeof source !== "string" || !source.length || source.length > 8_000_000) {
        stop(new PineSandboxError("WORKER_ASSET", "The trusted Pine engine asset is invalid.")); return;
      }
      workerSource = source;
      loaded = true;
      dispatch();
    }).catch(() => stop(new PineSandboxError("WORKER_ASSET", "The trusted Pine engine could not be loaded.")));
  }
  return { id: options.id, promise, send, cancel: () => stop(new PineSandboxError("CANCELLED", "Live Pine execution was cancelled.")) };
}
