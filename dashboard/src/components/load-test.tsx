"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

const STATUS_POLL_MS = 2_000;

type K6SeriesPoint = {
  t: number;
  vus: number;
  avg_ms: number;
};

type K6Status = {
  running: boolean;
  preset: string;
  vus: number;
  duration: string;
  target_url: string;
  /** API base for k6 (dashboard-backend LOAD_TEST_TARGET_URL); use for hosted custom tests */
  default_target_url?: string;
  started_at: number;
  elapsed_s: number;
  requests: number;
  errors: number;
  error_rate: number;
  avg_duration_ms: number;
  p95_duration_ms: number;
  current_vus: number;
  finished: boolean;
  /** Samples ~0.75s apart: elapsed seconds from test start, active VUs, rolling avg latency */
  series?: K6SeriesPoint[];
  summary?: Record<string, string>;
  error?: string;
};

const PRESETS = {
  bronze: { label: "Bronze", vus: 50, duration: "30s", desc: "50 VUs for 30s" },
  silver: { label: "Silver", vus: 200, duration: "1m45s", desc: "200 VUs for 1m45s" },
  gold: { label: "Gold", vus: 500, duration: "1m50s", desc: "500 VUs for 1m50s" },
  chaos: { label: "Chaos", vus: 100, duration: "1m10s", desc: "100 VUs — intentional errors" },
} as const;

function StatBox({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-muted/40 rounded-lg border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-muted-foreground text-xs">{sub}</div>}
    </div>
  );
}

/** Dual-axis line chart: elapsed time (s) vs active VUs (left) and avg latency ms (right). */
function VuLatencyChart({
  series,
  running,
}: {
  series: K6SeriesPoint[];
  running: boolean;
}) {
  const width = 900;
  const height = 260;
  const padTop = 22;
  const padBottom = 40;
  const padLeft = 48;
  const padRight = 52;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const { pathVu, pathMs, maxVu, maxMs, ticksX } = useMemo(() => {
    if (series.length === 0) {
      return {
        pathVu: "",
        pathMs: "",
        maxVu: 1,
        maxMs: 1,
        ticksX: [] as { x: number; label: string }[],
      };
    }
    const maxT = Math.max(...series.map((p) => p.t), 0.1);
    const maxVu = Math.max(...series.map((p) => p.vus), 1);
    const maxMs = Math.max(...series.map((p) => p.avg_ms), 1);
    const xScale = (t: number) => padLeft + (t / maxT) * chartW;
    const yVu = (v: number) => padTop + chartH - (v / maxVu) * chartH;
    const yMs = (m: number) => padTop + chartH - (m / maxMs) * chartH;

    const pathVu = series
      .map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p.t)},${yVu(p.vus)}`)
      .join(" ");
    const pathMs = series
      .map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p.t)},${yMs(p.avg_ms)}`)
      .join(" ");

    const nX = Math.min(6, Math.max(2, Math.ceil(maxT / 5)));
    const ticksX: { x: number; label: string }[] = [];
    for (let i = 0; i <= nX; i++) {
      const t = (maxT * i) / nX;
      ticksX.push({ x: xScale(t), label: `${t.toFixed(0)}s` });
    }

    return { pathVu, pathMs, maxT, maxVu, maxMs, ticksX };
  }, [series, chartW, chartH, padLeft, padTop]);

  if (series.length === 0) {
    return (
      <div
        className="text-muted-foreground flex min-h-[200px] items-center justify-center rounded-lg border border-dashed text-sm"
        role="status"
      >
        {running ? "Collecting samples…" : "No samples for this run."}
      </div>
    );
  }

  const vuTicks = 4;
  const msTicks = 4;

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full text-foreground"
        style={{ maxHeight: height + 24 }}
        aria-label="Active VUs and average latency over elapsed time"
      >
        {/* Grid + left axis (VUs) */}
        {Array.from({ length: vuTicks + 1 }, (_, i) => {
          const v = (maxVu / vuTicks) * i;
          const y = padTop + chartH - (v / maxVu) * chartH;
          return (
            <g key={`vu-${i}`}>
              <line
                x1={padLeft}
                y1={y}
                x2={padLeft + chartW}
                y2={y}
                className="stroke-muted-foreground/15"
                strokeWidth={1}
              />
              <text
                x={padLeft - 6}
                y={y + 4}
                textAnchor="end"
                className="fill-muted-foreground text-[10px]"
              >
                {Math.round(v)}
              </text>
            </g>
          );
        })}
        {/* Right axis (ms) */}
        {Array.from({ length: msTicks + 1 }, (_, i) => {
          const m = (maxMs / msTicks) * i;
          const y = padTop + chartH - (m / maxMs) * chartH;
          return (
            <text
              key={`ms-${i}`}
              x={padLeft + chartW + 8}
              y={y + 4}
              className="fill-muted-foreground text-[10px]"
            >
              {m.toFixed(0)}ms
            </text>
          );
        })}
        {/* X ticks */}
        {ticksX.map((xl, i) => (
          <text
            key={i}
            x={xl.x}
            y={height - 10}
            textAnchor="middle"
            className="fill-muted-foreground text-[10px]"
          >
            {xl.label}
          </text>
        ))}
        <text x={padLeft} y={14} className="fill-primary text-[11px] font-medium">
          Active VUs
        </text>
        <text
          x={padLeft + chartW}
          y={14}
          textAnchor="end"
          className="fill-amber-600 dark:fill-amber-400 text-[11px] font-medium"
        >
          Avg latency
        </text>
        <text
          x={width / 2}
          y={height - 2}
          textAnchor="middle"
          className="fill-muted-foreground text-[10px]"
        >
          Elapsed time
        </text>
        <path
          d={pathVu}
          fill="none"
          className="stroke-primary"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={pathMs}
          fill="none"
          className="stroke-amber-600 dark:stroke-amber-400"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div className="text-muted-foreground mt-2 flex flex-wrap gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="bg-primary inline-block h-2 w-4 rounded-sm" />
          Active virtual users (left axis)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded-sm bg-amber-600 dark:bg-amber-400" />
          Average latency (right axis)
        </span>
      </div>
    </div>
  );
}

