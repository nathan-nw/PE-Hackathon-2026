import { runtimeEnv } from "@/lib/server-runtime-env";

/**
 * FastAPI dashboard-backend (Kafka log cache). Compose should set
 * `DASHBOARD_BACKEND_URL` (e.g. `http://dashboard-backend:8000`).
 *
 * On **Railway**, use the **private** URL from `setup-railway.js` (`SYNC_VARIABLES=1`), e.g.
 * `http://dashboard-backend.railway.internal:8080`. The sync script sets **PORT=8080** on
 * `dashboard-backend` so `${{dashboard-backend.PORT}}` resolves for the Next.js **dashboard**.
 *
 * Values are read via `runtimeEnv()` (`/proc/self/environ` on Linux) so runtime vars
 * are not lost to Next build-time `process.env` inlining.
 * Local `next dev` uses `http://127.0.0.1:8000` when unset.
 */
export function dashboardBackendBase(): string {
  const r = resolveDashboardBackendBase();
  if (r.ok) return r.base;
  return "http://127.0.0.1:8000";
}

/** True when `DASHBOARD_BACKEND_URL` is set in the process environment (after fuzzy key match). */
export function isDashboardBackendUrlConfigured(): boolean {
  return Boolean(runtimeEnv("DASHBOARD_BACKEND_URL")?.trim());
}

export type DashboardBackendBaseResult =
  | { ok: true; base: string; usedDefaultLocalhost: boolean }
  | { ok: false; error: string };

/**
 * Validates `DASHBOARD_BACKEND_URL` when set (catches empty Railway template / typos).
 */
export function resolveDashboardBackendBase(): DashboardBackendBaseResult {
  const raw = runtimeEnv("DASHBOARD_BACKEND_URL")?.trim();
  if (!raw) {
    return { ok: true, base: "http://127.0.0.1:8000", usedDefaultLocalhost: true };
  }
  const u = raw.replace(/\/$/, "");
  try {
    const parsed = new URL(u);
    if (!parsed.hostname) {
      return {
        ok: false,
        error:
          "DASHBOARD_BACKEND_URL has no hostname (Railway variable reference may be empty — use private URL: http://${{dashboard-backend.RAILWAY_PRIVATE_DOMAIN}}:${{dashboard-backend.PORT}} or fix the service name).",
      };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, error: "DASHBOARD_BACKEND_URL must start with http:// or https://" };
    }
    return { ok: true, base: u, usedDefaultLocalhost: false };
  } catch {
    return {
      ok: false,
      error: `DASHBOARD_BACKEND_URL is not a valid absolute URL (first 120 chars): ${u.slice(0, 120)}`,
    };
  }
}
