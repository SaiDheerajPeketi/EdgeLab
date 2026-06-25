import http from "k6/http";
import { check, sleep } from "k6";

const apiBaseUrl = (__ENV.EDGELAB_API_BASE_URL || "http://127.0.0.1:8080/api").replace(/\/$/, "");
const authToken = (__ENV.EDGELAB_AUTH_TOKEN || "").trim();
const vus = Number(__ENV.K6_VUS || 20);
const duration = __ENV.K6_DURATION || "30s";
const limit = Number(__ENV.EDGELAB_TRADES_LIMIT || 100);
const sessionId = (__ENV.EDGELAB_SESSION_ID || "").trim();

if (!authToken) {
  throw new Error("EDGELAB_AUTH_TOKEN is required for trades cursor benchmark");
}

export const options = {
  scenarios: {
    trades_page_cursor: {
      executor: "constant-vus",
      vus,
      duration,
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<130", "p(99)<260"],
  },
};

export default function () {
  const headers = {
    Authorization: `Bearer ${authToken}`,
  };
  const params = new URLSearchParams({ limit: String(limit) });
  if (sessionId) {
    params.set("session_id", sessionId);
  }
  const first = http.get(`${apiBaseUrl}/trades/page?${params.toString()}`, {
    headers,
    tags: {
      endpoint: "trades_page_cursor_first",
    },
  });

  check(first, {
    "trades first page status is 200": (res) => res.status === 200,
  });

  if (first.status === 200) {
    const payload = JSON.parse(first.body);
    if (payload.next_cursor) {
      const nextParams = new URLSearchParams({ limit: String(limit), cursor: payload.next_cursor });
      if (sessionId) {
        nextParams.set("session_id", sessionId);
      }
      const second = http.get(`${apiBaseUrl}/trades/page?${nextParams.toString()}`, {
        headers,
        tags: {
          endpoint: "trades_page_cursor_second",
        },
      });
      check(second, {
        "trades cursor page status is 200": (res) => res.status === 200,
        "trades cursor payload has items": (res) => {
          if (res.status !== 200) {
            return false;
          }
          const page = JSON.parse(res.body);
          return Array.isArray(page.items);
        },
      });
    }
  }

  sleep(1);
}
