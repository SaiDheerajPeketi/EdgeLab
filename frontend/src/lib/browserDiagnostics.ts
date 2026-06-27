type DiagnosticEntryType = "fetch" | "websocket";

type DiagnosticEntry = {
  id: string;
  type: DiagnosticEntryType;
  method: string;
  url: string;
  status: number;
  statusText: string;
  startedAt: string;
  durationMs: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  error?: string;
};

type HarHeader = {
  name: string;
  value: string;
};

type HarEntry = {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    headers: HarHeader[];
    queryString: HarHeader[];
    cookies: unknown[];
    headersSize: number;
    bodySize: number;
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    headers: HarHeader[];
    cookies: unknown[];
    content: {
      size: number;
      mimeType: string;
      text?: string;
    };
    redirectURL: string;
    headersSize: number;
    bodySize: number;
  };
  cache: Record<string, never>;
  timings: {
    send: number;
    wait: number;
    receive: number;
  };
  _edgelab: {
    id: string;
    type: DiagnosticEntryType;
    error?: string;
  };
};

export type DiagnosticsHarSnapshot = {
  log: {
    version: "1.2";
    creator: {
      name: "EdgeLab browser diagnostics";
      version: "1";
    };
    pages: unknown[];
    entries: HarEntry[];
  };
};

const MAX_DIAGNOSTIC_ENTRIES = 120;
const REDACTED = "[redacted]";
const SENSITIVE_HEADER_NAMES = new Set(["authorization", "cookie", "set-cookie", "x-api-key"]);
const SENSITIVE_QUERY_PARTS = ["token", "secret", "password", "jwt", "key", "auth"];

const entries: DiagnosticEntry[] = [];
let installed = false;

export function installBrowserDiagnostics() {
  if (installed || typeof window === "undefined") {
    return;
  }

  installed = true;
  installFetchDiagnostics();
}

export function trackDiagnosticWebSocket(socket: WebSocket, rawUrl: string | URL) {
  const startedAtMs = performance.now();
  const entry: DiagnosticEntry = {
    id: makeEntryId(),
    type: "websocket",
    method: "GET",
    url: sanitizeUrl(String(rawUrl)),
    status: 0,
    statusText: "CONNECTING",
    startedAt: new Date().toISOString(),
    durationMs: 0,
  };

  socket.addEventListener("open", () => {
    entry.status = 101;
    entry.statusText = "OPEN";
    entry.durationMs = elapsed(startedAtMs);
    pushEntry(entry);
  }, { once: true });

  socket.addEventListener("error", () => {
    entry.status = 0;
    entry.statusText = "ERROR";
    entry.error = "WebSocket connection failed";
    entry.durationMs = elapsed(startedAtMs);
    pushEntry(entry);
  }, { once: true });

  socket.addEventListener("close", (event) => {
    pushEntry({
      ...entry,
      id: makeEntryId(),
      status: event.code,
      statusText: event.reason || "CLOSED",
      durationMs: elapsed(startedAtMs),
      error: event.wasClean ? undefined : "WebSocket closed unexpectedly",
    });
  }, { once: true });
}

export function buildDiagnosticsHarSnapshot(): DiagnosticsHarSnapshot {
  return {
    log: {
      version: "1.2",
      creator: {
        name: "EdgeLab browser diagnostics",
        version: "1",
      },
      pages: [],
      entries: entries.map(toHarEntry),
    },
  };
}

function installFetchDiagnostics() {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const startedAtMs = performance.now();
    const entry: DiagnosticEntry = {
      id: makeEntryId(),
      type: "fetch",
      method: resolveFetchMethod(input, init),
      url: sanitizeUrl(resolveFetchUrl(input)),
      status: 0,
      statusText: "PENDING",
      startedAt: new Date().toISOString(),
      durationMs: 0,
      requestHeaders: headersToRecord(init?.headers),
    };

    try {
      const response = await originalFetch(input, init);
      entry.status = response.status;
      entry.statusText = response.statusText;
      entry.durationMs = elapsed(startedAtMs);
      entry.responseHeaders = headersToRecord(response.headers);
      pushEntry(entry);
      return response;
    } catch (error) {
      entry.statusText = "NETWORK_ERROR";
      entry.durationMs = elapsed(startedAtMs);
      entry.error = error instanceof Error ? error.message : "Network request failed";
      pushEntry(entry);
      throw error;
    }
  };
}

