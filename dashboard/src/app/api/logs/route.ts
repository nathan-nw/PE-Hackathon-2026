import { NextRequest, NextResponse } from "next/server";

import {
  dashboardBackendBase,
  isDashboardBackendUrlConfigured,
} from "@/lib/dashboard-backend-url";
import { runtimeEnv } from "@/lib/server-runtime-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const qs = request.nextUrl.searchParams.toString();
  const url = `${dashboardBackendBase()}/api/logs${qs ? `?${qs}` : ""}`;

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
      "Ensure dashboard-backend (FastAPI) is running and reachable. Local dev: start it on port 8000.";
    if (onRailway && !configured) {
      hint =
        "Set DASHBOARD_BACKEND_URL on the **dashboard** service to your **dashboard-backend** public HTTPS URL (e.g. from Railway Variables or `SYNC_VARIABLES=1 node setup-railway.js`), then redeploy the dashboard.";
    } else if (onRailway && configured) {
      hint =
        "dashboard-backend may be sleeping, crashed, or unreachable from this service. Check the dashboard-backend deploy logs and health (`/api/health`).";
    }
    return NextResponse.json(
      {
        logs: [],
        error: message,
        hint,
      },
      { status: 503 }
    );
  } finally {
    if (abortTimer) clearTimeout(abortTimer);
  }
}
