import http from "k6/http";
import { check, sleep } from "k6";

const apiBaseUrl = (__ENV.EDGELAB_API_BASE_URL || "http://127.0.0.1:8080/api").replace(/\/$/, "");
const authToken = (__ENV.EDGELAB_AUTH_TOKEN || "").trim();
const vus = Number(__ENV.K6_VUS || 20);
const duration = __ENV.K6_DURATION || "30s";
const limit = Number(__ENV.EDGELAB_TRADES_LIMIT || 100);
const sessionId = (__ENV.EDGELAB_SESSION_ID || "").trim();

if (!authToken) {
  throw new Error("EDGELAB_AUTH_TOKEN is required for trades page benchmark");
}

export const options = {
  scenarios: {
    trades_page: {
      executor: "constant-vus",
      vus,
      duration,
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<120", "p(99)<250"],
  },
};

export default function () {
  const params = new URLSearchParams({ limit: String(limit) });
  if (sessionId) {
    params.set("session_id", sessionId);
  }
  const response = http.get(`${apiBaseUrl}/trades/page?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    tags: {
      endpoint: "trades_page",
    },
  });

  check(response, {
    "trades page status is 200": (res) => res.status === 200,
    "trades page has items": (res) => {
      if (res.status !== 200) {
        return false;
      }
      const payload = JSON.parse(res.body);
      return Array.isArray(payload.items);
    },
  });

  sleep(1);
}
