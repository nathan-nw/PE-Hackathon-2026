"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

const POLL_MS = 10_000;

type IncidentEvent = {
  id: number;
  event_type: string;
  severity: string;
  title: string;
  description: string;
  source: string;
  alert_name: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

type IncidentsResponse = {
  events: IncidentEvent[];
  count: number;
  error?: string;
  hint?: string;
};

/** Same-origin proxy (`/api/incidents`) → FastAPI so local + Railway use `DASHBOARD_BACKEND_URL` on the server. */
function severityBadge(severity: string) {
  switch (severity) {
    case "critical":
      return <Badge variant="destructive">critical</Badge>;
    case "warning":
      return (
        <Badge className="bg-yellow-500/15 text-yellow-600 dark:text-yellow-400">
          warning
        </Badge>
      );
    case "info":
      return <Badge variant="secondary">info</Badge>;
    default:
      return <Badge variant="outline">{severity}</Badge>;
  }
}

function statusIcon(event_type: string, status: string) {
  if (status === "resolved" || event_type === "alert_resolved") {
    return (
      <span className="flex h-3 w-3 rounded-full bg-green-500" title="Resolved" />
    );
  }
  if (event_type === "alert_fired") {
    return (
      <span className="relative flex h-3 w-3">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
      </span>
    );
  }
  return (
    <span className="flex h-3 w-3 rounded-full bg-blue-500" title={event_type} />
  );
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Group events by date string */
function groupByDate(events: IncidentEvent[]) {
  const groups: Map<string, IncidentEvent[]> = new Map();
  for (const ev of events) {
    const key = formatDate(ev.created_at);
    const arr = groups.get(key) ?? [];
    arr.push(ev);
    groups.set(key, arr);
  }
  return groups;
}

export function IncidentTimeline() {
  const [data, setData] = useState<IncidentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [windowHours, setWindowHours] = useState(24);
  const [filterSeverity, setFilterSeverity] = useState<string>("");

  const fetchEvents = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        window_hours: String(windowHours),
        limit: "200",
      });
      if (filterSeverity) params.set("severity", filterSeverity);
      const res = await fetch(`/api/incidents?${params}`, { cache: "no-store" });
      const j = (await res.json()) as IncidentsResponse;
      if (res.ok) {
        setData(j);
      } else {
        setData({
          events: [],
          count: 0,
          error: j.error,
          hint: j.hint,
        });
      }
    } catch (e) {
      setData({
        events: [],
        count: 0,
        error: e instanceof Error ? e.message : "Could not load incidents",
      });
    } finally {
      setLoading(false);
    }
  }, [windowHours, filterSeverity]);

  useEffect(() => {
    fetchEvents();
    const id = setInterval(fetchEvents, POLL_MS);
    return () => clearInterval(id);
  }, [fetchEvents]);

  const handleClear = useCallback(async () => {
    await fetch("/api/incidents/clear", { method: "POST", cache: "no-store" });
    fetchEvents();
  }, [fetchEvents]);

  const events = data?.events ?? [];
  const grouped = groupByDate(events);

  const firingCount = events.filter(
    (e) => e.event_type === "alert_fired" && e.status === "firing"
  ).length;
  const resolvedCount = events.filter(
    (e) => e.status === "resolved" || e.event_type === "alert_resolved"
  ).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Incident Timeline</CardTitle>
            <CardDescription>
              Chronological view of alerts and incidents from Prometheus / Alertmanager
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={handleClear}>
            <Trash2 className="mr-1 h-3 w-3" />
            Clear
          </Button>
        </div>

        {/* summary stats */}
        <div className="mt-3 flex gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
            </span>
            <span className="text-muted-foreground">
              Firing: <span className="text-foreground font-medium">{firingCount}</span>
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="flex h-2.5 w-2.5 rounded-full bg-green-500" />
            <span className="text-muted-foreground">
              Resolved: <span className="text-foreground font-medium">{resolvedCount}</span>
            </span>
          </div>
          <div className="text-muted-foreground">
            Total: <span className="text-foreground font-medium">{events.length}</span>
          </div>
        </div>

        {/* filters */}
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            { label: "24h", value: 24 },
            { label: "12h", value: 12 },
            { label: "6h", value: 6 },
            { label: "1h", value: 1 },
          ].map((opt) => (
            <Button
              key={opt.value}
              variant={windowHours === opt.value ? "default" : "outline"}
              size="sm"
              onClick={() => setWindowHours(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
          <span className="mx-2 border-l" />
          {["", "critical", "warning", "info"].map((sev) => (
            <Button
              key={sev || "all"}
              variant={filterSeverity === sev ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterSeverity(sev)}
            >
              {sev || "All"}
            </Button>
          ))}
        </div>
      </CardHeader>

      <CardContent>
        {data?.error && (
          <div className="mb-4 space-y-1">
            <p className="text-destructive text-sm">{data.error}</p>
            {data.hint && (
              <p className="text-muted-foreground text-xs">{data.hint}</p>
            )}
          </div>
        )}
        {loading && events.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">
            Loading timeline...
          </p>
        ) : !loading && events.length === 0 && !data?.error ? (
          <div className="py-12 text-center">
            <p className="text-muted-foreground text-sm">
              No incidents in the last {windowHours}h. All clear.
            </p>
          </div>
        ) : events.length === 0 ? null : (
          <div className="space-y-6">
            {Array.from(grouped.entries()).map(([dateStr, dayEvents]) => (
              <div key={dateStr}>
                <div className="text-muted-foreground mb-3 text-xs font-semibold uppercase tracking-wider">
                  {dateStr}
                </div>

                {/* vertical timeline */}
                <div className="relative ml-1.5 border-l-2 border-zinc-200 pl-6 dark:border-zinc-700">
                  {dayEvents.map((ev) => (
                    <div key={ev.id} className="group relative mb-5 last:mb-0">
                      {/* dot on the line */}
                      <div className="absolute -left-[31px] top-0.5 flex items-center justify-center">
                        {statusIcon(ev.event_type, ev.status)}
                      </div>

                      <div className="rounded-lg border bg-zinc-50/50 p-3 transition-colors hover:bg-zinc-100/80 dark:bg-zinc-900/50 dark:hover:bg-zinc-800/60">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-muted-foreground text-xs font-mono">
                            {formatTime(ev.created_at)}
                          </span>
                          {severityBadge(ev.severity)}
                          <Badge variant="outline" className="text-[10px]">
                            {ev.source}
                          </Badge>
                        </div>

                        <p className="mt-1 text-sm font-medium">{ev.title}</p>

                        {ev.description && (
                          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                            {ev.description}
                          </p>
                        )}

                        {ev.alert_name && (
                          <p className="text-muted-foreground mt-1 text-[10px]">
                            Alert: <span className="font-mono">{ev.alert_name}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
