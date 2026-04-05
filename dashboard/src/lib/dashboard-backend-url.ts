import { runtimeEnv } from "@/lib/server-runtime-env";

/**
 * FastAPI dashboard-backend (Kafka log cache). Compose should set
 * `DASHBOARD_BACKEND_URL` (e.g. `http://dashboard-backend:8000`).
 *
 * On Railway, use the **dashboard-backend** public URL (or private URL). We resolve
 * via `runtimeEnv()` (reads `/proc/self/environ` on Linux) so values are not lost to
 * Next build-time `process.env` inlining — same pattern as `RAILWAY_*` tokens.
 * Local `next dev` uses `http://127.0.0.1:8000` when unset.
 */
export function dashboardBackendBase(): string {
  const u = runtimeEnv("DASHBOARD_BACKEND_URL")?.trim();
  if (u) return u.replace(/\/$/, "");
  return "http://127.0.0.1:8000";
}

/** True when `DASHBOARD_BACKEND_URL` is set in the process environment (after fuzzy key match). */
export function isDashboardBackendUrlConfigured(): boolean {
  return Boolean(runtimeEnv("DASHBOARD_BACKEND_URL")?.trim());
}
