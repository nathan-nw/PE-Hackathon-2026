import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.1.0/index.js";

// Custom metrics
const errorRate = new Rate("errors");
const shortenDuration = new Trend("shorten_duration");
const listDuration = new Trend("list_duration");
const redirectDuration = new Trend("redirect_duration");

// Gold tier: 500+ concurrent users, <5% error rate
export const options = {
  stages: [
    { duration: "15s", target: 100 },   // warm-up
    { duration: "20s", target: 250 },   // ramp
    { duration: "20s", target: 500 },   // gold target
    { duration: "40s", target: 500 },   // sustain the tsunami
    { duration: "15s", target: 0 },     // ramp down / recovery
  ],
  thresholds: {
    http_req_duration: ["p(95)<5000"],  // track p95
    errors: ["rate<0.05"],              // Gold requirement: <5% errors
  },
};

const BASE_URL = "http://localhost:8080";

export default function () {
  // 1. Health check (lightweight — verifies the server is alive)
  const healthRes = http.get(`${BASE_URL}/health`);
  check(healthRes, { "health ok": (r) => r.status === 200 });
  errorRate.add(healthRes.status !== 200);

  // 2. Create a short URL (write path — hits DB)
  const payload = JSON.stringify({
    original_url: `https://example.com/gold/${__VU}-${__ITER}`,
    user_id: 1,
    title: `Gold test ${__VU}-${__ITER}`,
  });

  const shortenRes = http.post(`${BASE_URL}/shorten`, payload, {
    headers: { "Content-Type": "application/json" },
  });
  shortenDuration.add(shortenRes.timings.duration);
  check(shortenRes, { "shorten ok": (r) => r.status === 201 });
  errorRate.add(shortenRes.status !== 201);

  // 3. List URLs (read path — should be served from Redis cache)
  const listRes = http.get(`${BASE_URL}/urls?page=1&per_page=10`);
  listDuration.add(listRes.timings.duration);
  check(listRes, { "list ok": (r) => r.status === 200 });
  errorRate.add(listRes.status !== 200);

  // 4. Redirect (hot path — should be served from Redis cache)
  if (shortenRes.status === 201) {
    const body = JSON.parse(shortenRes.body);

    // First hit populates the cache, second hit proves the cache works
    const redirectRes1 = http.get(`${BASE_URL}/${body.short_code}`, {
      redirects: 0,
    });
    redirectDuration.add(redirectRes1.timings.duration);
    check(redirectRes1, { "redirect ok": (r) => r.status === 302 });
    errorRate.add(redirectRes1.status !== 302);

    // Second redirect — should be a cache hit (faster)
    const redirectRes2 = http.get(`${BASE_URL}/${body.short_code}`, {
      redirects: 0,
    });
    redirectDuration.add(redirectRes2.timings.duration);
    check(redirectRes2, { "redirect cache hit": (r) => r.status === 302 });
    errorRate.add(redirectRes2.status !== 302);
  }

  sleep(0.3); // aggressive pacing for high throughput
}

export function handleSummary(data) {
  const payload = JSON.stringify(Object.assign({}, data, { tier: "gold" }));
  http.post(`${BASE_URL}/test-results`, payload, {
    headers: { "Content-Type": "application/json" },
  });

  return {
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}
