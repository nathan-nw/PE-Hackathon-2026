import { NextResponse } from "next/server";
import {
  debugEnvEnabled,
  getRailwayEnvDebugSnapshot,
} from "@/lib/server-runtime-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Safe diagnostics when `DASHBOARD_DEBUG_ENV=1` on the dashboard service.
 * Does not return secret values — only presence and lengths.
 */
export async function GET() {
  if (!debugEnvEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(getRailwayEnvDebugSnapshot());
}
