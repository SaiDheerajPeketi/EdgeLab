import http from "k6/http";
import { check, sleep } from "k6";

const apiBaseUrl = (__ENV.EDGELAB_API_BASE_URL || "http://127.0.0.1:8080/api").replace(/\/$/, "");
const authToken = (__ENV.EDGELAB_AUTH_TOKEN || "").trim();
const vus = Number(__ENV.K6_VUS || 20);
const duration = __ENV.K6_DURATION || "30s";
const limit = Number(__ENV.EDGELAB_SUMMARIES_LIMIT || 50);

if (!authToken) {
  throw new Error("EDGELAB_AUTH_TOKEN is required for session summaries cursor benchmark");
}

export const options = {
  scenarios: {
    session_summaries_cursor: {
      executor: "constant-vus",
      vus,
      duration,
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<90", "p(99)<220"],
  },
};

export default function () {
  const headers = {
    Authorization: `Bearer ${authToken}`,
  };
  const first = http.get(`${apiBaseUrl}/backtests/summaries?limit=${limit}`, {
    headers,
    tags: {
      endpoint: "backtests_summaries_cursor_first",
    },
  });

  check(first, {
    "summaries first page status is 200": (res) => res.status === 200,
  });

  if (first.status === 200) {
    const payload = JSON.parse(first.body);
    if (payload.next_cursor) {
      const second = http.get(
        `${apiBaseUrl}/backtests/summaries?limit=${limit}&cursor=${encodeURIComponent(payload.next_cursor)}`,
        {
          headers,
          tags: {
            endpoint: "backtests_summaries_cursor_second",
          },
        },
      );
      check(second, {
        "summaries cursor page status is 200": (res) => res.status === 200,
        "summaries cursor payload has items": (res) => {
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
