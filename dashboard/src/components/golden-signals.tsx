"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const POLL_MS = 15_000;
const RANGE_MINUTES = 30;

// ── Types ──────────────────────────────────────────────────────────────────

type ChartSeries = {
  label: string;
  color: string;
  points: { t: number; v: number }[];
};

type InstanceStats = {
  instance_id: string;
  hostname: string;
  uptime_seconds: number;
  cpu_percent_process: number;
  memory_rss_mb: number;
  memory_percent_process: number;
  threads: number;
  avg_request_latency_ms: number;
  requests_observed: number;
  load_average_1m: number;
};

type GoldenSignalsPayload = {
  latency?: {
    p50?: [number, number][];
    p95?: [number, number][];
    p99?: [number, number][];
  };
  traffic?: {
    total?: [number, number][];
    by_status?: Record<string, [number, number][]>;
  };
  source?: string;
  requests_in_window?: number;
};

async function fetchGoldenSignals(): Promise<GoldenSignalsPayload | null> {
  const params = new URLSearchParams({
    range_minutes: String(RANGE_MINUTES),
    step_seconds: "15",
  });
  try {
    const res = await fetch(`/api/telemetry/golden-signals?${params}`);
    if (!res.ok) return null;
    return (await res.json()) as GoldenSignalsPayload;
  } catch {
    return null;
  }
}

async function fetchInstanceStats(): Promise<InstanceStats[]> {
  const results: InstanceStats[] = [];
  const seen = new Set<string>();
  const add = (row: InstanceStats) => {
    const id = String(row.instance_id ?? "");
    if (!id || seen.has(id)) return;
    seen.add(id);
    results.push(row);
  };

  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch("/api/visibility/instance-stats");
      if (!res.ok) continue;
      const data = (await res.json()) as unknown;
      if (Array.isArray(data)) {
        for (const row of data) {
          if (row && typeof row === "object" && "instance_id" in row) {
            add(row as InstanceStats);
          }
        }
        break;
      }
      if (data && typeof data === "object" && data !== null && "instance_id" in data) {
        add(data as InstanceStats);
      }
      if (results.length >= 2) break;
    } catch {
      break;
    }
  }
  return results;
}

// ── SVG Line Chart ─────────────────────────────────────────────────────────

