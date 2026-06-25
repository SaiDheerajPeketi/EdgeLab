import http from "k6/http";
import { check, sleep } from "k6";

const apiBaseUrl = (__ENV.EDGELAB_API_BASE_URL || "http://127.0.0.1:8080/api").replace(/\/$/, "");
const authToken = (__ENV.EDGELAB_AUTH_TOKEN || "").trim();
const vus = Number(__ENV.K6_VUS || 20);
const duration = __ENV.K6_DURATION || "30s";
const sessionId = (__ENV.EDGELAB_SESSION_ID || "").trim();

if (!authToken) {
  throw new Error("EDGELAB_AUTH_TOKEN is required for metrics summary benchmark");
}

export const options = {
  scenarios: {
    metrics_summary: {
      executor: "constant-vus",
      vus,
      duration,
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<100", "p(99)<250"],
  },
};

export default function () {
  const query = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
  const response = http.get(`${apiBaseUrl}/metrics/summary${query}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    tags: {
      endpoint: "metrics_summary",
    },
  });

  check(response, {
    "metrics summary status is 200": (res) => res.status === 200,
    "metrics summary has totals": (res) => {
      if (res.status !== 200) {
        return false;
      }
      const payload = JSON.parse(res.body);
      return typeof payload.total_trades === "number";
    },
  });

  sleep(1);
}
