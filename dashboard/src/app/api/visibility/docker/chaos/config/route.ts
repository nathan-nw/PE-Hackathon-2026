import { NextResponse } from "next/server";

import {
  blockedServicesList,
  chaosKillEnabled,
  listAllowedServicesForUi,
} from "@/lib/docker-chaos-policy";
import {
  railwayIdsConfigured,
  railwayVisibilityConfigured,
} from "@/lib/railway-visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const onRailway = railwayIdsConfigured();
  const chaosActionsAvailable =
    !onRailway || railwayVisibilityConfigured();

  return NextResponse.json({
    killEnabled: chaosKillEnabled(),
    /** True when Kill/Reboot can run: local Docker, or Railway with a valid API token. */
    supportsDockerKill: chaosActionsAvailable,
    blockedServices: blockedServicesList(),
    allowedServices: listAllowedServicesForUi(),
    hint: onRailway
      ? chaosActionsAvailable
        ? "Hosted: Kill runs deploymentStop (service stays down until you Reboot or redeploy in Railway). Watchdog auto-redeploy only on CRASHED/FAILED, not after Kill. Set CHAOS_KILL_ENABLED=1 on this service to enable buttons in production."
        : "Set RAILWAY_PROJECT_TOKEN or RAILWAY_API_TOKEN on the dashboard service so chaos actions and visibility can call the Railway API."
      : chaosKillEnabled()
        ? null
        : "Set CHAOS_KILL_ENABLED=1 on the dashboard service, or run `next dev` locally (enabled by default in development).",
  });
}