function MiniChart({
  series,
  yLabel,
  yFormat,
  height = 220,
}: {
  series: ChartSeries[];
  yLabel: string;
  yFormat?: (v: number) => string;
  height?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    time: string;
    values: { label: string; color: string; value: string }[];
  } | null>(null);

  const width = 900;
  const padTop = 25;
  const padBottom = 45;
  const padLeft = 60;
  const padRight = 20;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const allPoints = series.flatMap((s) => s.points);
  if (allPoints.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center justify-center" style={{ height }}>
        No HTTP request data in this window. Generate traffic to the API and ensure logs reach
        dashboard-backend (Kafka or HTTP ingest).
      </div>
    );
  }

  const minT = Math.min(...allPoints.map((p) => p.t));
  const maxT = Math.max(...allPoints.map((p) => p.t));
  const maxV = Math.max(...allPoints.map((p) => p.v), 0.001);

  const xScale = (t: number) => padLeft + ((t - minT) / (maxT - minT || 1)) * chartW;
  const yScale = (v: number) => padTop + chartH - (v / maxV) * chartH;

  const fmt = yFormat ?? ((v: number) => v.toFixed(1));

  const yTicks = 5;
  const gridLines = Array.from({ length: yTicks + 1 }, (_, i) => {
    const v = (maxV / yTicks) * i;
    return { y: yScale(v), label: fmt(v) };
  });

  const xLabels: { x: number; label: string }[] = [];
  const spanS = maxT - minT;
  const intervalS = Math.max(300, Math.ceil(spanS / 6 / 60) * 60);
  for (let t = Math.ceil(minT / intervalS) * intervalS; t <= maxT; t += intervalS) {
    const d = new Date(t * 1000);
    xLabels.push({
      x: xScale(t),
      label: `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`,
    });
  }

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * width;
    const t = minT + ((svgX - padLeft) / chartW) * (maxT - minT);

    const values: { label: string; color: string; value: string }[] = [];
    for (const s of series) {
      let closest = s.points[0];
      for (const p of s.points) {
        if (Math.abs(p.t - t) < Math.abs(closest.t - t)) closest = p;
      }
      if (closest) values.push({ label: s.label, color: s.color, value: fmt(closest.v) });
    }

    const d = new Date(t * 1000);
    const timeStr = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;

    setTooltip({
      x: (svgX / width) * rect.width + rect.left,
      y: rect.top + padTop,
      time: timeStr,
      values,
    });
  };

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ maxHeight: height + 40 }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
      >
        {gridLines.map((g, i) => (
          <g key={i}>
            <line x1={padLeft} y1={g.y} x2={padLeft + chartW} y2={g.y} stroke="currentColor" strokeOpacity={0.08} />
            <text x={padLeft - 8} y={g.y + 4} textAnchor="end" fontSize={10} fill="currentColor" fillOpacity={0.5}>
              {g.label}
            </text>
          </g>
        ))}

        {xLabels.map((xl, i) => (
          <text key={i} x={xl.x} y={height - 8} textAnchor="middle" fontSize={10} fill="currentColor" fillOpacity={0.5}>
            {xl.label}
          </text>
        ))}

        <text x={12} y={padTop - 8} fontSize={10} fill="currentColor" fillOpacity={0.6}>
          {yLabel}
        </text>

        {series.map((s) => {
          if (s.points.length === 0) return null;
          const path = s.points
            .map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p.t)},${yScale(p.v)}`)
            .join(" ");
          return (
            <path
              key={s.label}
              d={path}
              fill="none"
              stroke={s.color}
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
          );
        })}

        {tooltip && (
          <line
            x1={((tooltip.x - (svgRef.current?.getBoundingClientRect().left ?? 0)) / (svgRef.current?.getBoundingClientRect().width ?? 1)) * width}
            y1={padTop}
            x2={((tooltip.x - (svgRef.current?.getBoundingClientRect().left ?? 0)) / (svgRef.current?.getBoundingClientRect().width ?? 1)) * width}
            y2={padTop + chartH}
            stroke="currentColor"
            strokeOpacity={0.2}
            strokeDasharray="4 2"
          />
        )}
      </svg>

      {tooltip && (
        <div
          className="pointer-events-none fixed z-50 rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-md"
          style={{ left: tooltip.x, top: tooltip.y - 10, transform: "translate(-50%, -100%)", minWidth: 140 }}
        >
          <div className="mb-1 text-xs font-semibold">{tooltip.time}</div>
          {tooltip.values.map((v) => (
            <div key={v.label} className="flex items-center justify-between gap-3 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: v.color }} />
                {v.label}
              </span>
              <span className="tabular-nums font-mono">{v.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChartLegend({ series }: { series: ChartSeries[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      {series.map((s) => (
        <span key={s.label} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

function StatBox({ label, value, sub, alert }: { label: string; value: string; sub?: string; alert?: boolean }) {
  return (
    <div className="bg-muted/40 rounded-lg border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${alert ? "text-red-500" : ""}`}>{value}</div>
      {sub && <div className="text-muted-foreground text-xs">{sub}</div>}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export function GoldenSignals() {
  const [latencySeries, setLatencySeries] = useState<ChartSeries[]>([]);
  const [trafficSeries, setTrafficSeries] = useState<ChartSeries[]>([]);
  const [saturation, setSaturation] = useState<InstanceStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [metaRequests, setMetaRequests] = useState<number | null>(null);

  const [currentP50, setCurrentP50] = useState<number | null>(null);
  const [currentP95, setCurrentP95] = useState<number | null>(null);
  const [currentP99, setCurrentP99] = useState<number | null>(null);
  const [currentRps, setCurrentRps] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    const payload = await fetchGoldenSignals();
    setMetaRequests(payload?.requests_in_window ?? null);

    const lat = payload?.latency;
    const toPoints = (pairs: [number, number][] | undefined) =>
      (pairs ?? []).map(([t, v]) => ({ t, v })).filter((p) => isFinite(p.v));

    const p50Points = toPoints(lat?.p50);
    const p95Points = toPoints(lat?.p95);
    const p99Points = toPoints(lat?.p99);

    setLatencySeries([
      { label: "p50", color: "#22c55e", points: p50Points },
      { label: "p95", color: "#f59e0b", points: p95Points },
      { label: "p99", color: "#ef4444", points: p99Points },
    ]);

    if (p50Points.length > 0) setCurrentP50(p50Points[p50Points.length - 1].v);
    if (p95Points.length > 0) setCurrentP95(p95Points[p95Points.length - 1].v);
    if (p99Points.length > 0) setCurrentP99(p99Points[p99Points.length - 1].v);

    const tr = payload?.traffic;
    const totalRps = (tr?.total ?? []).map(([t, v]) => ({ t, v })).filter((p) => isFinite(p.v));

    const statusColors: Record<string, string> = {
      "200": "#22c55e",
      "201": "#16a34a",
      "302": "#3b82f6",
      "400": "#f59e0b",
      "404": "#eab308",
      "429": "#f97316",
      "500": "#ef4444",
      "503": "#dc2626",
    };

    const byStatus = tr?.by_status ?? {};
    const trafficByStatus: ChartSeries[] = Object.entries(byStatus).map(([code, pairs]) => ({
      label: code,
      color: statusColors[code] || "#94a3b8",
      points: (pairs ?? []).map(([t, v]) => ({ t, v })).filter((p) => isFinite(p.v)),
    })).filter((s) => s.points.length > 0);

    if (trafficByStatus.length > 0) {
      setTrafficSeries(trafficByStatus);
    } else {
      setTrafficSeries([{ label: "Total req/s", color: "#3b82f6", points: totalRps }]);
    }

    if (totalRps.length > 0) setCurrentRps(totalRps[totalRps.length - 1].v);

    const stats = await fetchInstanceStats();
    setSaturation(stats);

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const id = window.setInterval(fetchData, POLL_MS);
    return () => window.clearInterval(id);
  }, [fetchData]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Latency</CardTitle>
          <CardDescription>
            Request duration percentiles (p50, p95, p99) over the last {RANGE_MINUTES} minutes, computed from
            structured HTTP logs (same pipeline as the Logs tab).
            {metaRequests != null && metaRequests > 0 ? (
              <span className="text-muted-foreground"> — {metaRequests} requests in window.</span>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <StatBox label="p50 (median)" value={currentP50 != null ? `${currentP50.toFixed(1)}ms` : "—"} />
            <StatBox
              label="p95"
              value={currentP95 != null ? `${currentP95.toFixed(1)}ms` : "—"}
              alert={currentP95 != null && currentP95 > 2000}
            />
            <StatBox
              label="p99"
              value={currentP99 != null ? `${currentP99.toFixed(1)}ms` : "—"}
              alert={currentP99 != null && currentP99 > 2000}
              sub={currentP99 != null && currentP99 > 2000 ? "Above 2s SLO threshold" : undefined}
            />
          </div>
          {loading ? (
            <div className="text-muted-foreground flex h-[220px] items-center justify-center">Loading latency data...</div>
          ) : (
            <>
              <MiniChart series={latencySeries} yLabel="ms" yFormat={(v) => `${v.toFixed(0)}ms`} />
              <ChartLegend series={latencySeries} />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Traffic</CardTitle>
          <CardDescription>
            Estimated requests per second by status code (bucketed from HTTP log lines) over the last {RANGE_MINUTES}{" "}
            minutes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <StatBox label="Current req/s" value={currentRps != null ? currentRps.toFixed(1) : "—"} />
            <StatBox
              label="Peak req/s (visible)"
              value={
                trafficSeries.length > 0
                  ? Math.max(...trafficSeries.flatMap((s) => s.points.map((p) => p.v)), 0).toFixed(1)
                  : "—"
              }
            />
            <StatBox
              label="Status codes"
              value={trafficSeries.length > 0 ? trafficSeries.map((s) => s.label).join(", ") : "—"}
            />
          </div>
          {loading ? (
            <div className="text-muted-foreground flex h-[220px] items-center justify-center">Loading traffic data...</div>
          ) : (
            <>
              <MiniChart series={trafficSeries} yLabel="req/s" yFormat={(v) => v.toFixed(1)} />
              <ChartLegend series={trafficSeries} />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Saturation</CardTitle>
          <CardDescription>
            Resource utilization per application instance. Source: <code>/api/instance-stats</code> on each Flask replica.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {saturation.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center text-sm">
              {loading ? "Loading instance data..." : "No instance stats available. Ensure url-shortener replicas are running."}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {saturation.map((inst) => (
                <div key={inst.instance_id} className="rounded-lg border p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="font-semibold text-sm">Instance {inst.instance_id}</span>
                    <Badge variant="outline" className="text-xs font-mono">{inst.hostname}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-muted-foreground text-xs">CPU (process)</div>
                      <div className={`text-sm font-semibold tabular-nums ${inst.cpu_percent_process > 80 ? "text-red-500" : ""}`}>
                        {inst.cpu_percent_process.toFixed(1)}%
                      </div>
                      <div className="mt-1 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full ${inst.cpu_percent_process > 80 ? "bg-red-500" : inst.cpu_percent_process > 50 ? "bg-amber-500" : "bg-green-500"}`}
                          style={{ width: `${Math.min(100, inst.cpu_percent_process)}%` }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Memory (RSS)</div>
                      <div className={`text-sm font-semibold tabular-nums ${inst.memory_percent_process > 80 ? "text-red-500" : ""}`}>
                        {inst.memory_rss_mb.toFixed(1)} MB
                      </div>
                      <div className="mt-1 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full ${inst.memory_percent_process > 80 ? "bg-red-500" : inst.memory_percent_process > 50 ? "bg-amber-500" : "bg-green-500"}`}
                          style={{ width: `${Math.min(100, inst.memory_percent_process)}%` }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Threads</div>
                      <div className="text-sm font-semibold tabular-nums">{inst.threads}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Load avg (1m)</div>
                      <div className="text-sm font-semibold tabular-nums">{inst.load_average_1m.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Avg latency</div>
                      <div className="text-sm font-semibold tabular-nums">{inst.avg_request_latency_ms.toFixed(1)}ms</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Uptime</div>
                      <div className="text-sm font-semibold tabular-nums">{(inst.uptime_seconds / 60).toFixed(0)}m</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
