/**
 * Railway “watchdog” view: poll deployment status and emit events when services
 * recover from CRASHED/FAILED or enter redeploy. Uses in-memory state on the
 * dashboard Node instance (best-effort across cold starts).
 */

import { fetchRailwayVisibilityRows } from "@/lib/railway-visibility";
import { runtimeEnv } from "@/lib/server-runtime-env";

import type { WatchdogEvent, WatchdogPayload } from "@/lib/watchdog-types";

/** Match compose-watchdog `LOG_TAIL_MAX` for parity. */
const LOG_TAIL_MAX = 40;

const G = globalThis as typeof globalThis & {
  __railwayWatchdogPrev?: Map<
    string,
    { deploymentStatus: string; deploymentId: string }
  >;
  __railwayWatchdogLogTail?: string[];
};

function pushRailwayLogLine(line: string) {
  if (!G.__railwayWatchdogLogTail) {
    G.__railwayWatchdogLogTail = [];
  }
  const a = G.__railwayWatchdogLogTail;
  a.push(line);
  if (a.length > LOG_TAIL_MAX) {
    G.__railwayWatchdogLogTail = a.slice(-LOG_TAIL_MAX);
  }
}

function prevMap(): Map<
  string,
  { deploymentStatus: string; deploymentId: string }
> {
  if (!G.__railwayWatchdogPrev) {
    G.__railwayWatchdogPrev = new Map();
  }
  return G.__railwayWatchdogPrev;
}

function isBad(s: string): boolean {
  const u = s.toUpperCase();
  return u === "CRASHED" || u === "FAILED";
}

function isDeploying(s: string): boolean {
  const u = s.toUpperCase();
  return (
    u === "BUILDING" ||
    u === "DEPLOYING" ||
    u === "INITIALIZING" ||
    u === "QUEUED" ||
    u === "WAITING"
  );
}

function isHealthy(s: string): boolean {
  const u = s.toUpperCase();
  return u === "SUCCESS" || u === "SLEEPING";
}

export async function fetchRailwayWatchdogPayload(): Promise<WatchdogPayload> {
  const intervalSec = Math.max(
    5,
    parseInt(runtimeEnv("RAILWAY_WATCHDOG_POLL_SEC") ?? "15", 10) || 15
  );

  const rows = await fetchRailwayVisibilityRows({ includeStats: false });
  if (rows.error) {
    const stale = G.__railwayWatchdogLogTail;
    return {
      source: "railway",
      intervalSec,
      lastTickAt: null,
      instancesMonitored: 0,
      events: [],
      error: rows.error,
      ...(stale && stale.length > 0 ? { logTail: [...stale] } : {}),
    };
  }

  const prev = prevMap();
  const events: WatchdogEvent[] = [];
  const now = new Date().toISOString();

  for (const row of rows.containers) {
    const sid = row.railwayServiceId;
    const name = row.service || row.name;
    const depId = row.railwayDeploymentId ?? "";
    const cur = (row.deploymentStatus ?? "UNKNOWN").trim();
    const before = prev.get(sid);

    if (before) {
      const b = before.deploymentStatus.toUpperCase();
      const c = cur.toUpperCase();

      if (isBad(b) && (isDeploying(c) || isHealthy(c))) {
        events.push({
          id: `${sid}-recover-${now}-${c}`,
          at: now,
          service: name,
          kind: "recover",
          message: `Watchdog identified a stalled or crashed deployment (${before.deploymentStatus}) and Railway is recovering ${name} (now ${cur}).`,
        });
      } else if (isHealthy(b) && isDeploying(c)) {
        events.push({
          id: `${sid}-redeploy-${now}`,
          at: now,
          service: name,
          kind: "railway_deploy",
          message: `Watchdog detected a redeploy on ${name} (${cur}); Railway is updating the instance.`,
        });
      } else if (
        before.deploymentId !== depId
        && depId
        && !isBad(b)
        && (isDeploying(c) || isHealthy(c))
      ) {
        events.push({
          id: `${sid}-dep-${depId}-${now}`,
          at: now,
          service: name,
          kind: "railway_deploy",
          message: `New deployment for ${name}; Railway is rolling out a new revision.`,
        });
      }
    }

    prev.set(sid, { deploymentStatus: cur, deploymentId: depId });
  }

  // Drop services that disappeared from project (rare)
  const ids = new Set(rows.containers.map((r) => r.railwayServiceId));
  for (const k of [...prev.keys()]) {
    if (!ids.has(k)) prev.delete(k);
  }

  const eventsOut = events.slice(0, 30);
  pushRailwayLogLine(
    `[${now}] poll · ${rows.containers.length} service(s) · ${eventsOut.length} new event(s)`
  );
  for (const ev of eventsOut) {
    pushRailwayLogLine(`  ${ev.message}`);
  }

  const bad = rows.containers.filter((r) =>
    isBad((r.deploymentStatus ?? "").trim())
  );
  if (bad.length > 0) {
    pushRailwayLogLine(
      `  status: ${bad
        .map((r) => `${r.service || r.name}=${r.deploymentStatus ?? "?"}`)
        .join(", ")}`
    );
  }

  const logTail = G.__railwayWatchdogLogTail
    ? [...G.__railwayWatchdogLogTail]
    : [];

  return {
    source: "railway",
    intervalSec,
    lastTickAt: now,
    instancesMonitored: rows.containers.length,
    events: eventsOut,
    ...(logTail.length > 0 ? { logTail } : {}),
  };
}
