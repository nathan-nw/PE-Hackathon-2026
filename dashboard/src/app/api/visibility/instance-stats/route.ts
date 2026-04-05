import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function lbBase(): string {
  if (process.env.LOAD_BALANCER_URL) {
    return process.env.LOAD_BALANCER_URL.replace(/\/$/, "");
  }
  // In the container, use Docker service name; on host, use published port.
  return "http://load-balancer:80";
}

export async function GET() {
  const url = `${lbBase()}/api/instance-stats`;
  let abortTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    abortTimer = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(url, {
      signal: controller.signal,
      next: { revalidate: 0 },
      headers: { Accept: "application/json" },
    });
    const body = (await res.json()) as unknown;
    return NextResponse.json(body, { status: res.status });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed";
    return NextResponse.json({ error: message }, { status: 503 });
  } finally {
    if (abortTimer) clearTimeout(abortTimer);
  }
}
