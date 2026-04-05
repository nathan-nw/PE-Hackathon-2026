"use client";

import { Badge } from "@/components/ui/badge";
import type { HeartbeatPingResult } from "@/lib/service-heartbeat";

/**
 * Displays HTTP heartbeat result from `/api/visibility/docker?heartbeats=1` (Railway).
 * Falls back to muted text when no probe is configured for the service.
 */
export function HeartbeatCell({ hb }: { hb?: HeartbeatPingResult }) {
  if (!hb) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (hb.skipped || hb.ok === null) {
    return (
      <span className="text-muted-foreground text-xs" title="No public HTTP probe for this service">
        n/a
      </span>
    );
  }
  if (hb.ok) {
    return (
      <Badge variant="secondary" className="font-mono text-xs tabular-nums">
        OK
        {hb.latencyMs != null ? ` ${hb.latencyMs}ms` : ""}
      </Badge>
    );
  }
  return (
    <Badge
      variant="destructive"
      className="max-w-[180px] truncate font-mono text-xs"
      title={hb.error ?? hb.probeUrl ?? "heartbeat failed"}
    >
      Fail
      {hb.statusCode != null ? ` ${hb.statusCode}` : ""}
    </Badge>
  );
}
