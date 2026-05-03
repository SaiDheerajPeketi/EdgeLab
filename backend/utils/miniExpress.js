import http from "node:http";

export function createApp() {
  const router = createRouter();

  return {
    ...router,
    listen(port, callback) {
      const server = http.createServer(async (nodeReq, nodeRes) => {
        const req = await createRequest(nodeReq);
        const res = createResponse(nodeRes);

        setCorsHeaders(res);
        if (req.method === "OPTIONS") {
          res.status(204).send("");
          return;
        }

        router.handle(req, res, (error) => {
          if (error) {
            const status = error.statusCode ?? error.status ?? 500;
            res.status(status).json({
              error: error.code ?? "server_error",
              message: error.message ?? "Unexpected server error",
            });
            return;
          }
          res.status(404).json({
            error: "not_found",
            message: `${req.method} ${req.path} is not registered.`,
          });
        });
      });
      return server.listen(port, callback);
    },
  };
}

export function createRouter() {
  const routes = [];

  function add(method, pattern, ...handlers) {
    routes.push({ method, pattern, handlers, matcher: compilePattern(pattern) });
    return api;
  }

  const api = {
    routes,
    get: (pattern, ...handlers) => add("GET", pattern, ...handlers),
    post: (pattern, ...handlers) => add("POST", pattern, ...handlers),
    patch: (pattern, ...handlers) => add("PATCH", pattern, ...handlers),
    delete: (pattern, ...handlers) => add("DELETE", pattern, ...handlers),
    use(prefix, childRouter) {
      if (typeof prefix !== "string") return api;
      for (const route of childRouter.routes) {
        const pattern = joinPaths(prefix, route.pattern);
        routes.push({
          ...route,
          pattern,
          matcher: compilePattern(pattern),
        });
      }
      return api;
    },
    handle(req, res, out) {
      const route = routes.find((candidate) => {
        if (candidate.method !== req.method) return false;
        const match = candidate.matcher.exec(req.path);
        if (!match) return false;
        req.params = Object.fromEntries(
          candidate.matcher.keys.map((key, index) => [key, decodeURIComponent(match[index + 1])]),
        );
        return true;
      });

      if (!route) {
        out();
        return;
      }

      runHandlers(route.handlers, req, res, out);
    },
  };

  return api;
}

export default {
  Router: createRouter,
};

async function createRequest(nodeReq) {
  const url = new URL(nodeReq.url, `http://${nodeReq.headers.host ?? "127.0.0.1"}`);
  const rawBody = await readBody(nodeReq);
  const contentType = nodeReq.headers["content-type"] ?? "";
  let body = {};

  if (rawBody.length > 0 && contentType.includes("application/json")) {
    body = JSON.parse(rawBody.toString("utf8"));
  } else if (rawBody.length > 0 && contentType.includes("application/x-www-form-urlencoded")) {
    body = Object.fromEntries(new URLSearchParams(rawBody.toString("utf8")));
  }

  return {
    method: nodeReq.method,
    url: nodeReq.url,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    headers: nodeReq.headers,
    rawBody,
    body,
    params: {},
  };
}

function createResponse(nodeRes) {
  return {
    statusCode: 200,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(name, value) {
      nodeRes.setHeader(name, value);
      return this;
    },
    json(payload) {
      if (this.headersSent) return;
      this.headersSent = true;
      nodeRes.statusCode = this.statusCode;
      nodeRes.setHeader("content-type", "application/json; charset=utf-8");
      nodeRes.end(JSON.stringify(payload));
    },
    send(payload) {
      if (this.headersSent) return;
      this.headersSent = true;
      nodeRes.statusCode = this.statusCode;
      if (Buffer.isBuffer(payload)) {
        nodeRes.end(payload);
      } else {
        nodeRes.setHeader("content-type", "text/plain; charset=utf-8");
        nodeRes.end(String(payload ?? ""));
      }
    },
  };
}

function runHandlers(handlers, req, res, out) {
  let index = 0;

  function next(error) {
    if (error) {
      out(error);
      return;
    }
    const handler = handlers[index];
    index += 1;
    if (!handler) return;
    try {
      const result = handler(req, res, next);
      if (result && typeof result.then === "function") {
        result.catch(next);
      }
    } catch (handlerError) {
      next(handlerError);
    }
  }

  next();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function compilePattern(pattern) {
  const keys = [];
  const source = pattern
    .split("/")
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith(":")) {
        keys.push(part.slice(1));
        return "([^/]+)";
      }
      return escapeRegExp(part);
    })
    .join("/");
  const matcher = new RegExp(`^/${source}$`);
  matcher.keys = keys;
  return matcher;
}

function joinPaths(prefix, pattern) {
  return `/${[prefix, pattern]
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/")}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function setCorsHeaders(res) {
  res.set("access-control-allow-origin", "*");
  res.set("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.set("access-control-allow-headers", "content-type");
}
