"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { labelForInstanceId } from "@/lib/compose-instance";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Trash2 } from "lucide-react";

const POLL_MS = 2_500;

type Bucket = {
  minute: string;
  timestamp: number;
  total: number;
  errors: number;
  error_rate: number;
  status_breakdown: Record<string, number>;
};

type LogEntry = Record<string, unknown>;

type InsightsResponse = {
  buckets: Bucket[];
  logs: LogEntry[];
  summary: {
    total_errors: number;
    total_requests: number;
    peak_errors: number;
    current_rate: number;
  };
  error?: string;
  hint?: string;
};

type LogStatsResponse = {
  total_ingested?: number;
  buffered_logs?: number;
  pending_flush?: number;
  instances?: Record<
    string,
    {
      request_count: number;
      error_count: number;
      avg_duration_ms: number;
      error_rate: number;
      status_codes: Record<string, number>;
      levels: Record<string, number>;
    }
  >;
  global?: {
    total_requests: number;
    total_errors: number;
    error_rate: number;
  };
  error?: string;
  hint?: string;
};

function logLevelBadge(level: string | undefined) {
  const l = level ?? "";
  if (l === "ERROR" || l === "CRITICAL")
    return (
      <Badge variant="destructive" className="font-mono text-xs">
        {l}
      </Badge>
    );
  if (l === "WARNING")
    return (
      <Badge variant="secondary" className="font-mono text-xs">
        {l}
      </Badge>
    );
  return (
    <Badge variant="outline" className="font-mono text-xs">
      {l || "—"}
    </Badge>
  );
}

function statusHttpBadge(code: number) {
  if (code >= 500)
    return (
      <Badge variant="destructive" className="font-mono text-xs">
        {code}
      </Badge>
    );
  if (code >= 400)
    return (
      <Badge variant="secondary" className="font-mono text-xs">
        {code}
      </Badge>
    );
  return (
    <Badge variant="outline" className="font-mono text-xs">
      {code}
    </Badge>
  );
}

type TooltipData = { x: number; y: number; bucket: Bucket };

