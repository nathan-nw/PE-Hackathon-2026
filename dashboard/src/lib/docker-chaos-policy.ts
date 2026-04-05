/**
 * Chaos / resilience testing: which Compose services may receive `docker kill`
 * from the Ops UI. Disabled unless CHAOS_KILL_ENABLED=1.
 */

import { runtimeEnv } from "@/lib/server-runtime-env";

/** Never kill these — would disconnect Ops UI or stop the Railway watchdog worker. */
const BLOCKED_SERVICES = new Set(["dashboard", "railway-watchdog"]);

/** When CHAOS_ALLOWED_SERVICES is unset, only these Compose services may be killed. */
const DEFAULT_ALLOWED_SERVICES = new Set([
  "db",
  "postgres",
  "redis",
  "zookeeper",
  "kafka",
  "kafka-log-consumer",
  "url-shortener-a",
  "url-shortener-b",
  "load-balancer",
  "db-backup",
  "dashboard-db",
  "dashboard-backend",
  "user-frontend",
]);

export function chaosKillEnabled(): boolean {
  const raw = (runtimeEnv("CHAOS_KILL_ENABLED") ?? "").trim();
  if (!raw) {
    // Local `next dev`: no env needed. Production image (`next start`) stays off until set explicitly or via Compose.
    return process.env.NODE_ENV === "development";
  }
  const v = raw.toLowerCase();
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function parseAllowedServicesOverride(): Set<string> | null {
  const raw = (runtimeEnv("CHAOS_ALLOWED_SERVICES") || "").trim();
  if (!raw) return null;
  const set = new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
  return set.size > 0 ? set : null;
}

export function isServiceKillAllowed(service: string): boolean {
  const s = service.trim().toLowerCase();
  if (!s) return false;
  if (BLOCKED_SERVICES.has(s)) return false;
  const override = parseAllowedServicesOverride();
  if (override) return override.has(s);
  return DEFAULT_ALLOWED_SERVICES.has(s);
}

export function blockedServicesList(): string[] {
  return [...BLOCKED_SERVICES];
}

/** For GET /chaos/config — which services show an enabled Kill button. */
export function listAllowedServicesForUi(): string[] {
  const o = parseAllowedServicesOverride();
  if (o) return [...o].sort();
  return [...DEFAULT_ALLOWED_SERVICES].sort();
}
