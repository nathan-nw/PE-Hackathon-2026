import { NextRequest, NextResponse } from "next/server";

import {
  chaosKillEnabled,
  isServiceKillAllowed,
} from "@/lib/docker-chaos-policy";
import { getDockerConnectionOptions } from "@/lib/docker-options";
import {
  getRailwayChaosRowForService,
  railwayDeploymentStop,
  railwayIdsConfigured,
  railwayVisibilityConfigured,
} from "@/lib/railway-visibility";
import { runtimeEnv } from "@/lib/server-runtime-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getDocker() {
  const { default: Docker } = await import("dockerode");
  return new Docker(getDockerConnectionOptions());
}

type KillBody = {
  containerId?: string;
  /** Hosted dashboard: Railway service UUID from the visibility table. */
  railwayServiceId?: string;
  /** Must match compose / Railway service name (case-insensitive) to confirm intent. */
  confirmService?: string;
};

export async function POST(request: NextRequest) {
  if (!chaosKillEnabled()) {
    return NextResponse.json(
      {
        error:
          "Chaos kill is disabled. Set CHAOS_KILL_ENABLED=1 (Compose sets this by default), use `next dev` locally, or remove CHAOS_KILL_ENABLED=0.",
      },
      { status: 403 }
    );
  }

  let body: KillBody;
  try {
    body = (await request.json()) as KillBody;
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

  if (railwayIdsConfigured()) {
    if (!railwayVisibilityConfigured()) {
      return NextResponse.json(
        {
          error:
            "Railway API token missing — set RAILWAY_PROJECT_TOKEN or RAILWAY_API_TOKEN on the dashboard service.",
        },
        { status: 503 }
      );
    }

    const railwayServiceId = (body.railwayServiceId ?? "").trim();
    if (!railwayServiceId) {
      return NextResponse.json(
        {
          error:
            "railwayServiceId and confirmService are required for Railway chaos (kill stops the active deployment).",
        },
        { status: 400 }
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
            error: `Service "${row.service}" is not allowed for chaos kill. Blocked or not in the allow list. Override with CHAOS_ALLOWED_SERVICES if needed.`,
          },
          { status: 403 }
        );
      }

      const depId = row.railwayDeploymentId;
      if (!depId) {
        return NextResponse.json(
          {
            error:
              "No active deployment to stop — deploy the service in Railway first.",
          },
          { status: 400 }
        );
      }

      await railwayDeploymentStop(depId);

      return NextResponse.json({
        ok: true,
        service: row.service,
        message:
          "Deployment stopped via Railway API (deploymentStop). Enable RAILWAY_WATCHDOG_AUTO_RECOVER (default) so the watchdog redeploys latest, or redeploy manually.",
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
          error: `Service "${svc}" is not allowed for chaos kill. Blocked or not in the allow list. Override with CHAOS_ALLOWED_SERVICES if needed.`,
        },
        { status: 403 }
      );
    }

    await container.kill();

    return NextResponse.json({
      ok: true,
      service: svc,
      message:
        "SIGKILL sent. This endpoint does not start the container — compose-watchdog (or the engine restart policy) will bring it back.",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message, ok: false }, { status: 503 });
  }
}
