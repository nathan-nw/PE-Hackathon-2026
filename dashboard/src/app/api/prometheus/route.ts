import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function prometheusBase(): string {
  if (process.env.VISIBILITY_PROMETHEUS_URL) {
    return process.env.VISIBILITY_PROMETHEUS_URL.replace(/\/$/, "");
  }
  // next dev on the host: Compose publishes Prometheus on localhost.
  return "http://127.0.0.1:9090";
}

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type") || "query_range";
  const query = request.nextUrl.searchParams.get("query") || "";
  const start = request.nextUrl.searchParams.get("start") || "";
  const end = request.nextUrl.searchParams.get("end") || "";
  const step = request.nextUrl.searchParams.get("step") || "15s";

  if (!query) {
    return NextResponse.json({ error: "query parameter required" }, { status: 400 });
  }

  const params = new URLSearchParams();
  params.set("query", query);

  let endpoint = "query";
  if (type === "query_range") {
    endpoint = "query_range";
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    params.set("step", step);
  }

  const url = `${prometheusBase()}/api/v1/${endpoint}?${params.toString()}`;

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
    return NextResponse.json(
      { status: "error", error: message, data: { resultType: "matrix", result: [] } },
      { status: 503 },
    );
  } finally {
    if (abortTimer) clearTimeout(abortTimer);
  }
}