export function LoadTest() {
  const [status, setStatus] = useState<K6Status | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Custom form state
  const [customVus, setCustomVus] = useState(100);
  const [customDuration, setCustomDuration] = useState("30s");
  const [customUrl, setCustomUrl] = useState(
    process.env.NEXT_PUBLIC_LOAD_TEST_TARGET_URL ?? "http://load-balancer:80",
  );

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/k6/status");
      const data = await res.json();
      setStatus(data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Hosted: replace Compose-only default so custom tests do not target http://load-balancer:80.
  useEffect(() => {
    const d = status?.default_target_url?.trim();
    if (!d) return;
    setCustomUrl((prev) =>
      prev === "http://load-balancer:80" || prev === "http://127.0.0.1:8080" ? d : prev,
    );
  }, [status?.default_target_url]);

  useEffect(() => {
    const pollMs = status?.running ? 1_000 : STATUS_POLL_MS;
    const id = window.setInterval(fetchStatus, pollMs);
    return () => window.clearInterval(id);
  }, [fetchStatus, status?.running]);

  const startTest = async (body: Record<string, unknown>) => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/k6/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      }
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start test");
    } finally {
      setStarting(false);
    }
  };

  const stopTest = async () => {
    setStopping(true);
    try {
      await fetch("/api/k6/stop", { method: "POST" });
      await fetchStatus();
    } catch {
      // ignore
    } finally {
      setStopping(false);
    }
  };

  const isRunning = status?.running === true;
  const isFinished = status?.finished === true && !isRunning;

  return (
    <div className="space-y-4">
      {/* Presets */}
      <Card>
        <CardHeader>
          <CardTitle>Preset Load Tests</CardTitle>
          <CardDescription>
            Run the standard Bronze, Silver, or Gold tier tests. These use the same
            configurations as the k6 scripts in <code>load-tests/</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {Object.entries(PRESETS).map(([key, p]) => (
              <button
                key={key}
                type="button"
                disabled={isRunning || starting}
                onClick={() => startTest({ preset: key })}
                className="flex flex-col items-start gap-1 rounded-lg border px-5 py-4 text-left transition-colors hover:bg-muted/60 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{p.label}</span>
                  <Badge variant="outline" className="text-xs font-mono">
                    {p.vus} VUs
                  </Badge>
                </div>
                <span className="text-muted-foreground text-xs">{p.desc}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Custom */}
      <Card>
        <CardHeader>
          <CardTitle>Custom Load Test</CardTitle>
          <CardDescription>
            Configure a custom test with your own VU count, duration, and target URL.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-muted-foreground text-xs">Virtual Users</label>
              <input
                type="number"
                min={1}
                max={2000}
                className="border-input bg-background h-9 w-24 rounded-md border px-2 text-sm"
                value={customVus}
                onChange={(e) => setCustomVus(Number.parseInt(e.target.value, 10) || 1)}
                disabled={isRunning}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-muted-foreground text-xs">Duration</label>
              <input
                type="text"
                className="border-input bg-background h-9 w-24 rounded-md border px-2 text-sm"
                value={customDuration}
                onChange={(e) => setCustomDuration(e.target.value)}
                placeholder="30s"
                disabled={isRunning}
              />
            </div>
            <div className="flex min-w-[200px] flex-1 flex-col gap-1">
              <label className="text-muted-foreground text-xs">Target URL</label>
              <input
                type="text"
                className="border-input bg-background h-9 rounded-md border px-2 text-sm font-mono"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                disabled={isRunning}
              />
            </div>
            <div className="flex gap-2">
              {!isRunning ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={starting}
                  onClick={() =>
                    startTest({
                      vus: customVus,
                      duration: customDuration,
                      target_url: customUrl,
                    })
                  }
                >
                  {starting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  Start
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={stopping}
                  onClick={stopTest}
                >
                  {stopping ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  Stop
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error message */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {/* Live Stats */}
      {status && (isRunning || isFinished) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              Live Results
              {isRunning && (
                <Badge variant="default" className="animate-pulse">
                  Running
                </Badge>
              )}
              {isFinished && !isRunning && (
                <Badge variant="secondary">Finished</Badge>
              )}
              {status.preset && (
                <Badge variant="outline" className="capitalize">
                  {status.preset}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              {isRunning
                ? `${Math.round(status.elapsed_s)}s elapsed — ${status.current_vus} active VUs`
                : `Completed in ${Math.round(status.elapsed_s)}s`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-6 space-y-2">
              <div className="text-sm font-medium">Load over time</div>
              <p className="text-muted-foreground text-xs">
                Active virtual users (primary) and rolling average HTTP latency (amber), sampled about
                once per second while the test runs.
              </p>
              <VuLatencyChart
                series={status.series ?? []}
                running={isRunning}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
              <StatBox
                label="Active VUs"
                value={String(status.current_vus)}
              />
              <StatBox
                label="Total Requests"
                value={status.requests.toLocaleString()}
              />
              <StatBox
                label="Errors"
                value={status.errors.toLocaleString()}
                sub={
                  status.requests > 0
                    ? `${(status.error_rate * 100).toFixed(2)}% error rate`
                    : undefined
                }
              />
              <StatBox
                label="Avg Latency"
                value={`${status.avg_duration_ms.toFixed(0)}ms`}
              />
              <StatBox
                label="p95 Latency"
                value={`${status.p95_duration_ms.toFixed(0)}ms`}
              />
              <StatBox
                label="Elapsed"
                value={`${Math.round(status.elapsed_s)}s`}
              />
            </div>

            {/* Progress bar */}
            {isRunning && (
              <div className="mt-4">
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-1000"
                    style={{
                      width: `${Math.min(100, (status.current_vus / (status.vus || 1)) * 100)}%`,
                    }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                  <span>0 VUs</span>
                  <span>{status.vus} VUs (target)</span>
                </div>
              </div>
            )}

            {/* Error rate bar */}
            {status.requests > 0 && (
              <div className="mt-4 rounded-lg border p-3">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Error Rate</span>
                  <span className="font-semibold tabular-nums">
                    {(status.error_rate * 100).toFixed(2)}%
                  </span>
                </div>
                <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      status.error_rate > 0.05
                        ? "bg-red-500"
                        : status.error_rate > 0
                          ? "bg-amber-500"
                          : "bg-green-500"
                    }`}
                    style={{
                      width: `${Math.min(100, status.error_rate * 100)}%`,
                    }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                  <span>0%</span>
                  <span className={status.error_rate > 0.05 ? "text-red-500 font-medium" : ""}>
                    {status.error_rate > 0.05 ? "Above 5% threshold" : "Below 5% threshold"}
                  </span>
                  <span>100%</span>
                </div>
              </div>
            )}

            {/* Stop button when running */}
            {isRunning && (
              <div className="mt-4">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={stopping}
                  onClick={stopTest}
                >
                  {stopping ? <Loader2 className="size-4 animate-spin" /> : null}
                  Stop Test
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
