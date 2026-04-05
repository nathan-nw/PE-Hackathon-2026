import { NextResponse } from "next/server";

import { fetchRailwayWatchdogPayload } from "@/lib/railway-watchdog";
import { runtimeEnv } from "@/lib/server-runtime-env";
import { watchdogServiceBaseUrl } from "@/lib/watchdog-service-url";
import {
  railwayIdsConfigured,
  railwayVisibilityConfigured,
} from "@/lib/railway-visibility";
import type { WatchdogPayload } from "@/lib/watchdog-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DockerStatusJson = {
  intervalSec?: number;
  lastTickAt?: string | null;
  instancesMonitored?: number;
  logTail?: string[];
  events?: Array<{
    id: string;
    at: string;
    service: string;
    action?: string;
    reason?: string;
  }>;
};

function normalizeDockerWatchdog(data: DockerStatusJson): WatchdogPayload {
  const ev = data.events ?? [];
  const tail = data.logTail;
  return {
    source: "docker",
    intervalSec: Number(data.intervalSec ?? 15),
    lastTickAt: data.lastTickAt ?? null,
    instancesMonitored: Number(data.instancesMonitored ?? 0),
    ...(Array.isArray(tail) && tail.length > 0 ? { logTail: tail } : {}),
    events: ev.map((e) => {
      const action = (e.action ?? "").toLowerCase();
      const reason = (e.reason ?? "").toLowerCase();
      const isStart = action === "start" || reason === "exited";
      return {
        id: e.id,
        at: e.at,
        service: e.service,
        kind: "recover" as const,
        message: isStart
          ? `Watchdog identified an exited or killed container and is starting ${e.service}.`
          : `Watchdog identified a stalled or unhealthy container and is restarting ${e.service}.`,
      };
    }),
  };
}

export async function GET() {
  if (railwayIdsConfigured() && railwayVisibilityConfigured()) {
    const remote = watchdogServiceBaseUrl();
    if (remote) {
      try {
        const res = await fetch(`${remote}/v1/status`, {
          cache: "no-store",
          signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return NextResponse.json(
            {
              source: "error" as const,
              intervalSec: 15,
              lastTickAt: null,
              instancesMonitored: 0,
              events: [],
              error: `Watchdog service HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
            } satisfies WatchdogPayload,
            { status: 502 }
          );
        }
        const payload = (await res.json()) as WatchdogPayload;
        return NextResponse.json(payload);
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Watchdog service unreachable";
        return NextResponse.json(
          {
            source: "error" as const,
            intervalSec: 15,
            lastTickAt: null,
            instancesMonitored: 0,
            events: [],
            error: message,
          } satisfies WatchdogPayload,
          { status: 503 }
        );
      }
    }
    try {
      const payload = await fetchRailwayWatchdogPayload();
      return NextResponse.json(payload);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Railway watchdog failed";
      return NextResponse.json(
        {
          source: "error" as const,
          intervalSec: 15,
          lastTickAt: null,
          instancesMonitored: 0,
          events: [],
          error: message,
        } satisfies WatchdogPayload,
        { status: 503 }
      );
    }
  }

  if (railwayIdsConfigured() && !railwayVisibilityConfigured()) {
    return NextResponse.json({
      source: "unconfigured",
      intervalSec: 15,
      lastTickAt: null,
      instancesMonitored: 0,
      events: [],
      error:
        "Set RAILWAY_PROJECT_TOKEN or RAILWAY_API_TOKEN for Railway watchdog visibility.",
    } satisfies WatchdogPayload);
  }

  const candidates = resolveWatchdogStatusUrls();
  let lastErr: string | null = null;

  for (const base of candidates) {
    try {
      const res = await fetch(`${base}/status`, {
        next: { revalidate: 0 },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) {
        lastErr = `Watchdog HTTP ${res.status} at ${base}`;
        continue;
      }
      const raw = (await res.json()) as DockerStatusJson;
      return NextResponse.json(normalizeDockerWatchdog(raw));
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "Fetch failed";
      continue;
    }
  }

  return NextResponse.json(
    {
      source: "error" as const,
      intervalSec: 15,
      lastTickAt: null,
      instancesMonitored: 0,
      events: [],
      error: `${lastErr ?? "Unreachable"}. Tried: ${candidates.join(", ")}. Ensure compose-watchdog is up and port 8099 is published (docker compose up compose-watchdog -d).`,
    } satisfies WatchdogPayload,
    { status: 503 }
  );
}

/** Prefer host URL for `next dev`; Docker network URL for production image. */
function resolveWatchdogStatusUrls(): string[] {
  const explicit = runtimeEnv("WATCHDOG_STATUS_URL")?.trim();
  if (explicit) {
    return [explicit.replace(/\/$/, "")];
  }
  const isDev = process.env.NODE_ENV === "development";
  if (isDev) {
    return ["http://127.0.0.1:8099", "http://compose-watchdog:8099"];
  }
  return ["http://compose-watchdog:8099", "http://127.0.0.1:8099"];
}