function FrequencyGraph({
  buckets,
  tooltip,
  onHover,
  onLeave,
  showRequests,
  showErrors,
  showErrorRate,
}: {
  buckets: Bucket[];
  tooltip: TooltipData | null;
  onHover: (data: TooltipData) => void;
  onLeave: () => void;
  showRequests: boolean;
  showErrors: boolean;
  showErrorRate: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const width = 900;
  const height = 300;
  const padTop = 30;
  const padBottom = 50;
  const padLeft = 55;
  const padRight = showErrorRate ? 52 : 20;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const maxCount = Math.max(
    showRequests ? Math.max(...buckets.map((b) => b.total), 0) : 0,
    showErrors ? Math.max(...buckets.map((b) => b.errors), 0) : 0,
    1,
  );
  const maxRate = Math.max(...buckets.map((b) => b.error_rate), 1);

  const yCount = (v: number) => padTop + chartH - (v / maxCount) * chartH;
  const yRate = (v: number) => padTop + chartH - (v / maxRate) * chartH;
  const n = Math.max(buckets.length - 1, 1);
  const xAt = (i: number) => padLeft + (buckets.length <= 1 ? chartW / 2 : (i / n) * chartW);

  const reqPath = buckets
    .map((b, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yCount(b.total)}`)
    .join(" ");
  const errPath = buckets
    .map((b, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yCount(b.errors)}`)
    .join(" ");
  const ratePath = buckets
    .map((b, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yRate(b.error_rate)}`)
    .join(" ");

  const gridLines = Array.from({ length: 6 }, (_, i) => {
    const v = (maxCount / 5) * i;
    return { y: yCount(v), label: Math.round(v).toString() };
  });

  const xLabels = buckets
    .map((b, i) => ({ i, label: b.minute }))
    .filter((_, i) => i % 10 === 0);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || buckets.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * width;
    let closestIdx = 0;
    let closestDist = Infinity;
    for (let i = 0; i < buckets.length; i++) {
      const dist = Math.abs(svgX - xAt(i));
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    }
    if (closestDist < chartW / Math.max(buckets.length, 8)) {
      const screenX = (xAt(closestIdx) / width) * rect.width + rect.left;
      const screenY = (yCount(buckets[closestIdx].total) / height) * rect.height + rect.top;
      onHover({ x: screenX, y: screenY, bucket: buckets[closestIdx] });
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
          x={xAt(xl.i)}
          y={height - 8}
          textAnchor="middle"
          fontSize={11}
          fill="currentColor"
          fillOpacity={0.5}
        >
          {xl.label}
        </text>
      ))}

      <text x={14} y={padTop - 10} fontSize={11} fill="currentColor" fillOpacity={0.6}>
        Counts / min
      </text>
      {showErrorRate && (
        <text
          x={width - 8}
          y={padTop - 10}
          textAnchor="end"
          fontSize={11}
          fill="#f59e0b"
          fillOpacity={0.85}
        >
          Error rate %
        </text>
      )}

      {showRequests && (
        <path
          d={reqPath}
          fill="none"
          stroke="#22c55e"
          strokeWidth={2}
          strokeLinejoin="round"
          opacity={0.95}
        />
      )}
      {showErrors && (
        <path
          d={errPath}
          fill="none"
          stroke="#ef4444"
          strokeWidth={2}
          strokeLinejoin="round"
          opacity={0.95}
        />
      )}
      {showErrorRate && (
        <path
          d={ratePath}
          fill="none"
          stroke="#f59e0b"
          strokeWidth={1.5}
          strokeDasharray="6 3"
          strokeLinejoin="round"
        />
      )}

      {tooltip && (() => {
        const idx = buckets.findIndex((b) => b.minute === tooltip.bucket.minute);
        if (idx < 0) return null;
        return (
          <line
            x1={xAt(idx)}
            y1={padTop}
            x2={xAt(idx)}
            y2={padTop + chartH}
            stroke="currentColor"
            strokeOpacity={0.2}
            strokeDasharray="4 2"
          />
        );
      })()}
    </svg>
  );
}

function GraphTooltip({ data }: { data: TooltipData }) {
  const { bucket } = data;
  const breakdown = Object.entries(bucket.status_breakdown).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  return (
    <div
      className="bg-popover text-popover-foreground pointer-events-none fixed z-50 min-w-[180px] rounded-lg border px-3 py-2 shadow-md"
      style={{
        left: data.x,
        top: data.y - 10,
        transform: "translate(-50%, -100%)",
      }}
    >
      <div className="mb-1 text-xs font-semibold">{bucket.minute}</div>
      <div className="text-muted-foreground text-xs">
        Requests: <span className="text-foreground font-medium tabular-nums">{bucket.total}</span>
        {" · "}
        Errors: <span className="text-foreground font-medium tabular-nums">{bucket.errors}</span>
        {" · "}
        Rate:{" "}
        <span className="text-foreground font-medium tabular-nums">{bucket.error_rate.toFixed(1)}%</span>
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

/** Stable across poll refreshes (do not use list index — it shifts when new logs arrive). */
function stableLogRowKey(row: LogEntry): string {
  const rawId = row.id ?? row.kafka_log_id;
  if (rawId != null && String(rawId) !== "") {
    return `id:${String(rawId)}`;
  }
  let h = 2166136261;
  const s = JSON.stringify(row);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fp:${(h >>> 0).toString(36)}`;
}

/** Parsed HTTP status, or null when this row is not an HTTP status line (matches chart bucket rules). */
function parseHttpStatusCode(row: LogEntry): number | null {
  const sc = row.status_code;
  if (typeof sc === "number" && !Number.isNaN(sc)) return sc;
  if (typeof sc === "string") {
    const n = Number.parseInt(sc, 10);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/**
 * Chart: Errors = status &gt;= 400. Requests (for the list) = non-error HTTP lines plus non-HTTP log lines.
 * When both series checkboxes are off, the caller skips filtering and shows all rows.
 */
function logRowMatchesSeries(
  row: LogEntry,
  showRequests: boolean,
  showErrors: boolean
): boolean {
  const code = parseHttpStatusCode(row);
  if (code == null) {
    return showRequests;
  }
  if (code >= 400) {
    return showErrors;
  }
  return showRequests;
}

type UnifiedLogMonitorProps = {
  /** When set (e.g. from Containers row), apply once to the instance filter. */
  instanceJump?: { instanceId: string; nonce: number } | null;
  onInstanceJumpApplied?: () => void;
};

export function UnifiedLogMonitor({
  instanceJump,
  onInstanceJumpApplied,
}: UnifiedLogMonitorProps = {}) {
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [logStats, setLogStats] = useState<LogStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [clearing, setClearing] = useState(false);

  const [windowMinutes, setWindowMinutes] = useState(60);
  const [logLimit, setLogLimit] = useState(200);
  const [logInstance, setLogInstance] = useState("");
  const [logLevel, setLogLevel] = useState("");
  const [logSearch, setLogSearch] = useState("");
  const [logSearchDebounced, setLogSearchDebounced] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [pauseLive, setPauseLive] = useState(false);

  const [showRequests, setShowRequests] = useState(true);
  const [showErrors, setShowErrors] = useState(true);
  const [showErrorRate, setShowErrorRate] = useState(false);

  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!instanceJump?.instanceId) return;
    setLogInstance(instanceJump.instanceId);
    onInstanceJumpApplied?.();
    // Only re-run when Ops sends a new jump (nonce), not when the callback identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nonce is the intentional trigger
  }, [instanceJump?.nonce, instanceJump?.instanceId]);

  useEffect(() => {
    const t = window.setTimeout(() => setLogSearchDebounced(logSearch), 400);
    return () => window.clearTimeout(t);
  }, [logSearch]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("window_minutes", String(windowMinutes));
      params.set("log_limit", String(Math.min(10000, Math.max(1, logLimit))));
      if (logInstance) params.set("instance_id", logInstance);
      if (logLevel) params.set("level", logLevel);
      if (logSearchDebounced.trim()) params.set("search", logSearchDebounced.trim());
      if (statusFilter.trim()) params.set("status_code", statusFilter.trim());
      const qs = params.toString();
      const [ins, st] = await Promise.all([
        fetch(`/api/logs/insights?${qs}`).then((r) => r.json()),
        fetch("/api/logs/stats").then((r) => r.json()),
      ]);
      setInsights(ins as InsightsResponse);
      setLogStats(st as LogStatsResponse);
    } catch {
      setInsights({
        buckets: [],
        logs: [],
        summary: {
          total_errors: 0,
          total_requests: 0,
          peak_errors: 0,
          current_rate: 0,
        },
        error: "Failed to load log insights.",
      });
    } finally {
      setLoading(false);
    }
  }, [
    windowMinutes,
    logLimit,
    logInstance,
    logLevel,
    logSearchDebounced,
    statusFilter,
  ]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (pauseLive) return;
    const id = window.setInterval(() => void fetchAll(), POLL_MS);
    return () => window.clearInterval(id);
  }, [pauseLive, fetchAll]);

  const buckets = insights?.buckets ?? [];
  const summary = insights?.summary;

  const overallRate = useMemo(() => {
    const tr = summary?.total_requests ?? 0;
    const te = summary?.total_errors ?? 0;
    return tr > 0 ? (te / tr) * 100 : 0;
  }, [summary]);

  const rawLogs = insights?.logs ?? [];
  const displayLogs = useMemo(() => {
    const logs = insights?.logs ?? [];
    if (!showRequests && !showErrors) {
      return logs;
    }
    return logs.filter((row) => logRowMatchesSeries(row, showRequests, showErrors));
  }, [insights?.logs, showRequests, showErrors]);

  const seriesFilterActive = showRequests || showErrors;

  const clearData = async () => {
    setClearing(true);
    try {
      await fetch("/api/errors/clear", { method: "POST" });
      await fetchAll();
      setExpandedKeys(new Set());
    } catch {
      // ignore
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Kafka log cache</CardTitle>
          <CardDescription>
            Flask replicas publish structured logs; the dashboard backend keeps a ring buffer and
            persists to Postgres. Filters below apply to both the frequency chart and the log list.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {logStats?.error && (
            <p className="text-destructive mb-3 text-sm">
              {logStats.error}
              {logStats.hint ? ` — ${logStats.hint}` : ""}
            </p>
          )}
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="bg-muted/40 rounded-lg border p-3">
              <div className="text-muted-foreground text-xs">Buffered</div>
              <div className="text-lg font-semibold tabular-nums">
                {logStats?.buffered_logs ?? "—"}
              </div>
            </div>
            <div className="bg-muted/40 rounded-lg border p-3">
              <div className="text-muted-foreground text-xs">Total ingested</div>
              <div className="text-lg font-semibold tabular-nums">
                {logStats?.total_ingested ?? "—"}
              </div>
            </div>
            <div className="bg-muted/40 rounded-lg border p-3">
              <div className="text-muted-foreground text-xs">HTTP requests (tracked)</div>
              <div className="text-lg font-semibold tabular-nums">
                {logStats?.global?.total_requests ?? "—"}
              </div>
            </div>
            <div className="bg-muted/40 rounded-lg border p-3">
              <div className="text-muted-foreground text-xs">Global error rate</div>
              <div className="text-lg font-semibold tabular-nums">
                {logStats?.global != null
                  ? `${(logStats.global.error_rate * 100).toFixed(2)}%`
                  : "—"}
              </div>
            </div>
          </div>
          {logStats?.instances && Object.keys(logStats.instances).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(logStats.instances).map(([id, st]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setLogInstance(logInstance === id ? "" : id)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-left text-sm transition-colors",
                    logInstance === id
                      ? "border-primary bg-primary/10"
                      : "bg-background hover:bg-muted/60"
                  )}
                >
                  <div className="text-muted-foreground text-xs">{labelForInstanceId(id)}</div>
                  <div className="font-mono text-xs">
                    req {st.request_count} · err {st.error_count} · p(err){" "}
                    {(st.error_rate * 100).toFixed(1)}%
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Log frequency &amp; stream</CardTitle>
            <CardDescription>
              Per-minute HTTP request lines (green) and error count 4xx/5xx (red). Chart uses the same
              filters as the table. Polls every {POLL_MS / 1000}s.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
            <label className="text-muted-foreground flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={pauseLive}
                onChange={(e) => setPauseLive(e.target.checked)}
                className="accent-primary rounded border"
              />
              Pause
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => void fetchAll()}
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-muted-foreground text-xs">Window</label>
              <select
                className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                value={windowMinutes}
                onChange={(e) => setWindowMinutes(Number(e.target.value))}
              >
                <option value={15}>15 min</option>
                <option value={60}>60 min</option>
                <option value={120}>2 h</option>
                <option value={360}>6 h</option>
                <option value={720}>12 h</option>
                <option value={1440}>24 h</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-muted-foreground text-xs">Instance</label>
              <select
                className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                value={logInstance}
                onChange={(e) => setLogInstance(e.target.value)}
              >
                <option value="">All instances</option>
                <option value="1">Instance 1 (replica A)</option>
                <option value="2">Instance 2 (replica B)</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-muted-foreground text-xs">Level</label>
              <select
                className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                value={logLevel}
                onChange={(e) => setLogLevel(e.target.value)}
              >
                <option value="">Any</option>
                <option value="DEBUG">DEBUG</option>
                <option value="INFO">INFO</option>
                <option value="WARNING">WARNING</option>
                <option value="ERROR">ERROR</option>
              </select>
            </div>
            <div className="flex min-w-[100px] flex-col gap-1">
              <label className="text-muted-foreground text-xs">HTTP status</label>
              <input
                type="text"
                placeholder="200, 2xx, 404,500"
                className="border-input bg-background h-9 rounded-md border px-2 text-sm font-mono"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              />
            </div>
            <div className="flex min-w-[100px] flex-col gap-1">
              <label className="text-muted-foreground text-xs">Limit</label>
              <input
                type="number"
                min={1}
                max={10000}
                className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                value={logLimit}
                onChange={(e) => setLogLimit(Number.parseInt(e.target.value, 10) || 100)}
              />
            </div>
            <div className="flex min-w-[200px] flex-1 flex-col gap-1">
              <label className="text-muted-foreground text-xs">Search (message / logger / path)</label>
              <input
                type="search"
                placeholder="Filter…"
                className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="text-muted-foreground">Series:</span>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="accent-primary rounded border"
                checked={showRequests}
                onChange={(e) => setShowRequests(e.target.checked)}
              />
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" />
                Requests
              </span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="accent-primary rounded border"
                checked={showErrors}
                onChange={(e) => setShowErrors(e.target.checked)}
              />
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
                Errors
              </span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="accent-primary rounded border"
                checked={showErrorRate}
                onChange={(e) => setShowErrorRate(e.target.checked)}
              />
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-0.5 w-4 bg-amber-500"
                  style={{ borderTop: "2px dashed #f59e0b" }}
                />
                Error rate %
              </span>
            </label>
          </div>
          <p className="text-muted-foreground text-xs">
            Requests and Errors also filter the log table: Requests = non-error HTTP (status &lt; 400) and
            non-HTTP lines; Errors = HTTP 4xx/5xx. Uncheck both to show every line (no series filter).
          </p>

          {summary && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="bg-muted/40 rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">Recent error rate (last 5 min)</div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold tabular-nums">
                    {summary.current_rate.toFixed(2)}%
                  </span>
                  {summary.current_rate > 5 ? (
                    <Badge variant="destructive">High</Badge>
                  ) : summary.current_rate > 0 ? (
                    <Badge variant="secondary">Low</Badge>
                  ) : (
                    <Badge variant="outline">None</Badge>
                  )}
                </div>
              </div>
              <div className="bg-muted/40 rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">Errors in window</div>
                <div className="text-lg font-semibold tabular-nums text-red-500">
                  {summary.total_errors.toLocaleString()}
                </div>
              </div>
              <div className="bg-muted/40 rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">Requests in window (chart)</div>
                <div className="text-lg font-semibold tabular-nums">
                  {summary.total_requests.toLocaleString()}
                </div>
              </div>
              <div className="bg-muted/40 rounded-lg border p-3">
                <div className="text-muted-foreground text-xs">Peak errors / min</div>
                <div className="text-lg font-semibold tabular-nums">{summary.peak_errors}</div>
              </div>
            </div>
          )}

          {insights?.error && (
            <p className="text-destructive text-sm" role="alert">
              {insights.error}
              {insights.hint ? ` — ${insights.hint}` : ""}
            </p>
          )}

          {loading && buckets.length === 0 ? (
            <div className="text-muted-foreground flex h-[300px] items-center justify-center">
              Loading…
            </div>
          ) : buckets.length === 0 ? (
            <div className="text-muted-foreground flex h-[300px] items-center justify-center">
              No bucketed data for this window. Generate traffic or widen filters.
            </div>
          ) : (
            <div className="relative">
              <FrequencyGraph
                buckets={buckets}
                tooltip={tooltip}
                onHover={setTooltip}
                onLeave={() => setTooltip(null)}
                showRequests={showRequests}
                showErrors={showErrors}
                showErrorRate={showErrorRate}
              />
              {tooltip && <GraphTooltip data={tooltip} />}
            </div>
          )}

          <div className="text-muted-foreground flex flex-wrap items-center gap-4 text-xs">
            <span>
              Overall error rate (window): <strong>{overallRate.toFixed(2)}%</strong>
            </span>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium">Log entries</h3>
            <p className="text-muted-foreground mb-3 text-xs">
              Click rows to expand or collapse the full structured record (JSON). Multiple rows can
              stay open while the list refreshes. Request bodies are only present if the API logs
              them.
            </p>
            <div className="max-h-[min(55vh,520px)] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[36px]" />
                    <TableHead className="w-[168px]">Time</TableHead>
                    <TableHead className="w-[72px]">Level</TableHead>
                    <TableHead className="w-[72px]">Status</TableHead>
                    <TableHead className="w-[88px]">Instance</TableHead>
                    <TableHead className="w-[120px]">Request ID</TableHead>
                    <TableHead className="w-[220px]">Request</TableHead>
                    <TableHead className="w-[72px]">Duration</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rawLogs.length === 0 && !insights?.error && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-muted-foreground text-center py-8">
                        No matching log lines.
                      </TableCell>
                    </TableRow>
                  )}
                  {rawLogs.length > 0 &&
                    seriesFilterActive &&
                    displayLogs.length === 0 &&
                    !insights?.error && (
                      <TableRow>
                        <TableCell colSpan={9} className="text-muted-foreground text-center py-8">
                          No log lines match the selected series (Requests / Errors). Adjust the
                          checkboxes above or widen other filters.
                        </TableCell>
                      </TableRow>
                    )}
                  {displayLogs.map((row) => {
                    const k = stableLogRowKey(row);
                    const isOpen = expandedKeys.has(k);
                    const sc = row.status_code;
                    const code =
                      typeof sc === "number"
                        ? sc
                        : typeof sc === "string"
                          ? Number.parseInt(sc, 10)
                          : NaN;
                    return (
                      <Fragment key={k}>
                        <TableRow
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => {
                            setExpandedKeys((prev) => {
                              const next = new Set(prev);
                              if (next.has(k)) next.delete(k);
                              else next.add(k);
                              return next;
                            });
                          }}
                        >
                          <TableCell className="align-top">
                            {isOpen ? (
                              <ChevronDown className="size-4 opacity-70" />
                            ) : (
                              <ChevronRight className="size-4 opacity-70" />
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs whitespace-nowrap align-top">
                            {row.timestamp
                              ? new Date(String(row.timestamp)).toLocaleString()
                              : "—"}
                          </TableCell>
                          <TableCell className="align-top">
                            {logLevelBadge(
                              typeof row.level === "string" ? row.level : undefined
                            )}
                          </TableCell>
                          <TableCell className="align-top">
                            {!Number.isNaN(code) ? statusHttpBadge(code) : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs align-top">
                            {row.instance_id != null ? String(row.instance_id) : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs max-w-[120px] truncate align-top">
                            {row.request_id != null ? String(row.request_id) : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs align-top">
                            {row.method && row.path ? (
                              <span>
                                {String(row.method)} {String(row.path)}
                              </span>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs tabular-nums align-top">
                            {row.duration_ms != null ? `${String(row.duration_ms)}ms` : "—"}
                          </TableCell>
                          <TableCell className="max-w-[320px] text-xs break-words align-top">
                            {row.message != null ? String(row.message) : ""}
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow className="bg-muted/20 hover:bg-muted/20">
                            <TableCell colSpan={9} className="p-0">
                              <pre className="max-h-[min(50vh,400px)] overflow-auto p-4 text-left font-mono text-xs leading-relaxed">
                                {JSON.stringify(row, null, 2)}
                              </pre>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
