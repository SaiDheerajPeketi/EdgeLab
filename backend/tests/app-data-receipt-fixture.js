// A server-side receipt fixture. Business requests remain visible to the test's
// fetch handler; reserve/recover transport is kept separately for assertions.
export function receiptFetch(handler, receipts = new Map(), calls = []) {
  return async (input, init = {}) => {
    const path = new URL(String(input), "http://fixture").pathname;
    const route = path.match(/^\/api\/app-data\/operations\/([^/]+)\/(reserve|recover)$/);
    if (route) {
      const [, id, action] = route;
      calls.push({ id, action, init });
      let receipt = receipts.get(id);
      if (action === "reserve" && !receipt) {
        receipt = { operation_id: id, ...JSON.parse(init.body), status: "reserved", http_status: null, result: null, created_at: "2026-10-07T12:00:00Z", completed_at: null };
        receipts.set(id, receipt);
      } else if (action === "recover" && (!receipt || receipt.status === "reserved")) {
        receipt = { operation_id: id, method: receipt?.method ?? null, path: receipt?.path ?? null, status: "canceled", http_status: null, result: null, created_at: receipt?.created_at ?? "2026-10-07T12:00:00Z", completed_at: "2026-10-07T12:00:01Z" };
        receipts.set(id, receipt);
      }
      if (receipt?.pendingResult) await receipt.pendingResult;
      const { pendingResult, ...body } = receipt;
      return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    }
    const id = new Headers(init.headers).get("X-EdgeLab-Operation-Id");
    const receipt = id && receipts.get(id);
    if (receipt) receipt.status = "running";
    const response = await handler(input, init);
    if (response.status === undefined) response.status = 200;
    if (response.ok === undefined) response.ok = response.status >= 200 && response.status < 300;
    if (receipt) {
      receipt.status = "completed";
      receipt.http_status = response.status ?? 200;
      receipt.completed_at = "2026-10-07T12:00:01Z";
      if (receipt.path === "/app-data/import" && receipt.http_status === 200 && response.clone?.().json) {
        receipt.pendingResult = response.clone().json().then((result) => { receipt.result = result; }, () => {});
      }
    }
    return response;
  };
}

export function installReceiptFetch(receipts = new Map(), calls = []) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  let current = globalThis.fetch;
  Object.defineProperty(globalThis, "fetch", { configurable: true, get: () => current, set: (handler) => { current = receiptFetch(handler, receipts, calls); } });
  return () => { if (descriptor) Object.defineProperty(globalThis, "fetch", descriptor); else delete globalThis.fetch; };
}
