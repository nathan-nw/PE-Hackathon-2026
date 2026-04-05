import { NextRequest, NextResponse } from "next/server";

import {
  chaosKillEnabled,
  isServiceKillAllowed,
} from "@/lib/docker-chaos-policy";
import { getDockerConnectionOptions } from "@/lib/docker-options";
import { railwayIdsConfigured } from "@/lib/railway-visibility";
import { runtimeEnv } from "@/lib/server-runtime-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getDocker() {
  const { default: Docker } = await import("dockerode");
  return new Docker(getDockerConnectionOptions());
}

type KillBody = {
  containerId?: string;
  /** Must match compose service name (case-insensitive) to confirm intent. */
  confirmService?: string;
};

export async function POST(request: NextRequest) {
  if (railwayIdsConfigured()) {
    return NextResponse.json(
      {
        error:
          "Chaos kill is only supported when the dashboard talks to the local Docker Engine (Compose). Not available for Railway visibility.",
      },
      { status: 400 }
    );
  }

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
      { error: "JSON body required with containerId and confirmService" },
      { status: 400 }
    );
  }

  const containerId = (body.containerId ?? "").trim();
  const confirmService = (body.confirmService ?? "").trim().toLowerCase();
  if (!containerId || !confirmService) {
    return NextResponse.json(
      { error: "containerId and confirmService are required" },
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
