/**
 * Optional Discord webhook notifications for Railway watchdog events.
 *
 * Sends only from the dedicated **railway-watchdog** worker by default (`RAILWAY_WATCHDOG_WORKER=1`),
 * so the Next.js dashboard polling `runRailwayWatchdogTick` in-process does not spam Discord.
 * Set `WATCHDOG_DISCORD_ALWAYS=1` to enable from the dashboard server (local dev).
 *
 * Uses WATCHDOG_DISCORD_WEBHOOK_URL if set, else DISCORD_WEBHOOK_URL (same as dashboard-backend alerts).
 *
 * Webhook messages use the same **username** and **avatar_url** as the Happy ops agent (`happy-branding.ts`).
 * Override with `WATCHDOG_DISCORD_USERNAME` / `WATCHDOG_DISCORD_AVATAR_URL` (or `HAPPY_AGENT_*`).
 */

import { HAPPY_AGENT_AVATAR_URL, HAPPY_AGENT_NAME } from "../happy-branding";
import { runtimeEnv } from "../server-runtime-env";
import type { WatchdogEvent, WatchdogEventKind } from "./watchdog-types";

const UA = "PE-Hackathon-Watchdog/1.0";

function happyWebhookIdentity(): { username: string; avatar_url: string } {
  const username = (
    runtimeEnv("WATCHDOG_DISCORD_USERNAME") ||
    runtimeEnv("HAPPY_AGENT_DISCORD_USERNAME") ||
    HAPPY_AGENT_NAME
  ).trim();
  const avatar_url = (
    runtimeEnv("WATCHDOG_DISCORD_AVATAR_URL") ||
    runtimeEnv("HAPPY_AGENT_AVATAR_URL") ||
    HAPPY_AGENT_AVATAR_URL
  ).trim();
  return { username, avatar_url };
}

function discordNotifyAllowed(): boolean {
  if ((runtimeEnv("WATCHDOG_DISCORD_NOTIFY") || "").trim() === "0") {
    return false;
  }
  if ((runtimeEnv("WATCHDOG_DISCORD_ALWAYS") || "").trim() === "1") {
    return true;
  }
  return (runtimeEnv("RAILWAY_WATCHDOG_WORKER") || "").trim() === "1";
}

/** Discord embed colors (decimal). Red = exited/stopped, yellow = deploy/recovery in progress, green = healthy online. */
const EMBED_RED = 15548997; // #ED4245
const EMBED_YELLOW = 16705372; // #FEE75C
const EMBED_GREEN = 5763719; // #57F287

/** Stopped, removed, CRASHED/FAILED, or no active deployment (see `isDeploymentDownOrFailed` in railway-watchdog-tick). */
const FAILURE_KINDS = new Set<WatchdogEventKind>([
  "railway_stopped",
  "compose_chaos_kill",
  "railway_chaos_kill",
]);

/** Deploying, redeploy, or recovery in flight (process / rollout). */
const IN_PROGRESS_KINDS = new Set<WatchdogEventKind>([
  "recover",
  "railway_rebooting",
  "railway_deploy",
  "railway_auto_recover",
  "heartbeat_recover",
  "heartbeat_exit_redeploy",
]);

/** Previously not online; now online with a healthy deployment. */
const ONLINE_KINDS = new Set<WatchdogEventKind>(["railway_online"]);

function webhookUrl(): string {
  return (
    (runtimeEnv("WATCHDOG_DISCORD_WEBHOOK_URL") || "").trim() ||
    (runtimeEnv("DISCORD_WEBHOOK_URL") || "").trim()
  );
}

let lastPostMs = 0;
const MIN_MS_BETWEEN_POSTS = 900;

async function postDiscord(embeds: Record<string, unknown>[]): Promise<void> {
  const url = webhookUrl();
  if (!url || embeds.length === 0) return;

  const now = Date.now();
  if (now - lastPostMs < MIN_MS_BETWEEN_POSTS) {
    await new Promise((r) => setTimeout(r, MIN_MS_BETWEEN_POSTS - (now - lastPostMs)));
  }
  lastPostMs = Date.now();

  const batches: Record<string, unknown>[][] = [];
  for (let i = 0; i < embeds.length; i += 10) {
    batches.push(embeds.slice(i, i + 10));
  }

  const identity = happyWebhookIdentity();
  for (const batch of batches) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": UA,
      },
      body: JSON.stringify({
        username: identity.username,
        avatar_url: identity.avatar_url,
        embeds: batch,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.warn(
        `[watchdog-discord] webhook HTTP ${res.status}${t ? `: ${t.slice(0, 200)}` : ""}`
      );
    }
  }
}

