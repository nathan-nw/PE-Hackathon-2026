import { NextResponse } from "next/server";

import {
  dashboardBackendBase,
  isDashboardBackendUrlConfigured,
} from "@/lib/dashboard-backend-url";
import { runtimeEnv } from "@/lib/server-runtime-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const url = `${dashboardBackendBase()}/api/stats`;
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
    const onRailway = Boolean(runtimeEnv("RAILWAY_PROJECT_ID"));
    const configured = isDashboardBackendUrlConfigured();
    let hint =
      "Ensure dashboard-backend (FastAPI) is running on port 8000 for local dev.";
    if (onRailway && !configured) {
      hint =
        "Set DASHBOARD_BACKEND_URL on the **dashboard** service to your **dashboard-backend** public URL, then redeploy.";
    } else if (onRailway && configured) {
      hint =
        "Check dashboard-backend deploy logs and `/api/health` on that service.";
    }
    return NextResponse.json(
      {
        error: message,
        hint,
        total_ingested: 0,
        buffered_logs: 0,
        instances: {},
        global: { total_requests: 0, total_errors: 0, error_rate: 0 },
      },
      { status: 503 }
    );
  } finally {
    if (abortTimer) clearTimeout(abortTimer);
  }
}
