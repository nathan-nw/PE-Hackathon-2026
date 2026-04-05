import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const errorRate = new Rate("errors");
// Counter: one sample per failed check — k6_runner parses this reliably (Rate JSON can be aggregate snapshots).
const errorChecks = new Counter("load_test_error_checks");

function recordError(isError) {
  errorRate.add(isError);
  if (isError) {
    errorChecks.add(1);
  }
}
const shortenDuration = new Trend("shorten_duration");
const listDuration = new Trend("list_duration");
const redirectDuration = new Trend("redirect_duration");

const BASE_URL =
  __ENV.K6_TARGET_URL || __ENV.LOAD_TEST_TARGET_URL || "http://load-balancer:80";
const VUS = parseInt(__ENV.K6_VUS || "50", 10);
const DURATION = __ENV.K6_DURATION || "30s";
const PRESET = __ENV.K6_PRESET || "";

// NGINX edge limit bypass (must match load-balancer LOAD_TEST_BYPASS_TOKEN).
const BYPASS = __ENV.LOAD_TEST_BYPASS_TOKEN || "";
const edgeHeaders = (extra = {}) =>
  BYPASS ? { ...extra, "X-Load-Test-Bypass": BYPASS } : extra;
const jsonPostHeaders = edgeHeaders({ "Content-Type": "application/json" });

// Preset stage configs
const PRESETS = {
  bronze: {
    stages: [
      { duration: "10s", target: 25 },
      { duration: "20s", target: 50 },
      { duration: "30s", target: 50 },
      { duration: "10s", target: 0 },
    ],
    thresholds: {
      http_req_duration: ["p(95)<5000"],
      errors: ["rate<0.50"],
    },
  },
  silver: {
    stages: [
      { duration: "15s", target: 50 },
      { duration: "15s", target: 100 },
      { duration: "30s", target: 200 },
      { duration: "30s", target: 200 },
      { duration: "15s", target: 0 },
    ],
    thresholds: {
      http_req_duration: ["p(95)<3000"],
      errors: ["rate<0.05"],
    },
  },
  gold: {
    stages: [
      { duration: "15s", target: 100 },
      { duration: "20s", target: 250 },
      { duration: "20s", target: 500 },
      { duration: "40s", target: 500 },
      { duration: "15s", target: 0 },
    ],
    thresholds: {
      http_req_duration: ["p(95)<5000"],
      errors: ["rate<0.05"],
    },
  },
  chaos: {
    stages: [
      { duration: "10s", target: 30 },
      { duration: "20s", target: 100 },
      { duration: "30s", target: 100 },
      { duration: "10s", target: 0 },
    ],
    thresholds: {
      http_req_duration: ["p(95)<10000"],
      errors: ["rate<1.00"],
    },
  },
};

// Use preset if specified, otherwise build from env vars
const preset = PRESETS[PRESET];
export const options = preset
  ? preset
  : {
      stages: [
        { duration: "5s", target: Math.ceil(VUS / 2) },
        { duration: DURATION, target: VUS },
        { duration: "5s", target: 0 },
      ],
      thresholds: {
        http_req_duration: ["p(95)<5000"],
        errors: ["rate<0.50"],
      },
    };

export default function () {
  const isChaos = PRESET === "chaos";

  // 1. Health check
  const healthRes = http.get(`${BASE_URL}/health`, { headers: edgeHeaders() });
  check(healthRes, { "health ok": (r) => r.status === 200 });
  recordError(healthRes.status !== 200);

  // Chaos: hit non-existent endpoints (~40% of iterations)
  if (isChaos && Math.random() < 0.4) {
    const badRes = http.get(`${BASE_URL}/nonexistent-${__VU}-${__ITER}`, { headers: edgeHeaders() });
    recordError(badRes.status >= 400);
    sleep(0.3);
    return;
  }

  // Chaos: send malformed JSON (~20% of iterations)
  if (isChaos && Math.random() < 0.3) {
    const badPost = http.post(`${BASE_URL}/shorten`, "not json", jsonPostHeaders);
    shortenDuration.add(badPost.timings.duration);
    recordError(badPost.status >= 400);
    sleep(0.3);
    return;
  }

  // 2. Create a short URL
  const payload = JSON.stringify({
    original_url: `https://example.com/test/${__VU}-${__ITER}`,
    user_id: 1,
    title: `Load test ${__VU}-${__ITER}`,
  });

  const shortenRes = http.post(`${BASE_URL}/shorten`, payload, { headers: jsonPostHeaders });
  shortenDuration.add(shortenRes.timings.duration);
  check(shortenRes, { "shorten ok": (r) => r.status === 201 });
  recordError(shortenRes.status !== 201);

  // 3. List URLs
  const listRes = http.get(`${BASE_URL}/urls?page=1&per_page=10`, { headers: edgeHeaders() });
  listDuration.add(listRes.timings.duration);
  check(listRes, { "list ok": (r) => r.status === 200 });
  recordError(listRes.status !== 200);

  // 4. Redirect
  if (shortenRes.status === 201) {
    const body = JSON.parse(shortenRes.body);
    const redirectRes = http.get(`${BASE_URL}/${body.short_code}`, {
      redirects: 0,
      headers: edgeHeaders(),
    });
    redirectDuration.add(redirectRes.timings.duration);
    check(redirectRes, { "redirect ok": (r) => r.status === 302 });
    recordError(redirectRes.status !== 302);
  }

  sleep(0.5);
}
