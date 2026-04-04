import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Alertmanager GET /api/v2/alerts response item (subset). */
export type AlertmanagerAlert = {
  fingerprint?: string;
  status?: { state?: string };
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  startsAt?: string;
  endsAt?: string;
  updatedAt?: string;
};

function alertmanagerBaseUrl(): string {
  if (process.env.VISIBILITY_ALERTMANAGER_URL) {
    return process.env.VISIBILITY_ALERTMANAGER_URL.replace(/\/$/, "");
  }
  // `next dev` / `next start` on the host: Compose publishes Alertmanager on localhost.
  // In the dashboard container, set VISIBILITY_ALERTMANAGER_URL=http://alertmanager:9093 (see docker-compose).
  return "http://127.0.0.1:9093";
}

export async function GET() {
  const base = alertmanagerBaseUrl();
  const url = `${base}/api/v2/alerts`;

  let abortTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    abortTimer = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(url, {
      signal: controller.signal,
      next: { revalidate: 0 },
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        {
          error: `Alertmanager returned ${res.status}`,
          detail: text.slice(0, 500),
          alerts: [] as AlertmanagerAlert[],
        },
        { status: 502 }
      );
    }

    const data = (await res.json()) as AlertmanagerAlert[];

    const alerts = (Array.isArray(data) ? data : []).map((a) => ({
      fingerprint: a.fingerprint,
      state: a.status?.state,
      name:
        a.labels?.alertname ??
        a.labels?.["alertname"] ??
        "(unknown)",
      severity: a.labels?.severity,
      instance: a.labels?.instance,
      job: a.labels?.job,
      startsAt: a.startsAt,
      summary: a.annotations?.summary,
      description: a.annotations?.description,
      labels: a.labels ?? {},
    }));

    return NextResponse.json({ alerts, source: url });
  } catch (e) {
    const message =
      e instanceof Error
        ? e.name === "AbortError"
          ? "Alertmanager request timed out (is it running on :9093?)"
          : e.message
        : "Unknown error";
    return NextResponse.json({ error: message, alerts: [] }, { status: 503 });
  } finally {
    if (abortTimer) clearTimeout(abortTimer);
  }
}
