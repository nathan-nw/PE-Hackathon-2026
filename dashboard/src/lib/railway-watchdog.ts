/**
 * Railway “watchdog” view: poll deployment status and emit events when services
 * recover from CRASHED/FAILED or enter redeploy. Uses in-memory state on the
 * dashboard Node instance when not proxying to `WATCHDOG_SERVICE_URL`.
 */

import {
  createEmptyWatchdogState,
  runRailwayWatchdogTick,
  type WatchdogPersistentState,
} from "./watchdog-core/railway-watchdog-tick";

import type { WatchdogPayload } from "@/lib/watchdog-types";

const G = globalThis as typeof globalThis & {
  __railwayWatchdogState?: WatchdogPersistentState;
};

function getOrCreateWatchdogState(): WatchdogPersistentState {
  if (!G.__railwayWatchdogState) {
    G.__railwayWatchdogState = createEmptyWatchdogState();
  }
  return G.__railwayWatchdogState;
}

export async function fetchRailwayWatchdogPayload(): Promise<WatchdogPayload> {
  return runRailwayWatchdogTick(getOrCreateWatchdogState());
}
