import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.1.0/index.js";

// Custom metrics
const errorRate = new Rate("errors");
const shortenDuration = new Trend("shorten_duration");
const listDuration = new Trend("list_duration");
const redirectDuration = new Trend("redirect_duration");

// Silver tier: ramp to 200 concurrent users, response times must stay under 3s
export const options = {
  stages: [
    { duration: "15s", target: 50 },   // warm-up
    { duration: "15s", target: 100 },   // build up
    { duration: "30s", target: 200 },   // full silver load
    { duration: "30s", target: 200 },   // sustain 200 VUs
    { duration: "15s", target: 0 },     // ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<3000"],  // Silver requirement: <3s p95
    errors: ["rate<0.05"],              // <5% error rate
  },
};

const BASE_URL = "http://localhost:8080";

export default function () {
  // 1. Health check
  const healthRes = http.get(`${BASE_URL}/health`);
  check(healthRes, { "health ok": (r) => r.status === 200 });
  errorRate.add(healthRes.status !== 200);

  // 2. Create a short URL
  const payload = JSON.stringify({
    original_url: `https://example.com/silver/${__VU}-${__ITER}`,
    user_id: 1,
    title: `Silver test ${__VU}-${__ITER}`,
  });

  const shortenRes = http.post(`${BASE_URL}/shorten`, payload, {
    headers: { "Content-Type": "application/json" },
  });
  shortenDuration.add(shortenRes.timings.duration);
  check(shortenRes, { "shorten ok": (r) => r.status === 201 });
  errorRate.add(shortenRes.status !== 201);

  // 3. List URLs (tests cache hit path on repeated calls)
  const listRes = http.get(`${BASE_URL}/urls?page=1&per_page=10`);
  listDuration.add(listRes.timings.duration);
  check(listRes, { "list ok": (r) => r.status === 200 });
  errorRate.add(listRes.status !== 200);

  // 4. Redirect (tests Redis-cached redirect path)
  if (shortenRes.status === 201) {
    const body = JSON.parse(shortenRes.body);
    const redirectRes = http.get(`${BASE_URL}/${body.short_code}`, {
      redirects: 0,
    });
    redirectDuration.add(redirectRes.timings.duration);
    check(redirectRes, { "redirect ok": (r) => r.status === 302 });
    errorRate.add(redirectRes.status !== 302);
  }

  sleep(0.5); // shorter pause — higher throughput per VU
}

export function handleSummary(data) {
  const payload = JSON.stringify(Object.assign({}, data, { tier: "silver" }));
  http.post(`${BASE_URL}/test-results`, payload, {
    headers: { "Content-Type": "application/json" },
  });

  return {
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}
