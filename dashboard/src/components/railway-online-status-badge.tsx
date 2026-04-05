"use client";

import { Badge } from "@/components/ui/badge";
import type { RailwayOnlineStatus } from "@/lib/railway-visibility";

/** Matches Railway dashboard wording: Online, Completed, Deploying, etc. */
export function RailwayOnlineStatusBadge({
  status,
  className,
}: {
  status: RailwayOnlineStatus;
  className?: string;
}) {
  switch (status) {
    case "online":
      return (
        <Badge variant="default" className={className}>
          Online
        </Badge>
      );
    case "completed":
      return (
        <Badge variant="secondary" className={className}>
          Completed
        </Badge>
      );
    case "deploying":
      return (
        <Badge
          variant="outline"
          className={
            className ??
            "border-amber-600/70 text-amber-900 dark:border-amber-500/60 dark:text-amber-100"
          }
        >
          Deploying
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className={className}>
          Failed
        </Badge>
      );
    case "skipped":
      return (
        <Badge variant="outline" className={className}>
          Skipped
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className={className}>
          Unknown
        </Badge>
      );
  }
}
