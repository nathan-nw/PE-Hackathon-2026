/**
 * Railway “watchdog” view: poll deployment status and emit events when services
 * recover from CRASHED/FAILED or enter redeploy. Uses in-memory state on the
 * dashboard Node instance (best-effort across cold starts).
 */

import {
  fetchRailwayVisibilityRows,
  railwayServiceInstanceDeployLatest,
  type RailwayOnlineStatus,
} from "@/lib/railway-visibility";
import { runtimeEnv } from "@/lib/server-runtime-env";
import {
  buildHeartbeatProbeUrl,
  pingHeartbeatUrl,
} from "@/lib/service-heartbeat";

import type { WatchdogEvent, WatchdogPayload } from "@/lib/watchdog-types";

/** Match compose-watchdog `LOG_TAIL_MAX` for parity. */
const LOG_TAIL_MAX = 40;

/** Min time between auto-redeploy attempts per service (avoids hammering the API). */
const RECOVER_COOLDOWN_MS = 50_000;

/** Consecutive failed HTTP heartbeats while deployment is SUCCESS/SLEEPING before redeploy. */
function heartbeatMissThreshold(): number {
  const n = parseInt(runtimeEnv("RAILWAY_HEARTBEAT_MISS_THRESHOLD") ?? "2", 10);
  return Number.isFinite(n) && n >= 1 ? n : 2;
}

