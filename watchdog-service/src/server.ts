/**
 * Dedicated Railway watchdog worker: single process owns poll loop + SSE subscribers.
 */

import http from "node:http";

import {
  createEmptyWatchdogState,
  railwayWatchdogIntervalSec,
  runRailwayWatchdogTick,
} from "../../dashboard/src/lib/watchdog-core/railway-watchdog-tick";
import type { WatchdogPayload } from "../../dashboard/src/lib/watchdog-core/watchdog-types";

const state = createEmptyWatchdogState();
let lastPayload: WatchdogPayload | null = null;
let tickInFlight = false;

const sseResponses = new Set<http.ServerResponse>();

function broadcastTick(payload: WatchdogPayload) {
  const line = `event: tick\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseResponses) {
    try {
      res.write(line);
    } catch {
      sseResponses.delete(res);
    }
  }
}

async function runTick() {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    lastPayload = await runRailwayWatchdogTick(state);
    broadcastTick(lastPayload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const errPayload: WatchdogPayload = {
      source: "error",
      intervalSec: railwayWatchdogIntervalSec(),
      lastTickAt: new Date().toISOString(),
      instancesMonitored: 0,
      events: [],
      error: msg,
    };
    lastPayload = errPayload;
    broadcastTick(errPayload);
  } finally {
    tickInFlight = false;
  }
}

function parsePort(): number {
  const p = parseInt(process.env.PORT ?? "8080", 10);
  return Number.isFinite(p) && p > 0 ? p : 8080;
}

const pollSec = railwayWatchdogIntervalSec();
const pollMs = Math.max(5000, pollSec * 1000);

const server = http.createServer((req, res) => {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);

  if (url.pathname === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }

  if (url.pathname === "/v1/status" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(
      JSON.stringify(
        lastPayload ?? {
          source: "unconfigured" as const,
          intervalSec: railwayWatchdogIntervalSec(),
          lastTickAt: null,
          instancesMonitored: 0,
          events: [],
          error: "No tick completed yet",
        }
      )
    );
    return;
  }

  if (url.pathname === "/v1/stream" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    sseResponses.add(res);
    if (lastPayload) {
      res.write(`event: tick\ndata: ${JSON.stringify(lastPayload)}\n\n`);
    }
    const keepalive = setInterval(() => {
      try {
        res.write(": keepalive\n\n");
      } catch {
        clearInterval(keepalive);
        sseResponses.delete(res);
      }
    }, 25_000);
    req.on("close", () => {
      clearInterval(keepalive);
      sseResponses.delete(res);
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

const port = parsePort();
server.listen(port, "0.0.0.0", () => {
  console.log(`railway-watchdog listening on ${port}; poll every ${pollSec}s`);
  void runTick();
  setInterval(() => void runTick(), pollMs);
});
