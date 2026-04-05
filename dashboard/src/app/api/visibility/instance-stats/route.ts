import { NextResponse } from "next/server";

import { resolveDashboardBackendBase } from "@/lib/dashboard-backend-url";
import { runtimeEnv } from "@/lib/server-runtime-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function lbBase(): string {
  const v = runtimeEnv("LOAD_BALANCER_URL")?.trim();
  if (v) {
    return v.replace(/\/$/, "");
  }
  // In the container, use Docker service name; on host, use published port.
  return "http://load-balancer:80";
}

export async function GET() {
  const resolved = resolveDashboardBackendBase();
  if (resolved.ok) {
    let abortTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = new AbortController();
      abortTimer = setTimeout(() => controller.abort(), 45_000);
      const res = await fetch(`${resolved.base}/api/telemetry/instance-stats`, {
        signal: controller.signal,
        next: { revalidate: 0 },
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const body = (await res.json()) as unknown;
        return NextResponse.json(body, { status: 200 });
      }
    } catch {
      // Fall back to direct load balancer (Compose / dev without backend).
    } finally {
      if (abortTimer) clearTimeout(abortTimer);
    }
  }

  const url = `${lbBase()}/api/instance-stats`;
  let abortTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    abortTimer = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(url, {
      signal: controller.signal,
      next: { revalidate: 0 },
      headers: { Accept: "application/json" },
    });
    const body = (await res.json()) as unknown;
    return NextResponse.json(body, { status: res.status });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed";
    return NextResponse.json({ error: message }, { status: 503 });
  } finally {
    if (abortTimer) clearTimeout(abortTimer);
  }
}
