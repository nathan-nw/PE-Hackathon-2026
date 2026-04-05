"use client";

import { useCallback, useEffect, useState } from "react";
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

type K6Status = {
  running: boolean;
  preset: string;
  vus: number;
  duration: string;
  target_url: string;
  started_at: number;
  elapsed_s: number;
  requests: number;
  errors: number;
  error_rate: number;
  avg_duration_ms: number;
  p95_duration_ms: number;
  current_vus: number;
  finished: boolean;
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

export function LoadTest() {
  const [status, setStatus] = useState<K6Status | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Custom form state
  const [customVus, setCustomVus] = useState(100);
  const [customDuration, setCustomDuration] = useState("30s");
  const [customUrl, setCustomUrl] = useState("http://load-balancer:80");

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

  useEffect(() => {
    const id = window.setInterval(fetchStatus, STATUS_POLL_MS);
    return () => window.clearInterval(id);
  }, [fetchStatus]);

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
