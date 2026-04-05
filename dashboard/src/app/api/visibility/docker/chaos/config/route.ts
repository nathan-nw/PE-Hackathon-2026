import { NextResponse } from "next/server";

import {
  blockedServicesList,
  chaosKillEnabled,
  listAllowedServicesForUi,
} from "@/lib/docker-chaos-policy";
import { railwayIdsConfigured } from "@/lib/railway-visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const onRailway = railwayIdsConfigured();
  return NextResponse.json({
    killEnabled: chaosKillEnabled(),
    supportsDockerKill: !onRailway,
    blockedServices: blockedServicesList(),
    allowedServices: listAllowedServicesForUi(),
    hint: onRailway
      ? "Chaos Kill/Reboot use the local Docker Engine only. The Watchdog card above polls Railway deployments when a project token is set. Unset RAILWAY_PROJECT_ID / RAILWAY_ENVIRONMENT_ID to list Compose containers for Kill."
      : chaosKillEnabled()
        ? null
        : "Set CHAOS_KILL_ENABLED=1 on the dashboard service, or run `next dev` locally (enabled by default in development).",
  });
}
