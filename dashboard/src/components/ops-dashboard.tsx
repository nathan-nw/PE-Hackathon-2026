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
import { cn } from "@/lib/utils";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";

const POLL_MS = 12_000;

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
};

type DockerResponse = {
  project: string;
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

export function OpsDashboard() {
  const [docker, setDocker] = useState<DockerResponse | null>(null);
  const [pods, setPods] = useState<PodsResponse | null>(null);
  const [alerts, setAlerts] = useState<AlertsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [includeStats, setIncludeStats] = useState(false);
  const [k8sAllNamespaces, setK8sAllNamespaces] = useState(false);

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

  const sortedContainers = useMemo(() => {
    const list = docker?.containers ?? [];
    return [...list].sort((a, b) =>
      (a.service || a.name).localeCompare(b.service || b.name)
    );
  }, [docker]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ops</h1>
          <p className="text-muted-foreground text-sm">
            Compose runtime, Kubernetes pods, and active alerts (
            {POLL_MS / 1000}s refresh)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-muted-foreground flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeStats}
              onChange={(e) => setIncludeStats(e.target.checked)}
              className="accent-primary rounded border"
            />
            Docker stats
          </label>
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

      <Tabs defaultValue="containers" className="gap-4">
        <TabsList variant="line">
          <TabsTrigger value="containers">Containers</TabsTrigger>
          <TabsTrigger value="pods">Pods</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
          <TabsTrigger value="telemetry">Telemetry</TabsTrigger>
        </TabsList>

        <TabsContent value="containers" className="space-y-2">
          <Card>
            <CardHeader>
              <CardTitle>Docker</CardTitle>
              <CardDescription>
                Project{" "}
                <span className="text-foreground font-mono">
                  {docker?.project ?? "—"}
                </span>
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
                    <TableHead>Container</TableHead>
                    <TableHead>Image</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Status</TableHead>
                    {includeStats && (
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
                        colSpan={includeStats ? 8 : 5}
                        className="text-muted-foreground"
                      >
                        No containers for this Compose project, or Docker API
                        unreachable.
                      </TableCell>
                    </TableRow>
                  )}
                  {sortedContainers.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">
                        {c.service || "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{c.name}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs">
                        {c.image}
                      </TableCell>
                      <TableCell>{stateBadge(c.state, c.health)}</TableCell>
                      <TableCell className="max-w-[240px] truncate text-xs">
                        {c.status}
                      </TableCell>
                      {includeStats && (
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
                  ))}
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
