import { NextResponse } from "next/server";
import { dashboardBackendBase } from "@/lib/dashboard-backend-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch(`${dashboardBackendBase()}/api/k6/status`, {
      next: { revalidate: 0 },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed";
    return NextResponse.json({ error: message, running: false }, { status: 503 });
  }
}
