import { NextRequest, NextResponse } from "next/server";

import { getDockerConnectionOptions } from "@/lib/docker-options";
import { railwayIdsConfigured } from "@/lib/railway-visibility";
import { runtimeEnv } from "@/lib/server-runtime-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getDocker() {
  const { default: Docker } = await import("dockerode");
  return new Docker(getDockerConnectionOptions());
}

function healthFromStatus(status: string): string | undefined {
  if (status.includes("(healthy)")) return "healthy";
  if (status.includes("(unhealthy)")) return "unhealthy";
  if (status.includes("(health: starting)")) return "starting";
  return undefined;
}

export async function GET(request: NextRequest) {
  if (railwayIdsConfigured()) {
    return NextResponse.json(
      { error: "Chaos status is only available for local Docker Compose." },
      { status: 400 }
    );
  }

  const service = request.nextUrl.searchParams.get("service")?.trim();
  const containerId = request.nextUrl.searchParams.get("id")?.trim();
  const project =
    runtimeEnv("VISIBILITY_COMPOSE_PROJECT") || "pe-hackathon-2026";

  if (!service && !containerId) {
    return NextResponse.json(
      { error: "Query parameter required: service=<compose-service> or id=<container-id>" },
      { status: 400 }
    );
  }

  try {
    const docker = await getDocker();
    let id = containerId ?? "";

    if (!id && service) {
      const all = await docker.listContainers({ all: true });
      const match = all.find(
        (c) =>
          c.Labels?.["com.docker.compose.project"] === project &&
          c.Labels?.["com.docker.compose.service"] === service
      );
      if (!match) {
        return NextResponse.json({
          found: false,
          service: service ?? "",
          message: `No container for service "${service}" in project ${project}.`,
        });
      }
      id = match.Id;
    }

    const container = docker.getContainer(id);
    const info = await container.inspect();

    const svc =
      service ??
      info.Config?.Labels?.["com.docker.compose.service"] ??
      "";
    const proj = info.Config?.Labels?.["com.docker.compose.project"] ?? "";
    if (!proj || proj !== project) {
      return NextResponse.json(
        {
          error:
            "Container is not part of the configured Compose project (check VISIBILITY_COMPOSE_PROJECT).",
        },
        { status: 403 }
      );
    }

    const st = info.State;
    const statusLine = st?.Status ?? "";
    const rp = info.HostConfig?.RestartPolicy;
    const policyName =
      typeof rp === "object" && rp && "Name" in rp
        ? String((rp as { Name?: string }).Name ?? "")
        : "";

    return NextResponse.json({
      found: true,
      containerId: info.Id ?? id,
      name: info.Name?.replace(/^\//, "") ?? "",
      service: svc,
      project: proj,
      state: st?.Status ?? "unknown",
      running: Boolean(st?.Running),
      restarting: Boolean(st?.Restarting),
      exitCode: st?.ExitCode,
      restartCount: info.RestartCount ?? 0,
      restartPolicy: policyName || "default",
      health: info.State?.Health?.Status ?? healthFromStatus(statusLine),
      startedAt: st?.StartedAt,
      finishedAt: st?.FinishedAt,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message, found: false }, { status: 503 });
  }
}
