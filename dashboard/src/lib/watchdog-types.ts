export type WatchdogEventKind =
  | "recover"
  | "scan"
  | "railway_deploy"
  | "railway_stalled"
  /** Completed / stopped → deploy pipeline (reboot, new deployment after kill). */
  | "railway_rebooting"
  /** Watchdog called serviceInstanceDeploy(latest) after CRASHED/FAILED/REMOVED. */
  | "railway_auto_recover";

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
};
