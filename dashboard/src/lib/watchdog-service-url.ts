/**
 * Dedicated Railway watchdog worker URL. When set, dashboard proxies `/api/.../watchdog` instead of
 * running `runRailwayWatchdogTick` in-process.
 */
export function watchdogServiceBaseUrl(): string | null {
  const u = (
    process.env.WATCHDOG_SERVICE_URL?.trim() ||
    process.env.RAILWAY_WATCHDOG_SERVICE_URL?.trim()
  );
  if (!u) return null;
  return u.replace(/\/+$/, "");
}
