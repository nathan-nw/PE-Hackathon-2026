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

/** Discord embed colors (decimal). Red = exited/stopped, yellow = deploy/recovery in progress, green = healthy online. */
const EMBED_RED = 15548997; // #ED4245
const EMBED_YELLOW = 16705372; // #FEE75C
const EMBED_GREEN = 5763719; // #57F287

/** Service stopped / no deployment — exited deployment. */
const FAILURE_KINDS = new Set<WatchdogEventKind>(["railway_stopped"]);

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
  const inProgress = events.filter((e) => IN_PROGRESS_KINDS.has(e.kind));
  const onlineOk = events.filter((e) => ONLINE_KINDS.has(e.kind));
  if (failure.length === 0 && inProgress.length === 0 && onlineOk.length === 0) return;

  const embeds: Record<string, unknown>[] = [];

  if (failure.length > 0) {
    embeds.push({
      title: "Watchdog: deployment exited / stopped",
      description:
        failure.map((e) => `**${e.service}** — ${e.message}`).join("\n\n") ||
        "A deployment stopped or was removed.",
      color: EMBED_RED,
      footer: { text: "Railway watchdog" },
    });
  }

  if (inProgress.length > 0) {
    embeds.push({
      title: "Watchdog: deploy / recovery in progress",
      description:
        inProgress.map((e) => `**${e.service}** (${e.kind}) — ${e.message}`).join("\n\n") ||
        "A rollout or recovery is in progress.",
      color: EMBED_YELLOW,
      footer: { text: "Railway watchdog" },
    });
  }

  if (onlineOk.length > 0) {
    embeds.push({
      title: "Watchdog: deployment online",
      description:
        onlineOk.map((e) => `**${e.service}** — ${e.message}`).join("\n\n") ||
        "Service is online with a healthy deployment.",
      color: EMBED_GREEN,
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
