export type WatchdogEventKind =
  | "recover"
  | "scan"
  | "railway_deploy"
  | "railway_stalled"
  /** Completed / stopped → deploy pipeline (reboot, new deployment after kill). */
  | "railway_rebooting"
  /** Watchdog called serviceInstanceDeploy(latest) after CRASHED/FAILED/REMOVED. */
  | "railway_auto_recover"
  /** Public HTTP heartbeat failed repeatedly while Railway deployment still SUCCESS/SLEEPING. */
  | "heartbeat_recover"
  /** Transition to no active deployment, STOPPED, or user stop — was running, now not. */
  | "railway_stopped";

export type WatchdogEvent = {
  id: string;
  at: string;
  service: string;
  kind: WatchdogEventKind;
  message: string;
};

/** Recent outbound Railway GraphQL / HTTP heartbeat calls (newest last). */
export type WatchdogApiActivityEntry = {
  at: string;
  kind: "graphql" | "http";
  target: string;
  method?: string;
  durationMs?: number;
  status?: number | string;
  detail?: string;
};

export type WatchdogPayload = {
  source: "docker" | "railway" | "unconfigured" | "error";
  intervalSec: number;
  lastTickAt: string | null;
  instancesMonitored: number;
  events: WatchdogEvent[];
  /** Recent lines: compose-watchdog HTTP `/status` (Docker) or in-memory poll log (Railway), newest last. */
  logTail?: string[];
  error?: string;
  /** Hosted: HTTP probes to each service public URL (see service-heartbeat.ts). */
  heartbeat?: {
    enabled: boolean;
    probes: number;
    ok: number;
    failed: number;
    skipped: number;
  };
  /** Recent GraphQL / HTTP calls from this tick loop (ring buffer). */
  apiActivity?: WatchdogApiActivityEntry[];
};
