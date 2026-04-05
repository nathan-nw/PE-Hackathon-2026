/**
 * Single tick of the Railway watchdog: poll visibility, heartbeats, auto-recover.
 * State is owned by the caller (worker process or dashboard globals) — no module-level maps.
 */

import {
  fetchRailwayVisibilityRows,
  railwayServiceInstanceDeployLatest,
  type RailwayOnlineStatus,
  type RailwayVisibilityRow,
} from "./railway-visibility";
import { runtimeEnv } from "./server-runtime-env";
import {
  buildHeartbeatProbeUrl,
  pingHeartbeatUrl,
  shouldUsePrivateRailwayHeartbeat,
  type HeartbeatPingResult,
} from "./service-heartbeat";

import type {
  WatchdogApiActivityEntry,
  WatchdogEvent,
  WatchdogPayload,
} from "./watchdog-types";
import {
  clearExitLifecycleForService,
  clearExitLifecycleRedeemFlag,
  createHeartbeatExitLifecycleState,
  effectiveRailwayOnlineStatusAfterProbe,
  peekExitLifecycleRedeem,
  railwayHeartbeatExitRedeployEnabled,
  requeueExitLifecycleRedeem,
  type HeartbeatExitLifecycleState,
} from "./heartbeat-lifecycle";

/** Match compose-watchdog `LOG_TAIL_MAX` for parity. */
const LOG_TAIL_MAX = 40;

/** Max recent API / HTTP activity lines in payload. */
const API_ACTIVITY_MAX = 48;

/** Min time between auto-redeploy attempts per service (avoids hammering the API). */
const RECOVER_COOLDOWN_MS = 50_000;

export type WatchdogPrevEntry = {
  deploymentStatus: string;
  deploymentId: string;
  onlineStatus: RailwayOnlineStatus;
};

export type HeartbeatRecoverState = {
  deploymentId: string;
  deploymentStatus: string;
  consecutiveMisses: number;
  recoveriesUsed: number;
  loggedBudgetExhausted: boolean;
  loggedCooldownWait?: boolean;
};

/** Injectable persistent state for `runRailwayWatchdogTick` (one instance per worker / dashboard process). */
export type WatchdogPersistentState = {
  prev: Map<string, WatchdogPrevEntry>;
  logTail: string[];
  recoverCooldown: Map<string, number>;
  heartbeatRecoverState: Map<string, HeartbeatRecoverState>;
  heartbeatLastRecoverAt: Map<string, number>;
  apiActivity: WatchdogApiActivityEntry[];
  /** Consecutive liveness failures → exited lifecycle + next-tick redeploy (hosted). */
  heartbeatExitLifecycle: HeartbeatExitLifecycleState;
};

export function createEmptyWatchdogState(): WatchdogPersistentState {
  return {
    prev: new Map(),
    logTail: [],
    recoverCooldown: new Map(),
    heartbeatRecoverState: new Map(),
    heartbeatLastRecoverAt: new Map(),
    apiActivity: [],
    heartbeatExitLifecycle: createHeartbeatExitLifecycleState(),
  };
}

function pushLogLine(state: WatchdogPersistentState, line: string) {
  const a = state.logTail;
  a.push(line);
  if (a.length > LOG_TAIL_MAX) {
    state.logTail = a.slice(-LOG_TAIL_MAX);
  }
}

function pushActivity(
  state: WatchdogPersistentState,
  entry: Omit<WatchdogApiActivityEntry, "at"> & { at?: string }
) {
  const at = entry.at ?? new Date().toISOString();
  const full: WatchdogApiActivityEntry = {
    at,
    kind: entry.kind,
    target: entry.target,
    ...(entry.method !== undefined ? { method: entry.method } : {}),
    ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
    ...(entry.status !== undefined ? { status: entry.status } : {}),
    ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
  };
  state.apiActivity.push(full);
  if (state.apiActivity.length > API_ACTIVITY_MAX) {
    state.apiActivity = state.apiActivity.slice(-API_ACTIVITY_MAX);
  }
}