function pushEntry(entry: DiagnosticEntry) {
  const previousIndex = entries.findIndex((candidate) => candidate.id === entry.id);
  if (previousIndex >= 0) {
    entries.splice(previousIndex, 1, entry);
  } else {
    entries.push(entry);
  }

  if (entries.length > MAX_DIAGNOSTIC_ENTRIES) {
    entries.splice(0, entries.length - MAX_DIAGNOSTIC_ENTRIES);
  }
}

function toHarEntry(entry: DiagnosticEntry): HarEntry {
  return {
    startedDateTime: entry.startedAt,
    time: entry.durationMs,
    request: {
      method: entry.method,
      url: entry.url,
      httpVersion: "HTTP/1.1",
      headers: recordToHarHeaders(entry.requestHeaders ?? {}),
      queryString: queryStringToHarHeaders(entry.url),
      cookies: [],
      headersSize: -1,
      bodySize: -1,
    },
    response: {
      status: entry.status,
      statusText: entry.statusText,
      httpVersion: "HTTP/1.1",
      headers: recordToHarHeaders(entry.responseHeaders ?? {}),
      cookies: [],
      content: {
        size: 0,
        mimeType: entry.responseHeaders?.["content-type"] ?? "",
        text: entry.error,
      },
      redirectURL: "",
      headersSize: -1,
      bodySize: -1,
    },
    cache: {},
    timings: {
      send: 0,
      wait: entry.durationMs,
      receive: 0,
    },
    _edgelab: {
      id: entry.id,
      type: entry.type,
      error: entry.error,
    },
  };
}

function resolveFetchUrl(input: RequestInfo | URL) {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function resolveFetchMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) {
    return init.method.toUpperCase();
  }
  if (typeof input === "object" && "method" in input && input.method) {
    return input.method.toUpperCase();
  }
  return "GET";
}

function sanitizeUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl, window.location.origin);
    url.username = "";
    url.password = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSensitiveName(key)) {
        url.searchParams.set(key, REDACTED);
      }
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function queryStringToHarHeaders(rawUrl: string): HarHeader[] {
  try {
    const url = new URL(rawUrl);
    return Array.from(url.searchParams.entries()).map(([name, value]) => ({
      name,
      value: isSensitiveName(name) ? REDACTED : value,
    }));
  } catch {
    return [];
  }
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }

  const record: Record<string, string> = {};
  const appendHeader = (name: string, value: string) => {
    const normalizedName = name.toLowerCase();
    record[normalizedName] = isSensitiveName(normalizedName) ? REDACTED : value;
  };

  if (headers instanceof Headers) {
    headers.forEach((value, name) => appendHeader(name, value));
    return record;
  }

  if (Array.isArray(headers)) {
    for (const [name, value] of headers) {
      appendHeader(name, value);
    }
    return record;
  }

  for (const [name, value] of Object.entries(headers)) {
    appendHeader(name, value);
  }
  return record;
}

function recordToHarHeaders(record: Record<string, string>): HarHeader[] {
  return Object.entries(record).map(([name, value]) => ({ name, value }));
}

function isSensitiveName(name: string) {
  const normalizedName = name.toLowerCase();
  return SENSITIVE_HEADER_NAMES.has(normalizedName)
    || SENSITIVE_QUERY_PARTS.some((part) => normalizedName.includes(part));
}

function makeEntryId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function elapsed(startedAtMs: number) {
  return Math.round((performance.now() - startedAtMs) * 100) / 100;
}
