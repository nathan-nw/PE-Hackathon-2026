import { NextRequest, NextResponse } from "next/server";
import type { ContainerStats } from "dockerode";
import { getDockerConnectionOptions } from "@/lib/docker-options";
import {
  fetchRailwayVisibilityRows,
  railwayIdsConfigured,
  railwayVisibilityConfigured,
} from "@/lib/railway-visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const project =
    process.env.VISIBILITY_COMPOSE_PROJECT || "pe-hackathon-2026";

  if (railwayIdsConfigured()) {
    if (!railwayVisibilityConfigured()) {
      const pid = process.env.RAILWAY_PROJECT_ID ?? "";
      return NextResponse.json({
        source: "railway" as const,
        project: pid,
        projectId: pid,
        containers: [],
        error:
          "Set RAILWAY_PROJECT_TOKEN or RAILWAY_API_TOKEN on the dashboard service (exact names), redeploy, and refresh.",
      });
    }
    const r = await fetchRailwayVisibilityRows();
    return NextResponse.json({
      source: "railway" as const,
      project: r.project,
      projectId: r.projectId,
      containers: r.containers,
      error: r.error,
    });
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

    return NextResponse.json({
      source: "docker" as const,
      project,
      containers: rows,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { source: "docker" as const, error: message, project, containers: [] },
      { status: 503 }
    );
  }
}
