import http from "k6/http";
import { check, sleep } from "k6";

const apiBaseUrl = (__ENV.EDGELAB_API_BASE_URL || "http://127.0.0.1:8080/api").replace(/\/$/, "");
const authToken = (__ENV.EDGELAB_AUTH_TOKEN || "").trim();
const vus = Number(__ENV.K6_VUS || 20);
const duration = __ENV.K6_DURATION || "30s";
const sessionId = (__ENV.EDGELAB_SESSION_ID || "").trim();

if (!authToken) {
  throw new Error("EDGELAB_AUTH_TOKEN is required for market-data meta benchmark");
}

export const options = {
  scenarios: {
    market_data_meta: {
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
  const response = http.get(`${apiBaseUrl}/market-data/meta${query}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    tags: {
      endpoint: "market_data_meta",
    },
  });

  check(response, {
    "market-data meta status is 200": (res) => res.status === 200,
    "market-data meta has rows": (res) => {
      if (res.status !== 200) {
        return false;
      }
      const payload = JSON.parse(res.body);
      return typeof payload.rows === "number";
    },
  });

  sleep(1);
}
