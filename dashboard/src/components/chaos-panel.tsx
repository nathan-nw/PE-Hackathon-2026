"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { Loader2, RefreshCw, RotateCcw, Skull } from "lucide-react";

import type { WatchdogPayload } from "@/lib/watchdog-types";
import { WatchdogToastStack } from "@/components/watchdog-toast-stack";

type ChaosAction = "kill" | "restart";

/** Mirrors server default allowlist if /chaos/config omits allowedServices. */
const FALLBACK_ALLOWED_SERVICES = [
  "db",
  "redis",
  "zookeeper",
  "kafka",
  "kafka-log-consumer",
  "url-shortener-a",
  "url-shortener-b",
  "load-balancer",
  "prometheus",
  "alertmanager",
  "db-backup",
  "dashboard-db",
  "dashboard-backend",
  "user-frontend",
] as const;

type DockerContainer = {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  service: string;
  health?: string;
  /** Set when Ops visibility source is Railway (GraphQL). */
  railwayServiceId?: string;
  railwayDeploymentId?: string;
};

type DockerResponse = {
  source?: "docker" | "railway";
  project: string;
  containers: DockerContainer[];
  error?: string;
};

type ChaosConfig = {
  killEnabled: boolean;
  supportsDockerKill: boolean;
  blockedServices: string[];
  allowedServices: string[];
  hint: string | null;
};

type ChaosStatus = {
  found: boolean;
  source?: "docker" | "railway";
  containerId?: string;
  name?: string;
  service?: string;
  state?: string;
  running?: boolean;
  restarting?: boolean;
  exitCode?: number;
  restartCount?: number;
  restartPolicy?: string;
  health?: string;
  startedAt?: string;
  deploymentStatus?: string;
  statusLine?: string;
  message?: string;
  error?: string;
};

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

