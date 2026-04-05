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
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const POLL_MS = 5_000;

type Bucket = {
  minute: string;
  timestamp: number;
  total: number;
  errors: number;
  error_rate: number;
  status_breakdown: Record<string, number>;
};

type LogEntry = {
  timestamp?: string;
  status_code?: number;
  level?: string;
  logger?: string;
  message?: string;
  instance_id?: string;
  request_id?: string;
  method?: string;
  path?: string;
  duration_ms?: number;
};

type ErrorsResponse = {
  buckets: Bucket[];
  error_logs: LogEntry[];
  summary: {
    total_errors: number;
    total_requests: number;
    peak_errors: number;
    current_rate: number;
  };
  error?: string;
};

type TooltipData = {
  x: number;
  y: number;
  bucket: Bucket;
};

function LineGraph({
  buckets,
  tooltip,
  onHover,
  onLeave,
}: {
  buckets: Bucket[];
  tooltip: TooltipData | null;
  onHover: (data: TooltipData) => void;
  onLeave: () => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);

  const width = 900;
  const height = 300;
  const padTop = 30;
  const padBottom = 50;
  const padLeft = 55;
  const padRight = 20;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const maxErrors = Math.max(...buckets.map((b) => b.errors), 1);
  const maxRate = Math.max(...buckets.map((b) => b.error_rate), 1);

  const yErrors = (v: number) => padTop + chartH - (v / maxErrors) * chartH;
  const yRate = (v: number) => padTop + chartH - (v / maxRate) * chartH;
  const x = (i: number) => padLeft + (i / (buckets.length - 1)) * chartW;

  const errorPath = buckets
    .map((b, i) => `${i === 0 ? "M" : "L"}${x(i)},${yErrors(b.errors)}`)
    .join(" ");

  const ratePath = buckets
    .map((b, i) => `${i === 0 ? "M" : "L"}${x(i)},${yRate(b.error_rate)}`)
    .join(" ");

  const errorArea = `${errorPath} L${x(buckets.length - 1)},${padTop + chartH} L${x(0)},${padTop + chartH} Z`;

  const yTicks = 5;
  const gridLines = Array.from({ length: yTicks + 1 }, (_, i) => {
    const v = (maxErrors / yTicks) * i;
    return { y: yErrors(v), label: Math.round(v).toString() };
  });

  const xLabels = buckets
    .map((b, i) => ({ i, label: b.minute }))
    .filter((_, i) => i % 10 === 0);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * width;

    let closestIdx = 0;
    let closestDist = Infinity;
    for (let i = 0; i < buckets.length; i++) {
      const dist = Math.abs(svgX - x(i));
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    }

    if (closestDist < chartW / buckets.length) {
      const screenX = (x(closestIdx) / width) * rect.width + rect.left;
      const screenY = (yErrors(buckets[closestIdx].errors) / height) * rect.height + rect.top;
      onHover({
        x: screenX,
        y: screenY,
        bucket: buckets[closestIdx],
      });
    } else {
      onLeave();
    }
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      style={{ maxHeight: 340 }}
      onMouseMove={handleMouseMove}
      onMouseLeave={onLeave}
    >
      {gridLines.map((g) => (
        <g key={g.y}>
          <line
            x1={padLeft}
            y1={g.y}
            x2={padLeft + chartW}
            y2={g.y}
            stroke="currentColor"
            strokeOpacity={0.08}
          />
          <text
            x={padLeft - 8}
            y={g.y + 4}
            textAnchor="end"
            fontSize={11}
            fill="currentColor"
            fillOpacity={0.5}
          >
            {g.label}
          </text>
        </g>
      ))}

      {xLabels.map((xl) => (
        <text
          key={xl.i}
          x={x(xl.i)}
          y={height - 8}
          textAnchor="middle"
          fontSize={11}
          fill="currentColor"
          fillOpacity={0.5}
        >
          {xl.label}
        </text>
      ))}

      <text x={14} y={padTop - 10} fontSize={11} fill="#ef4444" fillOpacity={0.7}>
        Errors
      </text>
      <text
        x={width - padRight}
        y={padTop - 10}
        textAnchor="end"
        fontSize={11}
        fill="#f59e0b"
        fillOpacity={0.7}
      >
        Error Rate %
      </text>

      <path d={errorArea} fill="#ef4444" fillOpacity={0.08} />
      <path
        d={errorPath}
        fill="none"
        stroke="#ef4444"
        strokeWidth={2}
        strokeLinejoin="round"
      />

      <path
        d={ratePath}
        fill="none"
        stroke="#f59e0b"
        strokeWidth={1.5}
        strokeDasharray="6 3"
        strokeLinejoin="round"
      />

      {tooltip && (() => {
        const idx = buckets.findIndex((b) => b.minute === tooltip.bucket.minute);
        if (idx < 0) return null;
        return (
          <line
            x1={x(idx)}
            y1={padTop}
            x2={x(idx)}
            y2={padTop + chartH}
            stroke="currentColor"
            strokeOpacity={0.2}
            strokeDasharray="4 2"
          />
        );
      })()}

      {buckets.map((b, i) =>
        b.errors > 0 ? (
          <circle
            key={i}
            cx={x(i)}
            cy={yErrors(b.errors)}
            r={tooltip?.bucket.minute === b.minute ? 5 : 3}
            fill="#ef4444"
            stroke={tooltip?.bucket.minute === b.minute ? "#fff" : "none"}
            strokeWidth={2}
          />
        ) : null,
      )}
    </svg>
  );
}

