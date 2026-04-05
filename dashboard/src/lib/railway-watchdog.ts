/**
 * Railway “watchdog” view: poll deployment status and emit events when services
 * recover from CRASHED/FAILED or enter redeploy. Uses in-memory state on the
 * dashboard Node instance (best-effort across cold starts).
 */

import {
  fetchRailwayVisibilityRows,
  railwayServiceInstanceDeployLatest,
} from "@/lib/railway-visibility";
import { runtimeEnv } from "@/lib/server-runtime-env";

import type { WatchdogEvent, WatchdogPayload } from "@/lib/watchdog-types";

/** Match compose-watchdog `LOG_TAIL_MAX` for parity. */
const LOG_TAIL_MAX = 40;

/** Min time between auto-redeploy attempts per service (avoids hammering the API). */
const RECOVER_COOLDOWN_MS = 50_000;

const G = globalThis as typeof globalThis & {
  __railwayWatchdogPrev?: Map<
    string,
    { deploymentStatus: string; deploymentId: string }
  >;
  __railwayWatchdogLogTail?: string[];
  __railwayRecoverCooldown?: Map<string, number>;
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

function needsAutoRecoverTrigger(status: string): boolean {
  const u = status.toUpperCase();
  return (
    u === "CRASHED" ||
    u === "FAILED" ||
    u === "REMOVED" ||
    u === "STOPPED"
  );
}

function railwayWatchdogAutoRecoverEnabled(): boolean {
  const raw = (runtimeEnv("RAILWAY_WATCHDOG_AUTO_RECOVER") ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") {
    return false;
  }
  return true;
}

function recoverCooldownMap(): Map<string, number> {
  if (!G.__railwayRecoverCooldown) {
    G.__railwayRecoverCooldown = new Map();
  }
  return G.__railwayRecoverCooldown;
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
  const recoverCooldown = recoverCooldownMap();
  const events: WatchdogEvent[] = [];
  const now = new Date().toISOString();
  const environmentId = runtimeEnv("RAILWAY_ENVIRONMENT_ID") ?? "";
  const autoRecover = railwayWatchdogAutoRecoverEnabled() && Boolean(environmentId);

  for (const row of rows.containers) {
    const sid = row.railwayServiceId;
    const name = row.service || row.name;
    const depId = row.railwayDeploymentId ?? "";
    const cur = (row.deploymentStatus ?? "UNKNOWN").trim();
    const before = prev.get(sid);

    if (isHealthy(cur)) {
      recoverCooldown.delete(sid);
    }

    if (
      autoRecover
      && needsAutoRecoverTrigger(cur)
      && !isDeploying(cur)
    ) {
      const last = recoverCooldown.get(sid) ?? 0;
      if (Date.now() - last >= RECOVER_COOLDOWN_MS) {
        try {
          await railwayServiceInstanceDeployLatest(environmentId, sid);
          recoverCooldown.set(sid, Date.now());
          events.push({
            id: `${sid}-autorecover-${Date.now()}`,
            at: now,
            service: name,
            kind: "railway_auto_recover",
            message: `Watchdog triggered serviceInstanceDeploy(latest) for ${name} (was ${cur}).`,
          });
          pushRailwayLogLine(
            `watchdog: auto-redeploy ${name} (${cur}) → serviceInstanceDeploy`
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          pushRailwayLogLine(`watchdog: auto-redeploy failed ${name}: ${msg}`);
        }
      }
    }

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
