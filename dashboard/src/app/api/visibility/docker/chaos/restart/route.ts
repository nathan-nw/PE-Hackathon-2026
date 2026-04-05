import { NextRequest, NextResponse } from "next/server";

import {
  chaosKillEnabled,
  isServiceKillAllowed,
} from "@/lib/docker-chaos-policy";
import { getDockerConnectionOptions } from "@/lib/docker-options";
import {
  getRailwayChaosRowForService,
  railwayDeploymentRestart,
  railwayChaosLog,
} from "@/lib/railway-visibility";
import { hasRailwayGraphqlCredential, runtimeEnv } from "@/lib/server-runtime-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getDocker() {
  const { default: Docker } = await import("dockerode");
  return new Docker(getDockerConnectionOptions());
}

type RestartBody = {
  containerId?: string;
  railwayServiceId?: string;
  confirmService?: string;
};

/** Seconds to wait for graceful stop before SIGKILL during restart (Docker default behavior). */
const RESTART_STOP_GRACE_S = 10;

export async function POST(request: NextRequest) {
  if (!chaosKillEnabled()) {
    return NextResponse.json(
      {
        error:
          "Chaos actions are disabled. Set CHAOS_KILL_ENABLED=1 (Compose sets this by default), use `next dev` locally, or remove CHAOS_KILL_ENABLED=0.",
      },
      { status: 403 }
    );
  }

  let body: RestartBody;
  try {
    body = (await request.json()) as RestartBody;
  } catch {
    return NextResponse.json(
      {
        error:
          "JSON body required with confirmService and either containerId (Docker) or railwayServiceId (Railway)",
      },
      { status: 400 }
    );
  }

  const confirmService = (body.confirmService ?? "").trim().toLowerCase();
  if (!confirmService) {
    return NextResponse.json(
      { error: "confirmService is required" },
      { status: 400 }
    );
  }

  const railwayServiceId = (body.railwayServiceId ?? "").trim();
  const useRailwayChaos = Boolean(railwayServiceId);

  if (useRailwayChaos) {
    console.info("[dashboard][chaos/restart] Railway request", {
      confirmService,
      railwayServiceIdPrefix: `${railwayServiceId.slice(0, 8)}…`,
    });
    railwayChaosLog("restart:incoming", {
      confirmService,
      railwayServiceIdPrefix: `${railwayServiceId.slice(0, 8)}…`,
    });

    if (!hasRailwayGraphqlCredential()) {
      return NextResponse.json(
        {
          error:
            "Railway API token missing — set RAILWAY_PROJECT_TOKEN or RAILWAY_API_TOKEN on the dashboard service.",
        },
        { status: 503 }
      );
    }

    const projectId = runtimeEnv("RAILWAY_PROJECT_ID");
    const environmentId = runtimeEnv("RAILWAY_ENVIRONMENT_ID");
    if (!projectId || !environmentId) {
      return NextResponse.json(
        {
          error:
            "RAILWAY_PROJECT_ID and RAILWAY_ENVIRONMENT_ID must be set on the dashboard service (e.g. via setup-railway variable sync).",
        },
        { status: 503 }
      );
    }

    try {
      const row = await getRailwayChaosRowForService(railwayServiceId);
      if (!row) {
        return NextResponse.json(
          {
            error:
              "Service not found or Railway visibility query failed — refresh the table and try again.",
          },
          { status: 404 }
        );
      }

      if (row.service.trim().toLowerCase() !== confirmService) {
        return NextResponse.json(
          {
            error:
              "confirmService does not match this Railway service name.",
          },
          { status: 400 }
        );
      }

      if (!isServiceKillAllowed(row.service)) {
        return NextResponse.json(
          {
            error: `Service "${row.service}" is not allowed. Blocked or not in the allow list. Override with CHAOS_ALLOWED_SERVICES if needed.`,
          },
          { status: 403 }
        );
      }

      const depId = row.railwayDeploymentId;
      if (!depId) {
        return NextResponse.json(
          {
            error:
              "No active deployment to restart — deploy the service in Railway first.",
          },
          { status: 400 }
        );
      }

      await railwayDeploymentRestart(depId);

      return NextResponse.json({
        ok: true,
        service: row.service,
        message:
          "deploymentRestart requested via Railway API (graceful restart of the running deployment).",
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      return NextResponse.json({ error: message, ok: false }, { status: 503 });
    }
  }

  const containerId = (body.containerId ?? "").trim();
  if (!containerId) {
    return NextResponse.json(
      {
        error: "containerId and confirmService are required for Docker chaos",
      },
      { status: 400 }
    );
  }

  const project =
    runtimeEnv("VISIBILITY_COMPOSE_PROJECT") || "pe-hackathon-2026";

  try {
    const docker = await getDocker();
    const container = docker.getContainer(containerId);
    const info = await container.inspect();

    const svc = info.Config?.Labels?.["com.docker.compose.service"] ?? "";
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

    if (svc.toLowerCase() !== confirmService) {
      return NextResponse.json(
        {
          error:
            "confirmService does not match this container's Compose service name.",
        },
        { status: 400 }
      );
    }

    if (!isServiceKillAllowed(svc)) {
      return NextResponse.json(
        {
          error: `Service "${svc}" is not allowed. Blocked or not in the allow list. Override with CHAOS_ALLOWED_SERVICES if needed.`,
        },
        { status: 403 }
      );
    }

    await container.restart({ t: RESTART_STOP_GRACE_S });

    return NextResponse.json({
      ok: true,
      service: svc,
      message: `docker restart requested (stop grace ${RESTART_STOP_GRACE_S}s).`,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message, ok: false }, { status: 503 });
  }
}
