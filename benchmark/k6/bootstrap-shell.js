import http from "k6/http";
import { check, sleep } from "k6";

const apiBaseUrl = (__ENV.EDGELAB_API_BASE_URL || "http://127.0.0.1:8080/api").replace(/\/$/, "");
const authToken = (__ENV.EDGELAB_AUTH_TOKEN || "").trim();
const vus = Number(__ENV.K6_VUS || 20);
const duration = __ENV.K6_DURATION || "30s";
const limit = Number(__ENV.EDGELAB_BOOTSTRAP_LIMIT || 25);

if (!authToken) {
  throw new Error("EDGELAB_AUTH_TOKEN is required for bootstrap-shell benchmark");
}

export const options = {
  scenarios: {
    bootstrap_shell: {
      executor: "constant-vus",
      vus,
      duration,
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<80", "p(99)<200"],
  },
};

export default function () {
  const response = http.get(`${apiBaseUrl}/bootstrap-shell?limit=${limit}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    tags: {
      endpoint: "bootstrap_shell",
    },
  });

  check(response, {
    "bootstrap-shell status is 200": (res) => res.status === 200,
    "bootstrap-shell has sessions list": (res) => {
      if (res.status !== 200) {
        return false;
      }
      const payload = JSON.parse(res.body);
      return Array.isArray(payload.recent_sessions);
    },
  });

  sleep(1);
}
