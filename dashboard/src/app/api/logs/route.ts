import { NextRequest, NextResponse } from "next/server";

import {
  isDashboardBackendUrlConfigured,
  resolveDashboardBackendBase,
} from "@/lib/dashboard-backend-url";
import { formatFetchError } from "@/lib/fetch-error-detail";
import { runtimeEnv } from "@/lib/server-runtime-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cold start / TLS can exceed 10s on some hosts. */
const FETCH_MS = 25_000;

export async function GET(request: NextRequest) {
  const resolved = resolveDashboardBackendBase();
  if (!resolved.ok) {
    return NextResponse.json(
      {
        logs: [],
        error: resolved.error,
        hint: "Fix DASHBOARD_BACKEND_URL on the dashboard service, redeploy, or run SYNC_VARIABLES=1 node setup-railway.js from the repo root.",
      },
      { status: 503 }
    );
  }

  const qs = request.nextUrl.searchParams.toString();
  const url = `${resolved.base}/api/logs${qs ? `?${qs}` : ""}`;

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
      "Ensure dashboard-backend (FastAPI) is running and reachable. Local: port 8000; Railway: private DASHBOARD_BACKEND_URL (often :8080).";
    if (onRailway && resolved.usedDefaultLocalhost) {
      hint =
        "DASHBOARD_BACKEND_URL is unset — set it on the **dashboard** service (run `SYNC_VARIABLES=1 node setup-railway.js` for private URL), then redeploy.";
    } else if (onRailway && configured) {
      hint =
        "If the error is ENOTFOUND or connection refused, confirm the **dashboard** service can reach **dashboard-backend** on the private network (same Railway project). Re-run variable sync so DASHBOARD_BACKEND_URL uses RAILWAY_PRIVATE_DOMAIN + PORT.";
    }
    return NextResponse.json(
      {
        logs: [],
        error: detail,
        hint,
      },
      { status: 503 }
    );
  } finally {
    if (abortTimer) clearTimeout(abortTimer);
  }
}
