/**
 * After a successful Chaos kill (Docker or Railway), record + Discord-notify immediately.
 * Compose-watchdog often misses `exited` when restart policy brings the container back before the next tick.
 */

import { resolveDashboardBackendBase } from "@/lib/dashboard-backend-url";
import { notifyDiscordChaosKillEmbeds } from "@/lib/watchdog-core/watchdog-discord";
import type { WatchdogEvent } from "@/lib/watchdog-core/watchdog-types";
import { runtimeEnv } from "@/lib/server-runtime-env";

const UA = "PE-Hackathon-ChaosNotify/1.0";

function ingestToken(): string {
  return (
    (runtimeEnv("WATCHDOG_ALERTS_INGEST_TOKEN") || "").trim() ||
    (runtimeEnv("LOG_INGEST_TOKEN") || "").trim()
  );
}

function allowInsecureIngest(): boolean {
  const v = (runtimeEnv("ALLOW_INSECURE_LOG_INGEST") || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

async function postWatchdogIngest(events: WatchdogEvent[]): Promise<void> {
  if (!events.length) return;
  const resolved = resolveDashboardBackendBase();
  if (!resolved.ok) {
    console.warn("[chaos-watchdog-notify] ingest skipped: no dashboard backend URL");
    return;
  }
  const token = ingestToken();
  if (!token && !allowInsecureIngest()) {
    console.warn(
      "[chaos-watchdog-notify] ingest skipped: set LOG_INGEST_TOKEN or WATCHDOG_ALERTS_INGEST_TOKEN on dashboard (or ALLOW_INSECURE_LOG_INGEST=1 local only)"
    );
    return;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": UA,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers["X-Watchdog-Alerts-Token"] = token;
  }

  try {
    const res = await fetch(`${resolved.base}/api/watchdog-alerts/ingest`, {
      method: "POST",
      headers,
      body: JSON.stringify({ source: "chaos", events }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.warn(
        `[chaos-watchdog-notify] ingest HTTP ${res.status}${t ? `: ${t.slice(0, 200)}` : ""}`
      );
    }
  } catch (e) {
    console.warn(
      `[chaos-watchdog-notify] ingest failed: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

function buildEvent(
  kind: "compose_chaos_kill" | "railway_chaos_kill",
  service: string,
  message: string
): WatchdogEvent {
  return {
    id: `${kind}-${service}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    at: new Date().toISOString(),
    service,
    kind,
    message,
  };
}

/**
 * Fire-and-forget: DB row + red Discord embed (same webhook vars as watchdog).
 */
export function recordChaosKillAlert(opts: {
  kind: "compose_chaos_kill" | "railway_chaos_kill";
  service: string;
  message: string;
}): void {
  const ev = buildEvent(opts.kind, opts.service, opts.message);
  void Promise.all([
    postWatchdogIngest([ev]),
    notifyDiscordChaosKillEmbeds([ev]),
  ]);
}
