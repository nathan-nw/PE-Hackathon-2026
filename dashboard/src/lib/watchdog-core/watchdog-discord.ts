/**
 * Optional Discord webhook notifications for Railway watchdog events.
 *
 * Sends only from the dedicated **railway-watchdog** worker by default (`RAILWAY_WATCHDOG_WORKER=1`),
 * so the Next.js dashboard polling `runRailwayWatchdogTick` in-process does not spam Discord.
 * Set `WATCHDOG_DISCORD_ALWAYS=1` to enable from the dashboard server (local dev).
 *
 * Uses WATCHDOG_DISCORD_WEBHOOK_URL if set, else DISCORD_WEBHOOK_URL (same as dashboard-backend alerts).
 */

import type { WatchdogEvent, WatchdogEventKind } from "./watchdog-types";

const UA = "PE-Hackathon-Watchdog/1.0";

function discordNotifyAllowed(): boolean {
  if ((process.env.WATCHDOG_DISCORD_NOTIFY || "").trim() === "0") {
    return false;
  }
  if ((process.env.WATCHDOG_DISCORD_ALWAYS || "").trim() === "1") {
    return true;
  }
  return (process.env.RAILWAY_WATCHDOG_WORKER || "").trim() === "1";
}

/** Service stopped / no deployment — user-facing “broken or exited”. */
const FAILURE_KINDS = new Set<WatchdogEventKind>(["railway_stopped"]);

/** Rollout, recovery, or watchdog-triggered redeploy. */
const REDEPLOY_KINDS = new Set<WatchdogEventKind>([
  "recover",
  "railway_rebooting",
  "railway_deploy",
  "railway_auto_recover",
  "heartbeat_recover",
  "heartbeat_exit_redeploy",
]);

function webhookUrl(): string {
  return (
    (process.env.WATCHDOG_DISCORD_WEBHOOK_URL || "").trim() ||
    (process.env.DISCORD_WEBHOOK_URL || "").trim()
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

  for (const batch of batches) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": UA,
      },
      body: JSON.stringify({ embeds: batch }),
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
  const redeploy = events.filter((e) => REDEPLOY_KINDS.has(e.kind));
  if (failure.length === 0 && redeploy.length === 0) return;

  const embeds: Record<string, unknown>[] = [];

  if (failure.length > 0) {
    embeds.push({
      title: "Watchdog: service stopped / exited",
      description:
        failure.map((e) => `**${e.service}** — ${e.message}`).join("\n\n") ||
        "A deployment stopped or was removed.",
      color: 15158332,
      footer: { text: "Railway watchdog" },
    });
  }

  if (redeploy.length > 0) {
    embeds.push({
      title: "Watchdog: redeploy / recovery",
      description:
        redeploy.map((e) => `**${e.service}** (${e.kind}) — ${e.message}`).join("\n\n") ||
        "A rollout or recovery is in progress.",
      color: 3447003,
      footer: { text: "Railway watchdog" },
    });
  }

  try {
    await postDiscord(embeds);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[watchdog-discord] send failed: ${msg}`);
  }
}
