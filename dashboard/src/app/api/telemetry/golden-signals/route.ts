import { NextRequest, NextResponse } from "next/server";

import { resolveDashboardBackendBase } from "@/lib/dashboard-backend-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FETCH_MS = 25_000;

export async function GET(request: NextRequest) {
  const resolved = resolveDashboardBackendBase();
  if (!resolved.ok) {
    return NextResponse.json(
      {
        error: resolved.error,
        hint: "Set DASHBOARD_BACKEND_URL on the dashboard service, then redeploy.",
      },
      { status: 503 }
    );
  }

  const qs = request.nextUrl.searchParams.toString();
  const url = `${resolved.base}/api/telemetry/golden-signals${qs ? `?${qs}` : ""}`;

  let abortTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    abortTimer = setTimeout(() => controller.abort(), FETCH_MS);
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
