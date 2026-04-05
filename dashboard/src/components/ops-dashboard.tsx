"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  instanceIdFromComposeService,
  labelForInstanceId,
} from "@/lib/compose-instance";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";

const POLL_MS = 12_000;
const LOG_POLL_MS = 2_500;

type DockerContainer = {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  service: string;
  health?: string;
  created: number;
  cpuPercent?: number;
  memUsage?: number;
  memLimit?: number;
  railwayServiceId?: string;
};

/** Response from dashboard-backend GET /api/introspect/postgres (proxied). */
type PostgresIntrospectResponse = {
  databases: string[];
  tables_by_database: Record<string, string[]>;
  dashboard_db_present: boolean;
  errors: { scope: string; message: string }[];
};

/** Rows where introspection matches dashboard-backend DB credentials (same server). */
function isPostgresIntrospectRow(
  source: string | undefined,
  service: string
): boolean {
  const s = (service || "").toLowerCase();
  if (source === "railway") return s === "postgres";
  if (source === "docker") return s === "dashboard-db";
  return false;
}

type DockerResponse = {
  source?: "docker" | "railway";
  project: string;
  projectId?: string;
  containers: DockerContainer[];
  error?: string;
};

type PodRow = {
  name: string;
  namespace: string;
  phase: string;
  ready: string;
  restarts: number;
  age: string;
};

type PodsResponse = {
  enabled: boolean;
  namespace: string;
  /** When true, listing used listPodForAllNamespaces; namespace field is "*". */
  allNamespaces?: boolean;
  pods: PodRow[];
  message?: string;
  error?: string;
};

type AlertRow = {
  name: string;
  severity?: string;
  state?: string;
  startsAt?: string;
  summary?: string;
  description?: string;
  instance?: string;
};

type AlertsResponse = {
  alerts: AlertRow[];
  error?: string;
};

type LogEntry = {
  timestamp?: string;
  level?: string;
  logger?: string;
  message?: string;
  instance_id?: string;
  request_id?: string;
  method?: string;
  path?: string;
  status_code?: number;
  duration_ms?: number;
};