function heartbeatMissThreshold(): number {
  const n = parseInt(runtimeEnv("RAILWAY_HEARTBEAT_MISS_THRESHOLD") ?? "2", 10);
  return Number.isFinite(n) && n >= 1 ? n : 2;
}

function heartbeatMaxRecoverPerEpoch(): number {
  const n = parseInt(runtimeEnv("RAILWAY_HEARTBEAT_MAX_RECOVER") ?? "1", 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

function heartbeatRecoverCooldownMs(): number {
  const n = parseInt(
    runtimeEnv("RAILWAY_HEARTBEAT_RECOVER_COOLDOWN_MS") ?? "3600000",
    10
  );
  return Number.isFinite(n) && n >= 0 ? n : 3_600_000;
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

/** Involuntary failure states — not REMOVED/STOPPED (intentional shutdown). */
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

function railwayHeartbeatRecoverEnabled(): boolean {
  const raw = (runtimeEnv("RAILWAY_HEARTBEAT_RECOVER") ?? "").trim().toLowerCase();
  if (!raw) return false;
  return (
    raw === "1" || raw === "true" || raw === "yes" || raw === "on"
  );
}

/** Previous tick looked like an active healthy deployment. */
function wasActivelyDeployed(before: WatchdogPrevEntry): boolean {
  const d = before.deploymentId?.trim();
  if (!d) return false;
  return isHealthy(before.deploymentStatus) || isDeploying(before.deploymentStatus);
}

/** Current row indicates stopped, removed, or no active deployment. */
function isNowStoppedOrNoDeployment(
  depId: string,
  cur: string,
  row: RailwayVisibilityRow
): boolean {
  if (!depId.trim()) return true;
  const u = cur.toUpperCase();
  if (["STOPPED", "REMOVED", "CANCELED", "CANCELLED"].includes(u)) return true;
  if ((row.status ?? "").toLowerCase().includes("no active deployment")) {
    return true;
  }
  return false;
}

export function railwayWatchdogIntervalSec(): number {
  return Math.max(
    5,
    parseInt(runtimeEnv("RAILWAY_WATCHDOG_POLL_SEC") ?? "15", 10) || 15
  );
}

export async function runRailwayWatchdogTick(
  state: WatchdogPersistentState
): Promise<WatchdogPayload> {
  const intervalSec = railwayWatchdogIntervalSec();

  const gqlT0 = performance.now();
  const rows = await fetchRailwayVisibilityRows({ includeStats: false });
  const gqlMs = Math.round(performance.now() - gqlT0);
  pushActivity(state, {
    kind: "graphql",
    target: "Railway GraphQL (fetchRailwayVisibilityRows)",
    method: "POST",
    durationMs: gqlMs,
    status: rows.error ? "error" : 200,
    ...(rows.error ? { detail: rows.error } : {}),
  });

  if (rows.error) {
    return {
      source: "railway",
      intervalSec,
      lastTickAt: null,
      instancesMonitored: 0,
      events: [],
      error: rows.error,
      ...(state.logTail.length > 0 ? { logTail: [...state.logTail] } : {}),
      apiActivity: [...state.apiActivity],
    };
  }

  const prev = state.prev;
  const recoverCooldown = state.recoverCooldown;
  const events: WatchdogEvent[] = [];
  const now = new Date().toISOString();
  const environmentId = runtimeEnv("RAILWAY_ENVIRONMENT_ID") ?? "";
  const autoRecover = railwayWatchdogAutoRecoverEnabled() && Boolean(environmentId);
  const hbStateMap = state.heartbeatRecoverState;
  const hbLastRecover = state.heartbeatLastRecoverAt;
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

    if (
      railwayHeartbeatEnabled()
      && railwayHeartbeatExitRedeployEnabled()
      && autoRecover
      && environmentId
      && peekExitLifecycleRedeem(state.heartbeatExitLifecycle, sid)
      && isHealthy(cur)
      && !isDeploying(cur)
      && depId
    ) {
      clearExitLifecycleRedeemFlag(state.heartbeatExitLifecycle, sid);
      try {
        const depT0 = performance.now();
        await railwayServiceInstanceDeployLatest(environmentId, sid);
        const depMs = Math.round(performance.now() - depT0);
        pushActivity(state, {
          kind: "graphql",
          target: `serviceInstanceDeploy exit-redeploy (${name})`,
          method: "POST",
          durationMs: depMs,
          status: 200,
        });
        clearExitLifecycleForService(state.heartbeatExitLifecycle, sid);
        events.push({
          id: `${sid}-exit-redeploy-${Date.now()}`,
          at: now,
          service: name,
          kind: "heartbeat_exit_redeploy",
          message: `Lifecycle was exited (liveness failed); serviceInstanceDeploy(latest) for ${name}.`,
        });
        pushLogLine(
          state,
          `watchdog: exit-lifecycle redeploy ${name} → serviceInstanceDeploy`
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        requeueExitLifecycleRedeem(state.heartbeatExitLifecycle, sid);
        pushLogLine(
          state,
          `watchdog: exit-lifecycle redeploy failed ${name}: ${msg}`
        );
      }
    }

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
      const hbT0 = performance.now();
      const pr = await pingHeartbeatUrl(probeUrl);
      const hbMs = Math.round(performance.now() - hbT0);
      pushActivity(state, {
        kind: "http",
        target: probeUrl,
        method: "GET",
        durationMs: hbMs,
        status: pr.statusCode ?? (pr.ok ? 200 : "fail"),
        ...(pr.error ? { detail: pr.error } : {}),
      });
      if (pr.ok) {
        hbOk++;
        hbSt.consecutiveMisses = 0;
        hbSt.loggedCooldownWait = false;
      } else {
        hbFail++;
        if (
          !railwayHeartbeatExitRedeployEnabled()
          && railwayHeartbeatRecoverEnabled()
          && autoRecover
          && isHealthy(cur)
          && !isDeploying(cur)
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
              const depT0 = performance.now();
              await railwayServiceInstanceDeployLatest(environmentId, sid);
              const depMs = Math.round(performance.now() - depT0);
              pushActivity(state, {
                kind: "graphql",
                target: `serviceInstanceDeploy(${name})`,
                method: "POST",
                durationMs: depMs,
                status: 200,
              });
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
              pushLogLine(
                state,
                `watchdog: heartbeat redeploy ${name} (epoch ${hbSt.recoveriesUsed}/${hbMaxRecover}) → serviceInstanceDeploy; cooldown ${hbCooldownMs}ms`
              );
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              pushLogLine(
                state,
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
            pushLogLine(
              state,
              `watchdog: heartbeat recover waiting on cooldown (${Math.round((hbCooldownMs - (Date.now() - lastHbRecover)) / 1000)}s left, ${Math.round(hbCooldownMs / 60000)}m total); RAILWAY_HEARTBEAT_RECOVER_COOLDOWN_MS`
            );
          } else if (
            hbSt.consecutiveMisses >= hbThreshold &&
            !canRecover &&
            !hbSt.loggedBudgetExhausted
          ) {
            hbSt.loggedBudgetExhausted = true;
            pushLogLine(
              state,
              `watchdog: heartbeat recover paused for ${name} — max ${hbMaxRecover} redeploy(s) for deployment id ${depId || "?"}; resets when Railway assigns a new deployment.`
            );
          }
        } else if (!isHealthy(cur)) {
          hbSt.consecutiveMisses = 0;
        }
      }
      const hbSynth: HeartbeatPingResult = {
        railwayServiceId: sid,
        service: name,
        probeUrl,
        skipped: false,
        ok: pr.ok,
        latencyMs: pr.latencyMs,
        ...(pr.statusCode !== undefined ? { statusCode: pr.statusCode } : {}),
        ...(pr.error ? { error: pr.error } : {}),
      };
      effectiveRailwayOnlineStatusAfterProbe(
        state.heartbeatExitLifecycle,
        sid,
        depId,
        onlineNow,
        hbSynth,
        { scheduleRedeem: true }
      );
      hbStateMap.set(sid, hbSt);
    } else if (railwayHeartbeatEnabled()) {
      hbSkipped++;
      hbStateMap.delete(sid);
      if (!probeUrl && row.railwayPublicUrl) {
        pushActivity(state, {
          kind: "http",
          target: `heartbeat skipped (${name})`,
          detail: "no probe path for service",
        });
      } else if (
        !probeUrl &&
        !row.railwayPublicUrl?.trim() &&
        !shouldUsePrivateRailwayHeartbeat()
      ) {
        pushActivity(state, {
          kind: "http",
          target: `heartbeat skipped (${name})`,
          detail: "no public URL",
        });
      }
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
          const depT0 = performance.now();
          await railwayServiceInstanceDeployLatest(environmentId, sid);
          const depMs = Math.round(performance.now() - depT0);
          pushActivity(state, {
            kind: "graphql",
            target: `serviceInstanceDeploy auto-recover (${name})`,
            method: "POST",
            durationMs: depMs,
            status: 200,
          });
          recoverCooldown.set(sid, Date.now());
          events.push({
            id: `${sid}-autorecover-${Date.now()}`,
            at: now,
            service: name,
            kind: "railway_auto_recover",
            message: `Watchdog triggered serviceInstanceDeploy(latest) for ${name} (was ${cur}).`,
          });
          pushLogLine(
            state,
            `watchdog: auto-redeploy ${name} (${cur}) → serviceInstanceDeploy`
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          pushLogLine(state, `watchdog: auto-redeploy failed ${name}: ${msg}`);
        }
      }
    }

    if (before) {
      const b = before.deploymentStatus.toUpperCase();
      const c = cur.toUpperCase();
      const prevOnline = before.onlineStatus;

      if (wasActivelyDeployed(before) && isNowStoppedOrNoDeployment(depId, cur, row)) {
        events.push({
          id: `${sid}-stopped-${Date.now()}`,
          at: now,
          service: name,
          kind: "railway_stopped",
          message: `Deployment stopped or removed; no active deployment for ${name} (was ${before.deploymentStatus}, now ${cur || "none"}).`,
        });
        pushLogLine(
          state,
          `watchdog: ${name} railway_stopped (${before.deploymentStatus} → ${cur || "no deployment"})`
        );
      }

      let emittedLifecycle = false;
      if (wasCompletedLike(prevOnline) && onlineNow === "deploying") {
        events.push({
          id: `${sid}-rebooting-${now}`,
          at: now,
          service: name,
          kind: "railway_rebooting",
          message: `Watchdog: ${name} left Completed/stopped and is Deploying (reboot / new deployment). Status: ${cur}.`,
        });
        pushLogLine(
          state,
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
  pushLogLine(
    state,
    `[${now}] poll · ${rows.containers.length} service(s) · ${eventsOut.length} new event(s)`
  );
  for (const ev of eventsOut) {
    pushLogLine(state, `  ${ev.message}`);
  }

  const bad = rows.containers.filter((r) =>
    isBad((r.deploymentStatus ?? "").trim())
  );
  if (bad.length > 0) {
    pushLogLine(
      state,
      `  status: ${bad
        .map((r) => `${r.service || r.name}=${r.deploymentStatus ?? "?"}`)
        .join(", ")}`
    );
  }

  const logTail = state.logTail.length > 0 ? [...state.logTail] : undefined;

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
    ...(logTail ? { logTail } : {}),
    apiActivity: [...state.apiActivity],
  };
}
