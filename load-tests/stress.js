import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

// Custom metrics
const errorRate = new Rate("errors");
const shortenDuration = new Trend("shorten_duration");
const listDuration = new Trend("list_duration");
const redirectDuration = new Trend("redirect_duration");

// Stress test: ramp from 50 → 100 → 200 → 300 → 400 → 500 VUs
export const options = {
  stages: [
    { duration: "30s", target: 50 },   // warm-up
    { duration: "30s", target: 100 },   // moderate
    { duration: "30s", target: 200 },   // heavy
    { duration: "30s", target: 300 },   // stress
    { duration: "30s", target: 400 },   // breaking?
    { duration: "30s", target: 500 },   // breaking point
    { duration: "30s", target: 0 },     // ramp-down / recovery
  ],
  thresholds: {
    http_req_duration: ["p(95)<5000"],
    errors: ["rate<0.5"],
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
    original_url: `https://example.com/page/${__VU}-${__ITER}`,
    user_id: 1,
    title: `Load test ${__VU}-${__ITER}`,
  });

  const shortenRes = http.post(`${BASE_URL}/shorten`, payload, {
    headers: { "Content-Type": "application/json" },
  });
  shortenDuration.add(shortenRes.timings.duration);
  check(shortenRes, { "shorten ok": (r) => r.status === 201 });
  errorRate.add(shortenRes.status !== 201);

  // 3. List URLs
  const listRes = http.get(`${BASE_URL}/urls?page=1&per_page=10`);
  listDuration.add(listRes.timings.duration);
  check(listRes, { "list ok": (r) => r.status === 200 });
  errorRate.add(listRes.status !== 200);

  // 4. Redirect (if we got a short_code back)
  if (shortenRes.status === 201) {
    const body = JSON.parse(shortenRes.body);
    const redirectRes = http.get(`${BASE_URL}/${body.short_code}`, {
      redirects: 0,
    });
    redirectDuration.add(redirectRes.timings.duration);
    check(redirectRes, { "redirect ok": (r) => r.status === 302 });
    errorRate.add(redirectRes.status !== 302);
  }

  sleep(1);
}
