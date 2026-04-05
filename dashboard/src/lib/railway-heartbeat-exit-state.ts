/**
 * Shared in-process state for Railway HTTP exit lifecycle (Ops / Chaos tables).
 * Must be a singleton so `/api/visibility/docker` and `/chaos/status` stay aligned.
 */

import {
  createHeartbeatExitLifecycleState,
  type HeartbeatExitLifecycleState,
} from "@/lib/watchdog-core/heartbeat-lifecycle";

const G = globalThis as typeof globalThis & {
  __railwayHeartbeatExitLifecycle?: HeartbeatExitLifecycleState;
};

export function getRailwayHeartbeatExitLifecycleState(): HeartbeatExitLifecycleState {
  if (!G.__railwayHeartbeatExitLifecycle) {
    G.__railwayHeartbeatExitLifecycle = createHeartbeatExitLifecycleState();
  }
  return G.__railwayHeartbeatExitLifecycle;
}
