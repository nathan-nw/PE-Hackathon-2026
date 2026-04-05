/**
 * When HTTP liveness probes fail repeatedly while Railway still reports SUCCESS/"online",
 * we surface lifecycle as `exited` (same idea as Docker `state: exited` for a wedged process).
 * The watchdog schedules `serviceInstanceDeploy` on the **next** tick after `exited` first appears.
 */

import type { HeartbeatPingResult } from "./service-heartbeat";
import type { RailwayOnlineStatus } from "./railway-visibility";
import { runtimeEnv } from "./server-runtime-env";

/** Failures before lifecycle flips from online → exited (matches Chaos/Ops expectation). */
export function heartbeatExitFailureThreshold(): number {
  const n = parseInt(runtimeEnv("RAILWAY_HEARTBEAT_EXIT_THRESHOLD") ?? "2", 10);
  return Number.isFinite(n) && n >= 1 ? n : 2;
}

/** When true (default), redeploy the tick after lifecycle becomes `exited`. Set to 0 to disable. */
export function railwayHeartbeatExitRedeployEnabled(): boolean {
  const raw = (runtimeEnv("RAILWAY_HEARTBEAT_EXIT_REDEPLOY") ?? "1").trim().toLowerCase();
  if (!raw || raw === "1" || raw === "true" || raw === "yes" || raw === "on") {
    return true;
  }
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") {
    return false;
  }
  return true;
}

export type HeartbeatExitLifecycleState = {
  consecutiveFails: Map<string, number>;
  lastDeploymentId: Map<string, string>;
  /** True after we first showed `exited` for this deployment; cleared on recovery or new deployment. */
  lifecycleExited: Map<string, boolean>;
  /** Redeem `serviceInstanceDeploy` at the start of the next watchdog tick (worker only). */
  redeemOnNextTick: Map<string, boolean>;
};

export function createHeartbeatExitLifecycleState(): HeartbeatExitLifecycleState {
  return {
    consecutiveFails: new Map(),
    lastDeploymentId: new Map(),
    lifecycleExited: new Map(),
    redeemOnNextTick: new Map(),
  };
}

export function syncHeartbeatExitDeploymentId(
  state: HeartbeatExitLifecycleState,
  serviceId: string,
  deploymentId: string
): void {
  const prev = state.lastDeploymentId.get(serviceId);
  if (prev !== deploymentId) {
    state.lastDeploymentId.set(serviceId, deploymentId);
    state.consecutiveFails.delete(serviceId);
    state.lifecycleExited.delete(serviceId);
    state.redeemOnNextTick.delete(serviceId);
  }
}

/**
 * Update counters after a probe result; returns effective lifecycle for the Ops table.
 * Only when GraphQL says `online` can we downgrade to `exited`.
 */
export function effectiveRailwayOnlineStatusAfterProbe(
  state: HeartbeatExitLifecycleState,
  serviceId: string,
  deploymentId: string,
  baseOnlineStatus: RailwayOnlineStatus,
  heartbeat: HeartbeatPingResult | undefined,
  options?: { scheduleRedeem?: boolean }
): RailwayOnlineStatus {
  syncHeartbeatExitDeploymentId(state, serviceId, deploymentId);

  if (baseOnlineStatus !== "online") {
    state.consecutiveFails.delete(serviceId);
    state.lifecycleExited.delete(serviceId);
    return baseOnlineStatus;
  }

  if (!heartbeat || heartbeat.skipped || heartbeat.ok === null) {
    return baseOnlineStatus;
  }

  if (heartbeat.ok) {
    state.consecutiveFails.set(serviceId, 0);
    state.lifecycleExited.delete(serviceId);
    state.redeemOnNextTick.delete(serviceId);
    return "online";
  }

  const th = heartbeatExitFailureThreshold();
  const n = (state.consecutiveFails.get(serviceId) ?? 0) + 1;
  state.consecutiveFails.set(serviceId, n);

  if (n >= th) {
    const firstExit = !state.lifecycleExited.get(serviceId);
    state.lifecycleExited.set(serviceId, true);
    if (
      firstExit &&
      railwayHeartbeatExitRedeployEnabled() &&
      options?.scheduleRedeem === true
    ) {
      state.redeemOnNextTick.set(serviceId, true);
    }
    return "exited";
  }

  return "online";
}

/** Watchdog: true when the previous tick scheduled a redeploy after lifecycle became exited. */
export function peekExitLifecycleRedeem(
  state: HeartbeatExitLifecycleState,
  serviceId: string
): boolean {
  return state.redeemOnNextTick.get(serviceId) === true;
}

export function clearExitLifecycleRedeemFlag(
  state: HeartbeatExitLifecycleState,
  serviceId: string
): void {
  state.redeemOnNextTick.delete(serviceId);
}

/** After a successful exit-driven redeploy, reset lifecycle for the service. */
export function clearExitLifecycleForService(
  state: HeartbeatExitLifecycleState,
  serviceId: string
): void {
  state.consecutiveFails.delete(serviceId);
  state.lifecycleExited.delete(serviceId);
  state.redeemOnNextTick.delete(serviceId);
}

/** If exit redeploy failed, try again on the next tick. */
export function requeueExitLifecycleRedeem(
  state: HeartbeatExitLifecycleState,
  serviceId: string
): void {
  state.redeemOnNextTick.set(serviceId, true);
}
