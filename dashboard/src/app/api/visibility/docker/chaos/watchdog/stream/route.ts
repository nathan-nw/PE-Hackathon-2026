import { NextResponse } from "next/server";

import { watchdogServiceBaseUrl } from "@/lib/watchdog-service-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const base = watchdogServiceBaseUrl();
  if (!base) {
    return new NextResponse(
      "WATCHDOG_SERVICE_URL is not set — SSE proxy disabled; use JSON polling on /watchdog",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }

  try {
    const upstream = await fetch(`${base}/v1/stream`, {
      headers: { Accept: "text/event-stream", "Cache-Control": "no-store" },
      cache: "no-store",
    });
    if (!upstream.ok || !upstream.body) {
      return new NextResponse(
        `Upstream watchdog stream HTTP ${upstream.status}`,
        { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } }
      );
    }
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    return new NextResponse(msg, {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
