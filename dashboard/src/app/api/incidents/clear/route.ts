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

export async function POST() {
  const resolved = resolveDashboardBackendBase();
  if (!resolved.ok) {
    return NextResponse.json(
      {
        status: "error",
        detail: resolved.error,
        hint: "Fix DASHBOARD_BACKEND_URL on the dashboard service, redeploy, or run SYNC_VARIABLES=1 node setup-railway.js from the repo root.",
      },
      { status: 503 }
    );
  }

  const url = `${resolved.base}/api/incidents/clear`;
  let abortTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    abortTimer = setTimeout(() => controller.abort(), FETCH_MS);
    const res = await fetch(url, {
      method: "POST",
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
      "Ensure dashboard-backend (FastAPI) is running and reachable. Local: port 8000; Railway: private DASHBOARD_BACKEND_URL.";
    if (onRailway && resolved.usedDefaultLocalhost) {
      hint =
        "DASHBOARD_BACKEND_URL is unset — set it on the **dashboard** service (run `SYNC_VARIABLES=1 node setup-railway.js` for private URL), then redeploy.";
    } else if (onRailway && configured) {
      hint =
        "Confirm the **dashboard** service can reach **dashboard-backend** on the private network.";
    }
    return NextResponse.json(
      { status: "error", detail, hint },
      { status: 503 }
    );
  } finally {
    if (abortTimer) clearTimeout(abortTimer);
  }
}
