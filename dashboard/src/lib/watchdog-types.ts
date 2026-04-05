export type WatchdogEventKind =
  | "recover"
  | "scan"
  | "railway_deploy"
  | "railway_stalled";

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
