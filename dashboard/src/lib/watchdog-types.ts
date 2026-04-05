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
  | "heartbeat_recover";

export type WatchdogEvent = {
  id: string;
  at: string;
  service: string;
  kind: WatchdogEventKind;
  message: string;
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
};
