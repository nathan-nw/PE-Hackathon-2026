import { NextResponse } from "next/server";

/**
 * Lightweight liveness for the dashboard (Next.js) service — used by Railway HTTP heartbeats.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { status: "ok", service: "dashboard" },
    {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    }
  );
}
