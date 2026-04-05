import { NextResponse } from "next/server";

import {
  isDashboardBackendUrlConfigured,
  resolveDashboardBackendBase,
} from "@/lib/dashboard-backend-url";
import { formatFetchError } from "@/lib/fetch-error-detail";
import { runtimeEnv } from "@/lib/server-runtime-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FETCH_MS = 25_000;

export async function GET() {
  const resolved = resolveDashboardBackendBase();
  if (!resolved.ok) {
    return NextResponse.json(
      {
        error: resolved.error,
        hint: "Fix DASHBOARD_BACKEND_URL or run SYNC_VARIABLES=1 node setup-railway.js.",
        total_ingested: 0,
        buffered_logs: 0,
        instances: {},
        global: { total_requests: 0, total_errors: 0, error_rate: 0 },
      },
      { status: 503 }
    );
  }

  const url = `${resolved.base}/api/stats`;
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
    const detail = formatFetchError(e);
    const onRailway = Boolean(runtimeEnv("RAILWAY_PROJECT_ID"));
    const configured = isDashboardBackendUrlConfigured();
    let hint =
      "Ensure dashboard-backend (FastAPI) is running on port 8000 for local dev.";
    if (onRailway && !configured) {
      hint =
        "Set DASHBOARD_BACKEND_URL on the **dashboard** service (private URL recommended), then redeploy.";
    } else if (onRailway && configured) {
      hint =
        "Confirm DASHBOARD_BACKEND_URL uses http://<private-domain>:<PORT> (see setup-railway.js) and dashboard-backend is running.";
    }
    return NextResponse.json(
      {
        error: detail,
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