type LogsApiResponse = {
  logs: LogEntry[];
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

function formatBytes(n: number | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function stateBadge(state: string, health?: string) {
  const s = state.toLowerCase();
  if (s === "running") {
    if (health === "unhealthy")
      return (
        <Badge variant="destructive" className="capitalize">
          unhealthy
        </Badge>
      );
    if (health === "healthy" || health === "starting")
      return (
        <Badge variant="secondary" className="capitalize">
          {health}
        </Badge>
      );
    return (
      <Badge variant="default" className="capitalize">
        running
      </Badge>
    );
  }
  if (s === "exited" || s === "dead")
    return (
      <Badge variant="destructive" className="capitalize">
        {state}
      </Badge>
    );
  return (
    <Badge variant="outline" className="capitalize">
      {state}
    </Badge>
  );
}

function logLevelBadge(level: string | undefined) {
  const l = (level ?? "INFO").toUpperCase();
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
      {l}
    </Badge>
  );
}

export function OpsDashboard() {
  const [docker, setDocker] = useState<DockerResponse | null>(null);
  const [pods, setPods] = useState<PodsResponse | null>(null);
  const [alerts, setAlerts] = useState<AlertsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [includeStats, setIncludeStats] = useState(false);
  const [k8sAllNamespaces, setK8sAllNamespaces] = useState(false);

  const [mainTab, setMainTab] = useState("containers");
  const [logData, setLogData] = useState<LogsApiResponse | null>(null);
  const [logStats, setLogStats] = useState<LogStatsResponse | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logInstance, setLogInstance] = useState<string>("");
  const [logLevel, setLogLevel] = useState<string>("");
  const [logSearch, setLogSearch] = useState("");
  const [logSearchDebounced, setLogSearchDebounced] = useState("");
  const [logLimit, setLogLimit] = useState(200);
  const [pauseLive, setPauseLive] = useState(false);

  const [pgDetailKey, setPgDetailKey] = useState<string | null>(null);
  const [pgData, setPgData] = useState<PostgresIntrospectResponse | null>(null);
  const [pgLoading, setPgLoading] = useState(false);
  const [pgError, setPgError] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setLogSearchDebounced(logSearch), 400);
    return () => window.clearTimeout(t);
  }, [logSearch]);

  const promUrl =
    process.env.NEXT_PUBLIC_PROMETHEUS_URL ?? "http://localhost:9090";
  const amPublicUrl =
    process.env.NEXT_PUBLIC_ALERTMANAGER_PUBLIC_URL ??
    "http://localhost:9093";

  const fetchAll = useCallback(async () => {
    setError(null);
    const qs = includeStats ? "?stats=1" : "";
    const podsUrl = k8sAllNamespaces
      ? "/api/visibility/k8s/pods?allNamespaces=1"
      : "/api/visibility/k8s/pods";
    try {
      const [d, p, a] = await Promise.all([
        fetch(`/api/visibility/docker${qs}`).then((r) => r.json()),
        fetch(podsUrl).then((r) => r.json()),
        fetch("/api/visibility/alerts").then((r) => r.json()),
      ]);
      setDocker(d as DockerResponse);
      setPods(p as PodsResponse);
      setAlerts(a as AlertsResponse);
      setLastFetch(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [includeStats, k8sAllNamespaces]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    const id = window.setInterval(() => fetchAll(), POLL_MS);
    return () => window.clearInterval(id);
  }, [fetchAll]);

  const fetchLogs = useCallback(async () => {
    setLogLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(Math.min(1000, Math.max(1, logLimit))));
      if (logInstance) params.set("instance_id", logInstance);
      if (logLevel) params.set("level", logLevel);
      if (logSearchDebounced.trim()) params.set("search", logSearchDebounced.trim());
      const qs = params.toString();
      const [l, s] = await Promise.all([
        fetch(`/api/logs?${qs}`).then((r) => r.json()),
        fetch("/api/logs/stats").then((r) => r.json()),
      ]);
      setLogData(l as LogsApiResponse);
      setLogStats(s as LogStatsResponse);
    } catch (e) {
      setLogData({
        logs: [],
        error: e instanceof Error ? e.message : "Failed to load logs",
      });
    } finally {
      setLogLoading(false);
    }
  }, [logLimit, logInstance, logLevel, logSearchDebounced]);

  useEffect(() => {
    if (mainTab !== "logs") return;
    void fetchLogs();
  }, [mainTab, fetchLogs]);

  useEffect(() => {
    if (mainTab !== "logs" || pauseLive) return;
    const id = window.setInterval(() => void fetchLogs(), LOG_POLL_MS);
    return () => window.clearInterval(id);
  }, [mainTab, pauseLive, fetchLogs]);

  const loadPostgresIntrospect = useCallback(async () => {
    setPgLoading(true);
    setPgError(null);
    try {
      const res = await fetch("/api/ops/postgres-introspect");
      const j = (await res.json()) as PostgresIntrospectResponse & {
        error?: string;
        hint?: string;
      };
      if (!res.ok) {
        setPgError(j.error ?? `HTTP ${res.status}`);
        setPgData(null);
        return;
      }
      setPgData(j);
    } catch (e) {
      setPgError(e instanceof Error ? e.message : "Request failed");
      setPgData(null);
    } finally {
      setPgLoading(false);
    }
  }, []);

  const sortedContainers = useMemo(() => {
    const list = docker?.containers ?? [];
    return [...list].sort((a, b) =>
      (a.service || a.name).localeCompare(b.service || b.name)
    );
  }, [docker]);

  const showDockerStats =
    includeStats && docker?.source !== "railway";

  const serviceTableColCount = showDockerStats ? 9 : 6;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ops</h1>
          <p className="text-muted-foreground text-sm">
            Compose / Railway, Kubernetes, Alertmanager, and Kafka log stream (
            {mainTab === "logs"
              ? `logs ~${LOG_POLL_MS / 1000}s`
              : `${POLL_MS / 1000}s`}{" "}
            refresh)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {docker?.source !== "railway" && (
            <label className="text-muted-foreground flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeStats}
                onChange={(e) => setIncludeStats(e.target.checked)}
                className="accent-primary rounded border"
              />
              Docker stats
            </label>
          )}
          <label className="text-muted-foreground flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={k8sAllNamespaces}
              onChange={(e) => setK8sAllNamespaces(e.target.checked)}
              className="accent-primary rounded border"
            />
            K8s all namespaces
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setLoading(true);
              void fetchAll();
            }}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
      {lastFetch && (
        <p className="text-muted-foreground text-xs">
          Last updated: {lastFetch.toLocaleTimeString()}
        </p>
      )}

      <Tabs
        value={mainTab}
        onValueChange={setMainTab}
        className="gap-4"
      >
        <TabsList variant="line">
          <TabsTrigger value="containers">Containers</TabsTrigger>
          <TabsTrigger value="pods">Pods</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="telemetry">Telemetry</TabsTrigger>
        </TabsList>

        <TabsContent value="containers" className="space-y-2">
          <Card>
            <CardHeader>
              <CardTitle>
                {docker?.source === "railway" ? "Railway services" : "Docker"}
              </CardTitle>
              <CardDescription>
                {docker?.source === "railway" ? (
                  <>
                    Project{" "}
                    <span className="text-foreground font-mono">
                      {docker?.project ?? "—"}
                    </span>
                    {docker?.projectId && (
                      <>
                        {" "}
                        <span className="text-muted-foreground">·</span>{" "}
                        <a
                          className="text-primary hover:underline"
                          href={`https://railway.com/project/${docker.projectId}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open in Railway
                        </a>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    Compose project{" "}
                    <span className="text-foreground font-mono">
                      {docker?.project ?? "—"}
                    </span>
                  </>
                )}
                {docker?.error && (
                  <span className="text-destructive"> — {docker.error}</span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead>
                      {docker?.source === "railway" ? "Deployment" : "Container"}
                    </TableHead>
                    <TableHead>Image</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[120px]">App logs</TableHead>
                    {showDockerStats && (
                      <>
                        <TableHead>CPU %</TableHead>
                        <TableHead>Memory</TableHead>
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedContainers.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={serviceTableColCount}
                        className="text-muted-foreground"
                      >
                        {docker?.source === "railway"
                          ? "No Railway services returned, or the Railway API request failed (check dashboard service variables: RAILWAY_PROJECT_ID, RAILWAY_ENVIRONMENT_ID, and a token)."
                          : "No containers for this Compose project, or Docker API unreachable."}
                      </TableCell>
                    </TableRow>
                  )}
                  {sortedContainers.flatMap((c) => {
                    const showPg = isPostgresIntrospectRow(
                      docker?.source,
                      c.service
                    );
                    const pgOpen = showPg && pgDetailKey === c.id;
                    const mainRow = (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-1">
                            {showPg ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 shrink-0 p-0"
                                aria-expanded={pgOpen}
                                aria-label={
                                  pgOpen
                                    ? "Collapse database details"
                                    : "Expand database list and tables"
                                }
                                onClick={() => {
                                  if (pgOpen) {
                                    setPgDetailKey(null);
                                    return;
                                  }
                                  setPgDetailKey(c.id);
                                  void loadPostgresIntrospect();
                                }}
                              >
                                {pgOpen ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </Button>
                            ) : null}
                            <span>{c.service || "—"}</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{c.name}</TableCell>
                        <TableCell className="max-w-[200px] truncate text-xs">
                          {c.image}
                        </TableCell>
                        <TableCell>{stateBadge(c.state, c.health)}</TableCell>
                        <TableCell className="max-w-[240px] truncate text-xs">
                          {c.status}
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const iid = instanceIdFromComposeService(c.service);
                            if (!iid)
                              return <span className="text-muted-foreground">—</span>;
                            return (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="text-xs"
                                onClick={() => {
                                  setLogInstance(iid);
                                  setMainTab("logs");
                                }}
                              >
                                Instance {iid}
                              </Button>
                            );
                          })()}
                        </TableCell>
                        {showDockerStats && (
                          <>
                            <TableCell>
                              {c.cpuPercent != null
                                ? `${c.cpuPercent.toFixed(1)}%`
                                : "—"}
                            </TableCell>
                            <TableCell className="text-xs">
                              {formatBytes(c.memUsage)}
                              {c.memLimit ? ` / ${formatBytes(c.memLimit)}` : ""}
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    );
                    if (!pgOpen) return [mainRow];
                    const detailRow = (
                      <TableRow key={`${c.id}-pg-detail`}>
                        <TableCell
                          colSpan={serviceTableColCount}
                          className="bg-muted/40 align-top"
                        >
                          <div className="space-y-3 py-1">
                            <p className="text-muted-foreground text-xs">
                              Databases and tables on the{" "}
                              <span className="font-mono">same Postgres server</span> as{" "}
                              <span className="font-mono">dashboard-backend</span> (
                              <span className="font-mono">DASHBOARD_DATABASE_URL</span>
                              ). Railway: usually includes{" "}
                              <span className="font-mono">dashboard_db</span> alongside the
                              default DB.
                            </p>
                            {pgLoading && (
                              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Loading…
                              </div>
                            )}
                            {pgError && (
                              <p className="text-destructive text-sm" role="alert">
                                {pgError}
                              </p>
                            )}
                            {!pgLoading && !pgError && pgData && (
                              <>
                                <div>
                                  <div className="mb-1 text-sm font-medium">
                                    Databases on this server
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {pgData.databases.map((d) => (
                                      <Badge
                                        key={d}
                                        variant={
                                          d === "dashboard_db" ? "default" : "secondary"
                                        }
                                        className="font-mono text-xs"
                                      >
                                        {d}
                                        {d === "dashboard_db" ? " (dashboard)" : ""}
                                      </Badge>
                                    ))}
                                  </div>
                                  {!pgData.dashboard_db_present && (
                                    <p className="text-muted-foreground mt-2 text-xs">
                                      <span className="font-mono">dashboard_db</span> not
                                      found — create it on this instance (see RAILWAY.md) or
                                      check{" "}
                                      <span className="font-mono">DASHBOARD_DB_NAME</span>.
                                    </p>
                                  )}
                                </div>
                                {Object.keys(pgData.tables_by_database).length > 0 && (
                                  <div className="space-y-2">
                                    <div className="text-sm font-medium">
                                      Public tables by database
                                    </div>
                                    {Object.entries(pgData.tables_by_database).map(
                                      ([db, tables]) => (
                                        <div key={db}>
                                          <div className="text-muted-foreground font-mono text-xs">
                                            {db}
                                          </div>
                                          {pgData.errors.some(
                                            (e) => e.scope === `tables:${db}`
                                          ) ? (
                                            <p className="text-destructive text-xs">
                                              Could not list tables (
                                              {
                                                pgData.errors.find(
                                                  (e) => e.scope === `tables:${db}`
                                                )?.message
                                              }
                                              )
                                            </p>
                                          ) : tables.length === 0 ? (
                                            <p className="text-muted-foreground text-xs">
                                              — no tables in public schema —
                                            </p>
                                          ) : (
                                            <ul className="mt-1 flex list-none flex-wrap gap-x-3 gap-y-0.5 pl-0 text-xs">
                                              {tables.map((t) => (
                                                <li key={`${db}.${t}`} className="font-mono">
                                                  {t}
                                                </li>
                                              ))}
                                            </ul>
                                          )}
                                        </div>
                                      )
                                    )}
                                  </div>
                                )}
                                {pgData.errors.length > 0 && (
                                  <div className="text-muted-foreground text-xs">
                                    {pgData.errors.map((err, idx) => (
                                      <div key={`${err.scope}-${idx}`}>
                                        <span className="font-mono">{err.scope}</span>:{" "}
                                        {err.message}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                    return [mainRow, detailRow];
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pods">
          <Card>
            <CardHeader>
              <CardTitle>Kubernetes</CardTitle>
              <CardDescription>
                {pods?.allNamespaces ? (
                  <>
                    All namespaces (<span className="font-mono">*</span>)
                  </>
                ) : (
                  <>
                    Namespace{" "}
                    <span className="text-foreground font-mono">
                      {pods?.namespace ?? "pe-hackathon"}
                    </span>
                  </>
                )}
                {pods?.enabled === false && (
                  <span> — {pods.message}</span>
                )}
                {pods?.enabled !== false &&
                  !pods?.error &&
                  (pods?.pods?.length ?? 0) > 0 && (
                    <span className="text-muted-foreground">
                      {" "}
                      — {(pods?.pods ?? []).length} pod
                      {(pods?.pods ?? []).length === 1 ? "" : "s"}
                    </span>
                  )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {pods?.enabled && pods?.error && (
                <p className="text-destructive mb-4 text-sm" role="alert">
                  {pods.error}
                </p>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    {pods?.allNamespaces && (
                      <TableHead>Namespace</TableHead>
                    )}
                    <TableHead>Name</TableHead>
                    <TableHead>Phase</TableHead>
                    <TableHead>Ready</TableHead>
                    <TableHead>Restarts</TableHead>
                    <TableHead>Age</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(pods?.pods ?? []).length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={pods?.allNamespaces ? 6 : 5}
                        className="text-muted-foreground"
                      >
                        {pods?.enabled === false
                          ? "Enable VISIBILITY_K8S_ENABLED and mount kubeconfig to list pods. For npm run dev, set dashboard/.env.local (see dashboard/README.md)."
                          : pods?.error
                            ? "Could not list pods (see error above)."
                            : pods?.allNamespaces
                              ? "No pods in the cluster (or API returned an empty list)."
                              : "No pods in this namespace. Deploy with kubectl apply -k k8s/, confirm the namespace exists (kubectl get ns), or enable “K8s all namespaces” if workloads run elsewhere."}
                      </TableCell>
                    </TableRow>
                  )}
                  {(pods?.pods ?? []).map((p) => (
                    <TableRow key={`${p.namespace}/${p.name}`}>
                      {pods?.allNamespaces && (
                        <TableCell className="font-mono text-xs">
                          {p.namespace}
                        </TableCell>
                      )}
                      <TableCell className="font-mono text-xs">{p.name}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            p.phase === "Running" ? "default" : "secondary"
                          }
                          className="capitalize"
                        >
                          {p.phase}
                        </Badge>
                      </TableCell>
                      <TableCell>{p.ready}</TableCell>
                      <TableCell>{p.restarts}</TableCell>
                      <TableCell>{p.age}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alerts">
          <Card>
            <CardHeader>
              <CardTitle>Active alerts</CardTitle>
              <CardDescription>
                From Alertmanager API (same data as the Incidents strip).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {alerts?.error && (
                <p className="text-destructive mb-2 text-sm">{alerts.error}</p>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Alert</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Since</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(alerts?.alerts ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-muted-foreground">
                        No active alerts (or Alertmanager unreachable).
                      </TableCell>
                    </TableRow>
                  )}
                  {(alerts?.alerts ?? []).map((row, i) => (
                    <TableRow key={`${row.name}-${i}`}>
                      <TableCell className="max-w-[280px]">
                        <div className="font-medium">{row.name}</div>
                        {row.summary && (
                          <div className="text-muted-foreground text-xs">
                            {row.summary}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            row.severity === "critical"
                              ? "destructive"
                              : "outline"
                          }
                          className={cn("capitalize")}
                        >
                          {row.severity ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell>{row.state ?? "—"}</TableCell>
                      <TableCell className="text-xs whitespace-normal">
                        {row.startsAt
                          ? new Date(row.startsAt).toLocaleString()
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Kafka log cache</CardTitle>
              <CardDescription>
                Flask replicas publish structured logs to Kafka; the dashboard
                backend keeps a ring buffer and aggregates per{" "}
                <span className="font-mono">instance_id</span> (same as API
                replicas 1 and 2).
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
              {logStats?.instances &&
                Object.keys(logStats.instances).length > 0 && (
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
                        <div className="text-muted-foreground text-xs">
                          {labelForInstanceId(id)}
                        </div>
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
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <CardTitle>Live stream</CardTitle>
                <CardDescription>
                  Filter by replica, level, or text. Pause stops auto-refresh;
                  Refresh runs once.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
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
                  disabled={logLoading}
                  onClick={() => void fetchLogs()}
                >
                  {logLoading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3">
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
                <div className="flex min-w-[120px] flex-col gap-1">
                  <label className="text-muted-foreground text-xs">Limit</label>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                    value={logLimit}
                    onChange={(e) =>
                      setLogLimit(Number.parseInt(e.target.value, 10) || 100)
                    }
                  />
                </div>
                <div className="flex min-w-[200px] flex-1 flex-col gap-1">
                  <label className="text-muted-foreground text-xs">
                    Search (message / logger / path)
                  </label>
                  <input
                    type="search"
                    placeholder="Filter…"
                    className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                    value={logSearch}
                    onChange={(e) => setLogSearch(e.target.value)}
                  />
                </div>
              </div>

              {logData?.error && (
                <p className="text-destructive text-sm" role="alert">
                  {logData.error}
                  {logData.hint ? ` — ${logData.hint}` : ""}
                </p>
              )}

              <div className="max-h-[min(60vh,520px)] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[180px]">Time</TableHead>
                      <TableHead className="w-[72px]">Level</TableHead>
                      <TableHead className="w-[88px]">Instance</TableHead>
                      <TableHead className="w-[140px]">Logger</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead className="w-[200px]">Request</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(logData?.logs ?? []).length === 0 && !logData?.error && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-muted-foreground">
                          No log lines in cache. Generate traffic against the API
                          (via load balancer) and ensure{" "}
                          <span className="font-mono">dashboard-backend</span> is
                          running.
                        </TableCell>
                      </TableRow>
                    )}
                    {(logData?.logs ?? []).map((row, idx) => (
                      <TableRow key={`${row.timestamp}-${idx}`}>
                        <TableCell className="font-mono text-xs whitespace-nowrap">
                          {row.timestamp
                            ? new Date(row.timestamp).toLocaleString()
                            : "—"}
                        </TableCell>
                        <TableCell>{logLevelBadge(row.level)}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {row.instance_id ?? "—"}
                        </TableCell>
                        <TableCell className="max-w-[140px] truncate text-xs">
                          {row.logger ?? "—"}
                        </TableCell>
                        <TableCell className="max-w-[360px] text-xs break-words whitespace-pre-wrap">
                          {row.message ?? ""}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {row.method && row.path ? (
                            <span>
                              {row.method} {row.path}
                              {row.status_code != null ? (
                                <span className="text-muted-foreground">
                                  {" "}
                                  → {row.status_code}
                                </span>
                              ) : null}
                              {row.duration_ms != null ? (
                                <span className="text-muted-foreground">
                                  {" "}
                                  ({row.duration_ms}ms)
                                </span>
                              ) : null}
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="telemetry">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Prometheus</CardTitle>
                <CardDescription>
                  Metrics and PromQL console (opens in a new tab).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <a
                  href={`${promUrl.replace(/\/$/, "")}/graph`}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "inline-flex gap-1.5"
                  )}
                >
                  Open Prometheus
                  <ExternalLink className="size-3.5" />
                </a>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Alertmanager</CardTitle>
                <CardDescription>
                  Silences and alert groups in the UI.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <a
                  href={amPublicUrl.replace(/\/$/, "")}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "inline-flex gap-1.5"
                  )}
                >
                  Open Alertmanager
                  <ExternalLink className="size-3.5" />
                </a>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
