import { NextRequest, NextResponse } from "next/server";

import { dashboardBackendBase } from "@/lib/dashboard-backend-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const qs = request.nextUrl.searchParams.toString();
  const url = `${dashboardBackendBase()}/api/errors${qs ? `?${qs}` : ""}`;

  let abortTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    abortTimer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, {
      signal: controller.signal,
      next: { revalidate: 0 },
      headers: { Accept: "application/json" },
    });
    const body = (await res.json()) as unknown;
    return NextResponse.json(body, { status: res.status });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed";
    return NextResponse.json(
      {
        buckets: [],
        error_logs: [],
        summary: { total_errors: 0, total_requests: 0, peak_errors: 0, current_rate: 0 },
        error: message,
      },
      { status: 503 },
    );
  } finally {
    if (abortTimer) clearTimeout(abortTimer);
  }
}