/** Max heartbeat-triggered redeploys per Railway deployment id epoch (default 1). */
function heartbeatMaxRecoverPerEpoch(): number {
  const n = parseInt(runtimeEnv("RAILWAY_HEARTBEAT_MAX_RECOVER") ?? "1", 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

/** Min wall-clock time between heartbeat-triggered redeploys for the same service (stops restart storms). */
function heartbeatRecoverCooldownMs(): number {
  const n = parseInt(
    runtimeEnv("RAILWAY_HEARTBEAT_RECOVER_COOLDOWN_MS") ?? "3600000",
    10
  );
  return Number.isFinite(n) && n >= 0 ? n : 3_600_000;
}

type HeartbeatRecoverState = {
  /** Epoch key: only when this changes do we reset recoveries / budget. */
  deploymentId: string;
  deploymentStatus: string;
  consecutiveMisses: number;
  recoveriesUsed: number;
  loggedBudgetExhausted: boolean;
  /** One-shot log while waiting for heartbeat redeploy cooldown. */
  loggedCooldownWait?: boolean;
};

const G = globalThis as typeof globalThis & {
  __railwayWatchdogPrev?: Map<
    string,
    {
      deploymentStatus: string;
      deploymentId: string;
      onlineStatus: RailwayOnlineStatus;
    }
  >;
  __railwayWatchdogLogTail?: string[];
  __railwayRecoverCooldown?: Map<string, number>;
  /** Per Railway service: miss streak + redeploy budget; epoch resets only when deployment id changes. */
  __railwayHeartbeatRecoverState?: Map<string, HeartbeatRecoverState>;
  /** Last successful heartbeat-triggered redeploy per service (wall-clock cooldown). */
  __railwayHeartbeatLastRecoverAt?: Map<string, number>;
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
  {
    deploymentStatus: string;
    deploymentId: string;
    onlineStatus: RailwayOnlineStatus;
  }
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

function wasCompletedLike(online: RailwayOnlineStatus): boolean {
  return (
    online === "completed" ||
    online === "failed" ||
    online === "unknown" ||
    online === "skipped"
  );
}

/**
 * Only involuntary failure states — not REMOVED/STOPPED (those follow Chaos Kill /
 * deploymentStop or a user stop; auto-redeploy would undo an intentional shutdown).
 */
function needsAutoRecoverTrigger(status: string): boolean {
  const u = status.toUpperCase();
  return u === "CRASHED" || u === "FAILED";
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

function railwayHeartbeatEnabled(): boolean {
  const raw = (runtimeEnv("RAILWAY_HEARTBEAT_ENABLED") ?? "").trim().toLowerCase();
  if (!raw) return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") {
    return false;
  }
  return true;
}

/**
 * Opt-in only. HTTP probes are noisy (cold start, edge, TLS, wrong path) and are not a substitute
 * for Railway’s own CRASHED/FAILED signals — auto-redeploy from heartbeat caused restart loops for many users.
 */
function railwayHeartbeatRecoverEnabled(): boolean {
  const raw = (runtimeEnv("RAILWAY_HEARTBEAT_RECOVER") ?? "").trim().toLowerCase();
  if (!raw) return false;
  return (
    raw === "1" || raw === "true" || raw === "yes" || raw === "on"
  );
}

function heartbeatRecoverStateMap(): Map<string, HeartbeatRecoverState> {
  if (!G.__railwayHeartbeatRecoverState) {
    G.__railwayHeartbeatRecoverState = new Map();
  }
  return G.__railwayHeartbeatRecoverState;
}

function heartbeatLastRecoverMap(): Map<string, number> {
  if (!G.__railwayHeartbeatLastRecoverAt) {
    G.__railwayHeartbeatLastRecoverAt = new Map();
  }
  return G.__railwayHeartbeatLastRecoverAt;
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
  const hbStateMap = heartbeatRecoverStateMap();
  const hbLastRecover = heartbeatLastRecoverMap();
  const hbThreshold = heartbeatMissThreshold();
  const hbMaxRecover = heartbeatMaxRecoverPerEpoch();
  const hbCooldownMs = heartbeatRecoverCooldownMs();
  let hbProbes = 0;
  let hbOk = 0;
  let hbFail = 0;
  let hbSkipped = 0;

  for (const row of rows.containers) {
    const sid = row.railwayServiceId;
    const name = row.service || row.name;
    const depId = row.railwayDeploymentId ?? "";
    const cur = (row.deploymentStatus ?? "UNKNOWN").trim();
    const onlineNow = row.railwayOnlineStatus;
    const before = prev.get(sid);

    // Epoch resets only when Railway deployment *id* changes — not status (SUCCESS↔DEPLOYING flicker
    // was resetting budgets and causing redeploy loops).
    let hbSt = hbStateMap.get(sid);
    if (!hbSt || hbSt.deploymentId !== depId) {
      hbSt = {
        deploymentId: depId,
        deploymentStatus: cur,
        consecutiveMisses: 0,
        recoveriesUsed: 0,
        loggedBudgetExhausted: false,
        loggedCooldownWait: false,
      };
    } else {
      hbSt.deploymentStatus = cur;
      if (hbSt.loggedCooldownWait === undefined) hbSt.loggedCooldownWait = false;
    }

    const probeUrl = buildHeartbeatProbeUrl(row.railwayPublicUrl, row.service);
    if (railwayHeartbeatEnabled() && probeUrl) {
      hbProbes++;
      const pr = await pingHeartbeatUrl(probeUrl);
      if (pr.ok) {
        hbOk++;
        hbSt.consecutiveMisses = 0;
        hbSt.loggedCooldownWait = false;
      } else {
        hbFail++;
        if (
          railwayHeartbeatRecoverEnabled() &&
          autoRecover &&
          isHealthy(cur) &&
          !isDeploying(cur)
        ) {
          hbSt.consecutiveMisses += 1;
          const canRecover =
            hbMaxRecover > 0 && hbSt.recoveriesUsed < hbMaxRecover;
          const lastHbRecover = hbLastRecover.get(sid) ?? 0;
          const cooldownOk =
            hbCooldownMs === 0 ||
            Date.now() - lastHbRecover >= hbCooldownMs;
          if (
            hbSt.consecutiveMisses >= hbThreshold &&
            canRecover &&
            cooldownOk
          ) {
            try {
              await railwayServiceInstanceDeployLatest(environmentId, sid);
              hbSt.recoveriesUsed += 1;
              hbSt.consecutiveMisses = 0;
              hbSt.loggedBudgetExhausted = false;
              hbSt.loggedCooldownWait = false;
              hbLastRecover.set(sid, Date.now());
              events.push({
                id: `${sid}-heartbeat-${Date.now()}`,
                at: now,
                service: name,
                kind: "heartbeat_recover",
                message: `HTTP heartbeat failed ${hbThreshold}+ time(s) for ${name} (deployment ${cur}); serviceInstanceDeploy(latest) (${hbSt.recoveriesUsed}/${hbMaxRecover} this deployment id). Next allowed after ${Math.round(hbCooldownMs / 60000)}m cooldown.`,
              });
              pushRailwayLogLine(
                `watchdog: heartbeat redeploy ${name} (epoch ${hbSt.recoveriesUsed}/${hbMaxRecover}) → serviceInstanceDeploy; cooldown ${hbCooldownMs}ms`
              );
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              pushRailwayLogLine(
                `watchdog: heartbeat redeploy failed ${name}: ${msg}`
              );
            }
          } else if (
            hbSt.consecutiveMisses >= hbThreshold &&
            canRecover &&
            !cooldownOk &&
            !(hbSt.loggedCooldownWait ?? false)
          ) {
            hbSt.loggedCooldownWait = true;
            pushRailwayLogLine(
              `watchdog: heartbeat recover waiting on cooldown (${Math.round((hbCooldownMs - (Date.now() - lastHbRecover)) / 1000)}s left, ${Math.round(hbCooldownMs / 60000)}m total); RAILWAY_HEARTBEAT_RECOVER_COOLDOWN_MS`
            );
          } else if (
            hbSt.consecutiveMisses >= hbThreshold &&
            !canRecover &&
            !hbSt.loggedBudgetExhausted
          ) {
            hbSt.loggedBudgetExhausted = true;
            pushRailwayLogLine(
              `watchdog: heartbeat recover paused for ${name} — max ${hbMaxRecover} redeploy(s) for deployment id ${depId || "?"}; resets when Railway assigns a new deployment.`
            );
          }
        } else if (!isHealthy(cur)) {
          hbSt.consecutiveMisses = 0;
        }
      }
      hbStateMap.set(sid, hbSt);
    } else if (railwayHeartbeatEnabled()) {
      hbSkipped++;
      hbStateMap.delete(sid);
    }

    if (isHealthy(cur)) {
      recoverCooldown.delete(sid);
    }

    if (
      autoRecover
      && needsAutoRecoverTrigger(cur)
      && !isDeploying(cur)
    ) {
      const lastAttempt = recoverCooldown.get(sid);
      if (
        lastAttempt != null
        && Date.now() - lastAttempt < RECOVER_COOLDOWN_MS
      ) {
        /* skip — cooldown after last serviceInstanceDeploy */
      } else {
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
      const prevOnline = before.onlineStatus;

      let emittedLifecycle = false;
      if (wasCompletedLike(prevOnline) && onlineNow === "deploying") {
        events.push({
          id: `${sid}-rebooting-${now}`,
          at: now,
          service: name,
          kind: "railway_rebooting",
          message: `Watchdog: ${name} left Completed/stopped and is Deploying (reboot / new deployment). Status: ${cur}.`,
        });
        pushRailwayLogLine(
          `watchdog: ${name} ${prevOnline} → deploying (${cur})`
        );
        emittedLifecycle = true;
      } else if (prevOnline === "online" && onlineNow === "deploying") {
        events.push({
          id: `${sid}-redeploy-${now}`,
          at: now,
          service: name,
          kind: "railway_deploy",
          message: `Watchdog: ${name} is Deploying while previously Online (${cur}) — rolling out a new revision.`,
        });
        emittedLifecycle = true;
      }

      if (isBad(b) && (isDeploying(c) || isHealthy(c))) {
        events.push({
          id: `${sid}-recover-${now}-${c}`,
          at: now,
          service: name,
          kind: "recover",
          message: `Watchdog identified a stalled or crashed deployment (${before.deploymentStatus}) and Railway is recovering ${name} (now ${cur}).`,
        });
      } else if (
        !emittedLifecycle
        && before.deploymentId !== depId
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

    prev.set(sid, {
      deploymentStatus: cur,
      deploymentId: depId,
      onlineStatus: onlineNow,
    });
  }

  // Drop services that disappeared from project (rare)
  const ids = new Set(rows.containers.map((r) => r.railwayServiceId));
  for (const k of [...prev.keys()]) {
    if (!ids.has(k)) prev.delete(k);
  }
  for (const k of [...hbStateMap.keys()]) {
    if (!ids.has(k)) hbStateMap.delete(k);
  }
  for (const k of [...hbLastRecover.keys()]) {
    if (!ids.has(k)) hbLastRecover.delete(k);
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
    heartbeat: railwayHeartbeatEnabled()
      ? {
          enabled: true,
          probes: hbProbes,
          ok: hbOk,
          failed: hbFail,
          skipped: hbSkipped,
        }
      : {
          enabled: false,
          probes: 0,
          ok: 0,
          failed: 0,
          skipped: 0,
        },
    ...(logTail.length > 0 ? { logTail } : {}),
  };
}