/**
 * Fire-and-forget Discord notifications for new watchdog events from a single tick.
 */
export async function notifyDiscordForWatchdogEvents(
  events: WatchdogEvent[]
): Promise<void> {
  if (!discordNotifyAllowed() || !webhookUrl() || events.length === 0) return;

  const failure = events.filter((e) => FAILURE_KINDS.has(e.kind));
  const inProgress = events.filter((e) => IN_PROGRESS_KINDS.has(e.kind));
  const onlineOk = events.filter((e) => ONLINE_KINDS.has(e.kind));
  if (failure.length === 0 && inProgress.length === 0 && onlineOk.length === 0) return;

  const embeds: Record<string, unknown>[] = [];

  if (failure.length > 0) {
    embeds.push({
      title: "Heads up — deployment down (stopped, crashed, or removed)",
      description:
        failure.map((e) => `**${e.service}** — ${e.message}`).join("\n\n") ||
        "A deployment stopped, crashed, or was removed.",
      color: EMBED_RED,
      footer: { text: "Happy · Railway watchdog" },
    });
  }

  if (inProgress.length > 0) {
    embeds.push({
      title: "Deploy / recovery in progress",
      description:
        inProgress.map((e) => `**${e.service}** (${e.kind}) — ${e.message}`).join("\n\n") ||
        "I'm watching a rollout or recovery.",
      color: EMBED_YELLOW,
      footer: { text: "Happy · Railway watchdog" },
    });
  }

  if (onlineOk.length > 0) {
    embeds.push({
      title: "Back online",
      description:
        onlineOk.map((e) => `**${e.service}** — ${e.message}`).join("\n\n") ||
        "Service is healthy again.",
      color: EMBED_GREEN,
      footer: { text: "Happy · Railway watchdog" },
    });
  }

  try {
    await postDiscord(embeds);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[watchdog-discord] send failed: ${msg}`);
  }
}

/**
 * Red “down” embed for Chaos kills — callable from the dashboard API route.
 * Does not require `RAILWAY_WATCHDOG_WORKER` / `WATCHDOG_DISCORD_ALWAYS` (compose-watchdog may never see `exited` if restart policy recovers instantly).
 */
export async function notifyDiscordChaosKillEmbeds(
  events: WatchdogEvent[]
): Promise<void> {
  if (!webhookUrl() || events.length === 0) return;

  const embeds: Record<string, unknown>[] = [
    {
      title: "Heads up — deployment down (stopped, crashed, or removed)",
      description:
        events.map((e) => `**${e.service}** — ${e.message}`).join("\n\n") ||
        "Chaos kill recorded.",
      color: EMBED_RED,
      footer: { text: "Happy · Chaos kill" },
    },
  ];

  try {
    await postDiscord(embeds);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[watchdog-discord] chaos kill send failed: ${msg}`);
  }
}

/**
 * Persist all watchdog events to dashboard-backend Postgres (`watchdog_alerts`).
 * Set `DASHBOARD_BACKEND_URL` on the worker; auth uses `WATCHDOG_ALERTS_INGEST_TOKEN` or `LOG_INGEST_TOKEN`
 * (or `ALLOW_INSECURE_LOG_INGEST=1` locally).
 */
export async function persistWatchdogAlertsToBackend(
  events: WatchdogEvent[],
  source: "railway" | "compose" = "railway"
): Promise<void> {
  if (!events.length) return;
  const base = (runtimeEnv("DASHBOARD_BACKEND_URL") || "").trim().replace(/\/$/, "");
  if (!base) return;
  const token =
    (runtimeEnv("WATCHDOG_ALERTS_INGEST_TOKEN") || "").trim() ||
    (runtimeEnv("LOG_INGEST_TOKEN") || "").trim();
  const allowInsecure =
    (runtimeEnv("ALLOW_INSECURE_LOG_INGEST") || "").trim() === "1";
  if (!token && !allowInsecure) return;

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": UA,
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      headers["X-Watchdog-Alerts-Token"] = token;
    }
    const res = await fetch(`${base}/api/watchdog-alerts/ingest`, {
      method: "POST",
      headers,
      body: JSON.stringify({ source, events }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.warn(
        `[watchdog-discord] persist alerts HTTP ${res.status}${t ? `: ${t.slice(0, 200)}` : ""}`
      );
    }
  } catch (e) {
    console.warn(
      `[watchdog-discord] persist alerts failed: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}
