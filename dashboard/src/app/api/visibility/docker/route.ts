import { NextRequest, NextResponse } from "next/server";
import type { ContainerStats } from "dockerode";
import { getDockerConnectionOptions } from "@/lib/docker-options";
import {
  debugEnvEnabled,
  getRailwayEnvDebugSnapshot,
  runtimeEnv,
} from "@/lib/server-runtime-env";
import {
  fetchRailwayVisibilityRows,
  railwayIdsConfigured,
  railwayVisibilityConfigured,
} from "@/lib/railway-visibility";
import { getRailwayHeartbeatExitLifecycleState } from "@/lib/railway-heartbeat-exit-state";
import { effectiveRailwayOnlineStatusAfterProbe } from "@/lib/watchdog-core/heartbeat-lifecycle";
import { pingRailwayServiceHeartbeats } from "@/lib/service-heartbeat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Avoid stale Railway/deployment rows after chaos kill or redeploy (browser/CDN caching). */
const VISIBILITY_CACHE_HEADERS = {
  "Cache-Control": "private, no-store, must-revalidate",
} as const;

async function getDocker() {
  const { default: Docker } = await import("dockerode");
  return new Docker(getDockerConnectionOptions());
}

function cpuPercentFromStats(stats: ContainerStats): number | undefined {
  const cpuStats = stats.cpu_stats;
  const pre = stats.precpu_stats;
  if (!cpuStats?.cpu_usage || !pre?.cpu_usage || !cpuStats.system_cpu_usage || !pre.system_cpu_usage) {
    return undefined;
  }
  const cpuDelta = cpuStats.cpu_usage.total_usage - pre.cpu_usage.total_usage;
  const systemDelta = cpuStats.system_cpu_usage - pre.system_cpu_usage;
  if (systemDelta <= 0 || cpuDelta < 0) return undefined;
  const cpus = cpuStats.online_cpus || 1;
  return (cpuDelta / systemDelta) * cpus * 100;
}

export async function GET(request: NextRequest) {
  const stats = request.nextUrl.searchParams.get("stats") === "1";
  const heartbeats = request.nextUrl.searchParams.get("heartbeats") === "1";
  const project =
    runtimeEnv("VISIBILITY_COMPOSE_PROJECT") || "pe-hackathon-2026";

  if (railwayIdsConfigured()) {
    if (!railwayVisibilityConfigured()) {
      const pid = runtimeEnv("RAILWAY_PROJECT_ID") ?? "";
      const baseError =
        "Set RAILWAY_PROJECT_TOKEN or RAILWAY_API_TOKEN on the dashboard service (variable names must not have leading/trailing spaces). Redeploy after fixing.";
      return NextResponse.json(
        {
          source: "railway" as const,
          project: pid,
          projectId: pid,
          containers: [],
          error: baseError,
          ...(debugEnvEnabled()
            ? { envDebug: getRailwayEnvDebugSnapshot() }
            : {}),
        },
        { headers: VISIBILITY_CACHE_HEADERS }
      );
    }
    const r = await fetchRailwayVisibilityRows({ includeStats: stats });
    if (r.error || !heartbeats) {
      return NextResponse.json(
        {
          source: "railway" as const,
          project: r.project,
          projectId: r.projectId,
          containers: r.containers,
          error: r.error,
        },
        { headers: VISIBILITY_CACHE_HEADERS }
      );
    }

    const beats = await pingRailwayServiceHeartbeats(r.containers);
    const byId = new Map(beats.map((b) => [b.railwayServiceId, b]));
    const exitSt = getRailwayHeartbeatExitLifecycleState();
    const containers = r.containers.map((c) => {
      const hb = byId.get(c.railwayServiceId);
      const railwayOnlineStatus = effectiveRailwayOnlineStatusAfterProbe(
        exitSt,
        c.railwayServiceId,
        c.railwayDeploymentId ?? "",
        c.railwayOnlineStatus,
        hb,
        { scheduleRedeem: false }
      );
      return {
        ...c,
        railwayOnlineStatus,
        heartbeat: hb,
      };
    });

    return NextResponse.json(
      {
        source: "railway" as const,
        project: r.project,
        projectId: r.projectId,
        containers,
        error: r.error,
      },
      { headers: VISIBILITY_CACHE_HEADERS }
    );
  }

  try {
    const docker = await getDocker();
    const all = await docker.listContainers({ all: true });
    const filtered = all.filter(
      (c) => c.Labels?.["com.docker.compose.project"] === project
    );

    const rows = await Promise.all(
      filtered.map(async (c) => {
        const serviceName = c.Labels?.["com.docker.compose.service"] ?? "";
        const status = c.Status ?? "";
        let health: string | undefined;
        if (status.includes("(healthy)")) health = "healthy";
        else if (status.includes("(unhealthy)")) health = "unhealthy";
        else if (status.includes("(health: starting)")) health = "starting";

        const base = {
          id: c.Id,
          name: c.Names?.[0]?.replace(/^\//, "") ?? "",
          image: c.Image,
          state: c.State,
          status,
          service: serviceName,
          health,
          created: c.Created,
        };

        if (!stats) return base;

        let cpuPercent: number | undefined;
        let memUsage: number | undefined;
        let memLimit: number | undefined;
        try {
          const container = docker.getContainer(c.Id);
          const raw = await container.stats({ stream: false });
          const s =
            typeof raw === "object" && raw !== null && "cpu_stats" in raw
              ? (raw as ContainerStats)
              : undefined;
          if (s) {
            cpuPercent = cpuPercentFromStats(s);
            memUsage = s.memory_stats?.usage;
            memLimit = s.memory_stats?.limit;
          }
        } catch {
          /* per-container stats optional */
        }

        return { ...base, cpuPercent, memUsage, memLimit };
      })
    );

    return NextResponse.json(
      {
        source: "docker" as const,
        project,
        containers: rows,
      },
      { headers: VISIBILITY_CACHE_HEADERS }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { source: "docker" as const, error: message, project, containers: [] },
      { status: 503, headers: VISIBILITY_CACHE_HEADERS }
    );
  }
}
