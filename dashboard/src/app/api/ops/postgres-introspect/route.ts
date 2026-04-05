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

/** Proxies to FastAPI `GET /api/introspect/postgres` (databases + public tables). */
export async function GET() {
  const resolved = resolveDashboardBackendBase();
  if (!resolved.ok) {
    return NextResponse.json(
      {
        error: resolved.error,
        hint: "Fix DASHBOARD_BACKEND_URL or run SYNC_VARIABLES=1 node setup-railway.js.",
      },
      { status: 503 }
    );
  }

  const url = `${resolved.base}/api/introspect/postgres`;
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
      "Ensure dashboard-backend is running. Local: port 8000; Railway: private URL (often :8080).";
    if (onRailway && !configured) {
      hint =
        "Set DASHBOARD_BACKEND_URL on the **dashboard** service, then redeploy.";
    } else if (onRailway && configured) {
      hint =
        "Confirm the dashboard can reach dashboard-backend on the private network.";
    }
    return NextResponse.json({ error: detail, hint }, { status: 503 });
  } finally {
    if (abortTimer) clearTimeout(abortTimer);
  }
}