function GraphTooltip({ data }: { data: TooltipData }) {
  const { bucket } = data;
  const breakdown = Object.entries(bucket.status_breakdown)
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div
      className="pointer-events-none fixed z-50 rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-md"
      style={{
        left: data.x,
        top: data.y - 10,
        transform: "translate(-50%, -100%)",
        minWidth: 160,
      }}
    >
      <div className="mb-1 text-xs font-semibold">{bucket.minute}</div>
      <div className="text-xs text-muted-foreground">
        {bucket.errors} error{bucket.errors !== 1 ? "s" : ""} / {bucket.total} total ({bucket.error_rate.toFixed(1)}%)
      </div>
      {breakdown.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {breakdown.map(([code, count]) => (
            <div key={code} className="flex items-center justify-between gap-3 text-xs">
              <span className="font-mono text-red-400">{code}</span>
              <span className="tabular-nums">{count}x</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function statusBadge(code: number) {
  if (code >= 500) return <Badge variant="destructive" className="font-mono text-xs">{code}</Badge>;
  if (code >= 400) return <Badge variant="secondary" className="font-mono text-xs">{code}</Badge>;
  return <Badge variant="outline" className="font-mono text-xs">{code}</Badge>;
}

export function ErrorMonitor() {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [errorLogs, setErrorLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentRate, setCurrentRate] = useState(0);
  const [totalErrors, setTotalErrors] = useState(0);
  const [totalRequests, setTotalRequests] = useState(0);
  const [peakErrors, setPeakErrors] = useState(0);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [clearing, setClearing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/errors?window_minutes=60&log_limit=100");
      if (!res.ok) return; // keep previous state on error
      const data: ErrorsResponse = await res.json();
      if (!data.buckets) return; // malformed response, keep previous state

      setBuckets(data.buckets);
      setErrorLogs(data.error_logs ?? []);
      setTotalErrors(data.summary.total_errors);
      setTotalRequests(data.summary.total_requests);
      setPeakErrors(data.summary.peak_errors);
      setCurrentRate(data.summary.current_rate);
    } catch {
      // keep previous state, retry on next poll
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const id = window.setInterval(fetchData, POLL_MS);
    return () => window.clearInterval(id);
  }, [fetchData]);

  const clearData = async () => {
    setClearing(true);
    try {
      await fetch("/api/errors/clear", { method: "POST" });
      setBuckets([]);
      setErrorLogs([]);
      setTotalErrors(0);
      setTotalRequests(0);
      setPeakErrors(0);
      setCurrentRate(0);
    } catch {
      // ignore
    } finally {
      setClearing(false);
    }
  };

  const overallRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Error Monitor</CardTitle>
            <CardDescription>
              HTTP errors (4xx + 5xx) over the last 60 minutes, bucketed per minute. Polls every 5 seconds.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={clearing}
            onClick={clearData}
          >
            <Trash2 className="size-4" />
            Clear
          </Button>
        </CardHeader>
        <CardContent>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="bg-muted/40 rounded-lg border p-3">
              <div className="text-muted-foreground text-xs">Current Error Rate</div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold tabular-nums">
                  {currentRate.toFixed(2)}%
                </span>
                {currentRate > 5 ? (
                  <Badge variant="destructive">High</Badge>
                ) : currentRate > 0 ? (
                  <Badge variant="secondary">Low</Badge>
                ) : (
                  <Badge variant="outline">None</Badge>
                )}
              </div>
            </div>
            <div className="bg-muted/40 rounded-lg border p-3">
              <div className="text-muted-foreground text-xs">Total Errors (1h)</div>
              <div className="text-lg font-semibold tabular-nums text-red-500">
                {totalErrors.toLocaleString()}
              </div>
            </div>
            <div className="bg-muted/40 rounded-lg border p-3">
              <div className="text-muted-foreground text-xs">Total Requests (1h)</div>
              <div className="text-lg font-semibold tabular-nums">
                {totalRequests.toLocaleString()}
              </div>
            </div>
            <div className="bg-muted/40 rounded-lg border p-3">
              <div className="text-muted-foreground text-xs">Peak Errors/min</div>
              <div className="text-lg font-semibold tabular-nums">
                {peakErrors.toLocaleString()}
              </div>
            </div>
          </div>

          {loading ? (
            <div className="text-muted-foreground flex h-[300px] items-center justify-center">
              Loading error data...
            </div>
          ) : buckets.length === 0 ? (
            <div className="text-muted-foreground flex h-[300px] items-center justify-center">
              No data available. Generate traffic to see error trends.
            </div>
          ) : (
            <div className="relative">
              <LineGraph
                buckets={buckets}
                tooltip={tooltip}
                onHover={setTooltip}
                onLeave={() => setTooltip(null)}
              />
              {tooltip && tooltip.bucket.errors > 0 && (
                <GraphTooltip data={tooltip} />
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
              Error count (left axis)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 bg-amber-500" style={{ borderTop: "2px dashed #f59e0b" }} />
              Error rate % (right axis)
            </span>
            <span className="ml-auto">
              Overall error rate: <strong>{overallRate.toFixed(2)}%</strong>
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Error Log</CardTitle>
          <CardDescription>
            All HTTP error responses (4xx + 5xx) from the last hour, newest first.
            {totalErrors > 0 && (
              <span className="text-foreground font-medium"> {totalErrors.toLocaleString()} errors</span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[min(50vh,480px)] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[160px]">Time</TableHead>
                  <TableHead className="w-[70px]">Status</TableHead>
                  <TableHead className="w-[80px]">Instance</TableHead>
                  <TableHead className="w-[200px]">Request</TableHead>
                  <TableHead className="w-[80px]">Duration</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {errorLogs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground text-center py-8">
                      No errors in the last hour.
                    </TableCell>
                  </TableRow>
                )}
                {errorLogs.map((log, idx) => (
                  <TableRow key={`${log.timestamp}-${idx}`}>
                    <TableCell className="font-mono text-xs whitespace-nowrap">
                      {log.timestamp
                        ? new Date(log.timestamp).toLocaleTimeString()
                        : "-"}
                    </TableCell>
                    <TableCell>
                      {log.status_code != null ? statusBadge(log.status_code) : "-"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {log.instance_id ?? "-"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {log.method && log.path
                        ? `${log.method} ${log.path}`
                        : "-"}
                    </TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">
                      {log.duration_ms != null ? `${log.duration_ms}ms` : "-"}
                    </TableCell>
                    <TableCell className="max-w-[300px] text-xs break-words">
                      {log.message ?? "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
