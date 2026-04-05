import { NextResponse } from "next/server";
import { dashboardBackendBase } from "@/lib/dashboard-backend-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const res = await fetch(`${dashboardBackendBase()}/api/k6/stop`, {
      method: "POST",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
