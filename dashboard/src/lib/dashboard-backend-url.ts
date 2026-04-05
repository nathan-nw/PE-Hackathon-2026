/**
 * FastAPI dashboard-backend (Kafka log cache). Compose should set
 * DASHBOARD_BACKEND_URL (e.g. http://dashboard-backend:8000). Local `next dev`
 * uses http://127.0.0.1:8000 when unset.
 */
export function dashboardBackendBase(): string {
  const u = process.env.DASHBOARD_BACKEND_URL?.trim();
  if (u) return u.replace(/\/$/, "");
  return "http://127.0.0.1:8000";
}