export function ChaosPanel() {
  const [docker, setDocker] = useState<DockerResponse | null>(null);
  const [config, setConfig] = useState<ChaosConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingChaos, setPendingChaos] = useState<{
    container: DockerContainer;
    action: ChaosAction;
  } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [chaosBusy, setChaosBusy] = useState(false);
  const [chaosError, setChaosError] = useState<string | null>(null);

  const [watchService, setWatchService] = useState<string | null>(null);
  const [watchStatus, setWatchStatus] = useState<ChaosStatus | null>(null);
  const [watchError, setWatchError] = useState<string | null>(null);

  const [watchdog, setWatchdog] = useState<WatchdogPayload | null>(null);
  const [watchdogProgress, setWatchdogProgress] = useState(0);
  const [watchdogToasts, setWatchdogToasts] = useState<
    { id: string; message: string; at: string }[]
  >([]);
  const seenWatchdogEventIds = useRef<Set<string>>(new Set());
  /** Skip toasting historical events on first successful load. */
  const watchdogHydrated = useRef(false);

  const fetchDocker = useCallback(async () => {
    setLoading(true);
    try {
      const [d, c] = await Promise.all([
        fetch("/api/visibility/docker").then((r) => r.json()),
        fetch("/api/visibility/docker/chaos/config").then((r) => r.json()),
      ]);
      setDocker(d as DockerResponse);
      setConfig(c as ChaosConfig);
    } catch {
      setDocker({ project: "", containers: [], error: "Failed to load containers" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDocker();
  }, [fetchDocker]);

  const fetchWatchdog = useCallback(async () => {
    try {
      const res = await fetch("/api/visibility/docker/chaos/watchdog");
      const j = (await res.json()) as WatchdogPayload;
      if (!res.ok) {
        setWatchdog(j);
        return;
      }
      setWatchdog(j);

      if (!watchdogHydrated.current && (j.source === "docker" || j.source === "railway")) {
        watchdogHydrated.current = true;
        for (const ev of j.events) {
          seenWatchdogEventIds.current.add(ev.id);
        }
        return;
      }

      for (const ev of j.events) {
        if (seenWatchdogEventIds.current.has(ev.id)) continue;
        seenWatchdogEventIds.current.add(ev.id);
        setWatchdogToasts((prev) => {
          const next = [{ id: ev.id, message: ev.message, at: ev.at }, ...prev];
          return next.slice(0, 6);
        });
      }
    } catch {
      setWatchdog({
        source: "error",
        intervalSec: 15,
        lastTickAt: null,
        instancesMonitored: 0,
        events: [],
        error: "Failed to load watchdog status",
      });
    }
  }, []);

  useEffect(() => {
    void fetchWatchdog();
    const id = window.setInterval(() => void fetchWatchdog(), 2000);
    return () => window.clearInterval(id);
  }, [fetchWatchdog]);

  useEffect(() => {
    if (!watchdog) return;
    const ms = Math.max(1000, watchdog.intervalSec * 1000);
    const compute = () => {
      if (watchdog.source === "railway") {
        setWatchdogProgress((Date.now() % ms) / ms);
        return;
      }
      if (watchdog.lastTickAt) {
        const base = new Date(watchdog.lastTickAt).getTime();
        setWatchdogProgress(Math.min(1, Math.max(0, (Date.now() - base) / ms)));
        return;
      }
      setWatchdogProgress((Date.now() % ms) / ms);
    };
    compute();
    const id = window.setInterval(compute, 200);
    return () => window.clearInterval(id);
  }, [watchdog]);

  const fetchStatus = useCallback(async (service: string) => {
    setWatchError(null);
    try {
      const res = await fetch(
        `/api/visibility/docker/chaos/status?service=${encodeURIComponent(service)}`
      );
      const j = (await res.json()) as ChaosStatus & { error?: string };
      if (!res.ok) {
        setWatchError(j.error ?? `HTTP ${res.status}`);
        setWatchStatus(null);
        return;
      }
      setWatchStatus(j);
    } catch (e) {
      setWatchError(e instanceof Error ? e.message : "Request failed");
      setWatchStatus(null);
    }
  }, []);

  useEffect(() => {
    if (!watchService) return;
    void fetchStatus(watchService);
    const id = window.setInterval(() => void fetchStatus(watchService), 2000);
    return () => window.clearInterval(id);
  }, [watchService, fetchStatus]);

  const openChaos = (c: DockerContainer, action: ChaosAction) => {
    setChaosError(null);
    setConfirmText("");
    setPendingChaos({ container: c, action });
  };

  const submitChaos = async () => {
    if (!pendingChaos) return;
    const { container, action } = pendingChaos;
    const svc = container.service.trim().toLowerCase();
    const serviceWatch = container.service;
    if (confirmText.trim().toLowerCase() !== svc) {
      setChaosError("Type the exact service name to confirm.");
      return;
    }
    setChaosBusy(true);
    setChaosError(null);
    const url =
      action === "kill"
        ? "/api/visibility/docker/chaos/kill"
        : "/api/visibility/docker/chaos/restart";
    const railwayServiceId = container.railwayServiceId?.trim();
    const isRailway = Boolean(docker?.source === "railway" && railwayServiceId);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isRailway
            ? {
                railwayServiceId,
                confirmService: svc,
              }
            : {
                containerId: container.id,
                confirmService: svc,
              }
        ),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setChaosError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setPendingChaos(null);
      setConfirmText("");
      setWatchService(serviceWatch);
      void fetchDocker();
    } catch (e) {
      setChaosError(
        e instanceof Error ? e.message : action === "kill" ? "Kill failed" : "Restart failed"
      );
    } finally {
      setChaosBusy(false);
    }
  };

  const sorted = [...(docker?.containers ?? [])].sort((a, b) =>
    (a.service || a.name).localeCompare(b.service || b.name)
  );

  const visibilityOk =
    (docker?.source === "docker" || docker?.source === "railway") &&
    !docker?.error;
  const showKill =
    Boolean(config?.supportsDockerKill) &&
    Boolean(config?.killEnabled) &&
    visibilityOk;

  const allowedRaw =
    config?.allowedServices && config.allowedServices.length > 0
      ? config.allowedServices
      : [...FALLBACK_ALLOWED_SERVICES];
  const allowedSet = new Set(allowedRaw.map((s) => s.toLowerCase()));

  const dismissWatchdogToast = useCallback((id: string) => {
    setWatchdogToasts((prev) => prev.filter((n) => n.id !== id));
  }, []);

  return (
    <div className="space-y-4">
      <WatchdogToastStack toasts={watchdogToasts} onDismiss={dismissWatchdogToast} />
      <Card>
        <CardHeader>
          <CardTitle>Watchdog</CardTitle>
          <CardDescription>
            {!watchdog
              ? "Loading watchdog status…"
              : watchdog.source === "railway"
                ? "Polling Railway deployment status. When a deployment is CRASHED, FAILED, or REMOVED, the watchdog can trigger serviceInstanceDeploy(latest) to recover (disable with RAILWAY_WATCHDOG_AUTO_RECOVER=0). Toasts fire for recoveries and redeploys; recent poll lines are below."
                : "Local stack: the compose-watchdog service scans Compose containers on each interval (starts exited tasks, restarts unhealthy ones). Alerts appear at the top-right when it acts."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {watchdog?.source === "unconfigured" ? (
            <p className="text-muted-foreground text-sm">
              {watchdog.error ??
                "Configure Railway API token for hosted watchdog, or run Compose for Docker watchdog."}
            </p>
          ) : (
            watchdog?.error && (
              <p className="text-destructive text-sm" role="alert">
                {watchdog.error}
              </p>
            )
          )}
          {watchdog && !watchdog.error && watchdog.source !== "unconfigured" && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">
                  Scanning{" "}
                  <span className="text-foreground font-mono tabular-nums">
                    {watchdog.instancesMonitored}
                  </span>{" "}
                  {watchdog.source === "railway" ? "Railway services" : "containers"} · every{" "}
                  {watchdog.intervalSec}s
                </span>
                <span className="text-muted-foreground font-mono text-xs">
                  {Math.round(watchdogProgress * 100)}%
                </span>
              </div>
              <div
                className="bg-muted h-2 w-full overflow-hidden rounded-full"
                role="progressbar"
                aria-valuenow={Math.round(watchdogProgress * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="bg-primary h-full rounded-full transition-[width] duration-200 ease-linear"
                  style={{ width: `${Math.min(100, watchdogProgress * 100)}%` }}
                />
              </div>
            </>
          )}
          {watchdog?.logTail &&
            watchdog.logTail.length > 0 &&
            watchdog.source !== "unconfigured" && (
              <details className="text-sm">
                <summary className="text-muted-foreground cursor-pointer select-none">
                  Watchdog log (recent)
                  {watchdog.source === "railway" ? " — Railway polls" : " — compose-watchdog"}
                </summary>
                <pre className="bg-muted/60 mt-2 max-h-40 overflow-auto rounded-md p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                  {watchdog.logTail.join("\n")}
                </pre>
              </details>
            )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>
              {docker?.source === "railway"
                ? "Service chaos (Railway)"
                : "Container chaos (local Docker)"}
            </CardTitle>
            <CardDescription>
              {docker?.source === "railway" ? (
                <>
                  <span className="font-mono">Reboot</span> calls Railway{" "}
                  <span className="font-mono">deploymentRestart</span> on the active deployment.{" "}
                  <span className="font-mono">Kill</span> calls{" "}
                  <span className="font-mono">deploymentStop</span> — traffic fails until the watchdog
                  runs <span className="font-mono">serviceInstanceDeploy(latest)</span> (see Watchdog card;
                  set <span className="font-mono">RAILWAY_WATCHDOG_AUTO_RECOVER=0</span> to disable).
                </>
              ) : (
                <>
                  <span className="font-mono">Reboot</span> runs{" "}
                  <span className="font-mono">docker restart</span> (graceful stop, then start).{" "}
                  <span className="font-mono">Kill</span> sends <span className="font-mono">SIGKILL</span>{" "}
                  only (watchdog restarts later). Watch status after either action. See{" "}
                  <span className="font-mono">ARCHITECTURE.md</span> for Desktop restart quirks.
                </>
              )}
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void fetchDocker()}
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {config?.hint && (
            <p className="text-muted-foreground border-l-2 border-amber-500/80 pl-3 text-sm">
              {config.hint}
            </p>
          )}
          {!config?.supportsDockerKill && docker?.source === "railway" && (
            <p className="text-muted-foreground text-sm">
              Set a Railway API token on this service so Kill/Reboot can call the GraphQL API. The
              watchdog also needs the token to poll and auto-redeploy.
            </p>
          )}
          {docker?.error && (
            <p className="text-destructive text-sm" role="alert">
              {docker.error}
            </p>
          )}

          {watchService && (
            <div className="bg-muted/40 rounded-lg border p-4 text-sm">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  Watching{" "}
                  <span className="font-mono">{watchService}</span> (every 2s)
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setWatchService(null);
                    setWatchStatus(null);
                    setWatchError(null);
                  }}
                >
                  Stop
                </Button>
              </div>
              {watchError && (
                <p className="text-destructive mb-2">{watchError}</p>
              )}
              {watchStatus?.found === false && (
                <p className="text-muted-foreground">{watchStatus.message}</p>
              )}
              {watchStatus?.found && (
                <dl className="grid gap-1 sm:grid-cols-2">
                  <dt className="text-muted-foreground">State</dt>
                  <dd>{watchStatus.state}</dd>
                  <dt className="text-muted-foreground">Running</dt>
                  <dd>{watchStatus.running ? "yes" : "no"}</dd>
                  {watchStatus.source === "railway" ? (
                    <>
                      <dt className="text-muted-foreground">Deployment</dt>
                      <dd className="font-mono text-xs">
                        {watchStatus.deploymentStatus ?? "—"}
                      </dd>
                      <dt className="text-muted-foreground">Health</dt>
                      <dd>{watchStatus.health ?? "—"}</dd>
                      <dt className="text-muted-foreground">Status</dt>
                      <dd className="max-w-md break-all text-xs">
                        {watchStatus.statusLine ?? "—"}
                      </dd>
                    </>
                  ) : (
                    <>
                      <dt className="text-muted-foreground">Restart count</dt>
                      <dd className="font-mono tabular-nums">
                        {watchStatus.restartCount ?? "—"}
                      </dd>
                      <dt className="text-muted-foreground">Restart policy</dt>
                      <dd className="font-mono text-xs">{watchStatus.restartPolicy}</dd>
                      <dt className="text-muted-foreground">Health</dt>
                      <dd>{watchStatus.health ?? "—"}</dd>
                      <dt className="text-muted-foreground">Container ID</dt>
                      <dd className="break-all font-mono text-xs">
                        {watchStatus.containerId?.slice(0, 12)}…
                      </dd>
                    </>
                  )}
                </dl>
              )}
            </div>
          )}

          <div className="max-h-[min(55vh,560px)] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>{docker?.source === "railway" ? "Deployment" : "Container"}</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="min-w-[260px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      No containers loaded.
                    </TableCell>
                  </TableRow>
                )}
                {sorted.map((c) => {
                  const svcLower = c.service?.trim().toLowerCase() ?? "";
                  const canKill =
                    showKill &&
                    Boolean(svcLower) &&
                    allowedSet.has(svcLower) &&
                    !config?.blockedServices?.some(
                      (b) => b.toLowerCase() === svcLower
                    ) &&
                    (docker?.source !== "railway" || Boolean(c.railwayServiceId));
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.service || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{c.name}</TableCell>
                      <TableCell>{stateBadge(c.state, c.health)}</TableCell>
                      <TableCell className="max-w-[240px] truncate text-xs">{c.status}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            onClick={() => {
                              setWatchService(c.service);
                              setWatchError(null);
                            }}
                          >
                            Watch
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            disabled={!canKill}
                            title={
                              !config?.supportsDockerKill
                                ? "Need Railway token or local Docker"
                                : !config?.killEnabled
                                  ? "Set CHAOS_KILL_ENABLED=1"
                                  : docker?.source === "railway" && !c.railwayServiceId
                                    ? "Missing Railway service id — refresh"
                                    : !canKill
                                      ? "Not in allow list / blocked service"
                                      : docker?.source === "railway"
                                        ? "deploymentRestart (Railway)"
                                        : "Graceful stop then start (docker restart)"
                            }
                            onClick={() => openChaos(c, "restart")}
                          >
                            <RotateCcw className="mr-1 size-3.5" />
                            Reboot
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            className="text-xs"
                            disabled={!canKill}
                            title={
                              !config?.supportsDockerKill
                                ? "Need Railway token or local Docker"
                                : !config?.killEnabled
                                  ? "Set CHAOS_KILL_ENABLED=1"
                                  : docker?.source === "railway" && !c.railwayServiceId
                                    ? "Missing Railway service id — refresh"
                                    : !canKill
                                      ? "Not in CHAOS_ALLOWED_SERVICES / blocked service"
                                      : docker?.source === "railway"
                                        ? "deploymentStop (Railway)"
                                        : undefined
                            }
                            onClick={() => openChaos(c, "kill")}
                          >
                            <Skull className="mr-1 size-3.5" />
                            Kill
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {pendingChaos && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="chaos-action-title"
        >
          <Card className="bg-background w-full max-w-md shadow-lg">
            <CardHeader>
              <CardTitle id="chaos-action-title">
                {pendingChaos.action === "kill" ? "Confirm SIGKILL" : "Confirm reboot"}
              </CardTitle>
              <CardDescription>
                {pendingChaos.action === "kill" ? (
                  docker?.source === "railway" ? (
                    <>
                      This calls Railway <span className="font-mono">deploymentStop</span> on the
                      active deployment. The watchdog can redeploy latest automatically (unless{" "}
                      <span className="font-mono">RAILWAY_WATCHDOG_AUTO_RECOVER=0</span>).
                    </>
                  ) : (
                    <>
                      This sends <span className="font-mono">docker kill</span> (SIGKILL) only — it
                      does not start the container. The{" "}
                      <span className="font-mono">compose-watchdog</span> service (or Docker&apos;s
                      restart policy) will bring it back; expect traffic to fail until then.
                    </>
                  )
                ) : docker?.source === "railway" ? (
                  <>
                    This calls Railway <span className="font-mono">deploymentRestart</span> for{" "}
                    <span className="font-mono">{pendingChaos.container.service}</span> (graceful
                    restart of the running deployment).
                  </>
                ) : (
                  <>
                    This runs <span className="font-mono">docker restart</span> on{" "}
                    <span className="font-mono">{pendingChaos.container.name}</span> (graceful stop,
                    then start). Expect a short outage for that service.
                  </>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">
                Type the service name{" "}
                <span className="text-foreground font-mono font-semibold">
                  {pendingChaos.container.service}
                </span>{" "}
                to confirm:
              </p>
              <input
                type="text"
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm font-mono"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="service name"
                autoComplete="off"
              />
              {chaosError && (
                <p className="text-destructive text-sm" role="alert">
                  {chaosError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={chaosBusy}
                  onClick={() => setPendingChaos(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant={pendingChaos.action === "kill" ? "destructive" : "default"}
                  disabled={chaosBusy}
                  onClick={() => void submitChaos()}
                >
                  {chaosBusy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : pendingChaos.action === "kill" ? (
                    docker?.source === "railway" ? "Stop deployment" : "Kill container"
                  ) : docker?.source === "railway" ? (
                    "Restart deployment"
                  ) : (
                    "Reboot container"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
