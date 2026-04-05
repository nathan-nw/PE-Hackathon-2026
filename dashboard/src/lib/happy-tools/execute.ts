import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { resolveDashboardBackendBase } from "@/lib/dashboard-backend-url";
import { runtimeEnv } from "@/lib/server-runtime-env";

const execFileAsync = promisify(execFile);

const FETCH_MS = 25_000;
const MAX_JSON_CHARS = 14_000;

export type ToolContext = {
  /** Next.js app base for same-process API routes (see `dashboardSelfOrigin`). */
  selfOrigin: string;
};

function clipJson(data: unknown): string {
  const s = JSON.stringify(data);
  if (s.length <= MAX_JSON_CHARS) return s;
  return `${s.slice(0, MAX_JSON_CHARS)}\n… [truncated, ${s.length} chars total]`;
}

async function fetchBackend(pathWithQuery: string): Promise<unknown> {
  const resolved = resolveDashboardBackendBase();
  if (!resolved.ok) {
    return { error: resolved.error, hint: "Set DASHBOARD_BACKEND_URL on the dashboard service." };
  }
  const url = `${resolved.base}${pathWithQuery}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      next: { revalidate: 0 },
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = { raw: text.slice(0, 2000), status: res.status };
    }
    if (!res.ok) {
      return { http_status: res.status, body };
    }
    return body;
  } catch (e) {
    const message = e instanceof Error ? e.message : "fetch failed";
    return { error: message };
  } finally {
    clearTimeout(t);
  }
}

async function fetchNext(origin: string, pathWithQuery: string): Promise<unknown> {
  const url = `${origin.replace(/\/$/, "")}${pathWithQuery}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      next: { revalidate: 0 },
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = { raw: text.slice(0, 2000), status: res.status };
    }
    if (!res.ok) {
      return { http_status: res.status, body };
    }
    return body;
  } catch (e) {
    const message = e instanceof Error ? e.message : "fetch failed";
    return { error: message };
  } finally {
    clearTimeout(t);
  }
}

function truncateLogArrays(data: unknown, maxLogs: number): unknown {
  if (!data || typeof data !== "object") return data;
  const o = data as Record<string, unknown>;
  if (Array.isArray(o.logs) && o.logs.length > maxLogs) {
    return {
      ...o,
      logs: o.logs.slice(0, maxLogs),
      _truncated_logs: true,
      _total_logs: o.logs.length,
    };
  }
  if (Array.isArray(o.error_logs) && o.error_logs.length > maxLogs) {
    return {
      ...o,
      error_logs: o.error_logs.slice(0, maxLogs),
      _truncated_error_logs: true,
      _total_error_logs: o.error_logs.length,
    };
  }
  if (Array.isArray(o.logs) && Array.isArray(o.buckets)) {
    const logs = o.logs as unknown[];
    if (logs.length > maxLogs) {
      return {
        ...o,
        logs: logs.slice(0, maxLogs),
        _truncated_logs: true,
        _total_logs: logs.length,
      };
    }
  }
  return data;
}

export async function executeHappyTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> {
  const origin = ctx.selfOrigin;

  try {
    switch (name) {
      case "get_application_logs": {
        const limit = Math.min(500, Math.max(1, Number(args.limit) || 80));
        const qs = new URLSearchParams();
        qs.set("limit", String(limit));
        if (typeof args.level === "string" && args.level) qs.set("level", args.level);
        if (typeof args.search === "string" && args.search) qs.set("search", args.search);
        if (typeof args.status_code === "string" && args.status_code)
          qs.set("status_code", args.status_code);
        if (typeof args.instance_id === "string" && args.instance_id)
          qs.set("instance_id", args.instance_id);
        if (typeof args.source === "string" && args.source) qs.set("source", args.source);
        const raw = await fetchBackend(`/api/logs?${qs.toString()}`);
        const trimmed = truncateLogArrays(raw, 45);
        return clipJson(trimmed);
      }
      case "get_log_statistics": {
        const raw = await fetchNext(origin, "/api/logs/stats");
        return clipJson(raw);
      }
      case "get_error_analytics": {
        const wm = Math.min(1440, Math.max(1, Number(args.window_minutes) || 60));
        const ll = Math.min(10000, Math.max(1, Number(args.log_limit) || 120));
        const qs = new URLSearchParams();
        qs.set("window_minutes", String(wm));
        qs.set("log_limit", String(ll));
        const raw = await fetchNext(origin, `/api/errors?${qs.toString()}`);
        const trimmed = truncateLogArrays(raw, 60);
        return clipJson(trimmed);
      }
      case "get_log_insights": {
        const qs = new URLSearchParams();
        if (args.window_minutes != null) qs.set("window_minutes", String(Number(args.window_minutes)));
        if (args.log_limit != null) qs.set("log_limit", String(Number(args.log_limit)));
        if (typeof args.level === "string" && args.level) qs.set("level", args.level);
        if (typeof args.search === "string" && args.search) qs.set("search", args.search);
        if (typeof args.status_code === "string" && args.status_code)
          qs.set("status_code", args.status_code);
        if (typeof args.instance_id === "string" && args.instance_id)
          qs.set("instance_id", args.instance_id);
        const raw = await fetchNext(origin, `/api/logs/insights?${qs.toString()}`);
        const trimmed = truncateLogArrays(raw, 40);
        return clipJson(trimmed);
      }
      case "get_backend_health": {
        const raw = await fetchNext(origin, "/api/health/backend");
        return clipJson(raw);
      }
      case "get_golden_signals": {
        const qs = new URLSearchParams();
        if (args.range_minutes != null) qs.set("range_minutes", String(Number(args.range_minutes)));
        if (args.step_seconds != null) qs.set("step_seconds", String(Number(args.step_seconds)));
        const q = qs.toString();
        const raw = await fetchNext(origin, `/api/telemetry/golden-signals${q ? `?${q}` : ""}`);
        return clipJson(raw);
      }
      case "get_flask_replica_stats": {
        const raw = await fetchNext(origin, "/api/visibility/instance-stats");
        return clipJson(raw);
      }
      case "get_postgres_introspection": {
        const qs = new URLSearchParams();
        if (typeof args.profile === "string" && args.profile) qs.set("profile", args.profile);
        const q = qs.toString();
        const raw = await fetchNext(origin, `/api/ops/postgres-introspect${q ? `?${q}` : ""}`);
        return clipJson(raw);
      }
      case "get_prometheus_alerts": {
        const raw = await fetchNext(origin, "/api/visibility/alerts");
        return clipJson(raw);
      }
      case "get_docker_or_railway_visibility": {
        const qs = new URLSearchParams();
        if (args.include_stats === true) qs.set("stats", "1");
        qs.set("heartbeats", "1");
        const raw = await fetchNext(origin, `/api/visibility/docker?${qs.toString()}`);
        return clipJson(raw);
      }
      case "get_incident_timeline": {
        const qs = new URLSearchParams();
        if (args.limit != null) qs.set("limit", String(Number(args.limit)));
        if (args.window_hours != null) qs.set("window_hours", String(Number(args.window_hours)));
        if (typeof args.event_type === "string" && args.event_type) qs.set("event_type", args.event_type);
        if (typeof args.severity === "string" && args.severity) qs.set("severity", args.severity);
        const raw = await fetchBackend(`/api/incidents?${qs.toString()}`);
        return clipJson(raw);
      }
      case "k6_get_status": {
        const raw = await fetchNext(origin, "/api/k6/status");
        return clipJson(raw);
      }
      case "k6_run_load_test": {
        const body: Record<string, unknown> = {};
        if (typeof args.preset === "string") body.preset = args.preset;
        if (args.vus != null) body.vus = Number(args.vus);
        if (typeof args.duration === "string") body.duration = args.duration;
        if (typeof args.target_url === "string") body.target_url = args.target_url;
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), FETCH_MS);
        try {
          const res = await fetch(`${origin}/api/k6/run`, {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(body),
            next: { revalidate: 0 },
          });
          const text = await res.text();
          let out: unknown;
          try {
            out = JSON.parse(text) as unknown;
          } catch {
            out = { raw: text.slice(0, 2000), status: res.status };
          }
          return clipJson(out);
        } finally {
          clearTimeout(t);
        }
      }
      case "k6_stop_load_test": {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), FETCH_MS);
        try {
          const res = await fetch(`${origin}/api/k6/stop`, {
            method: "POST",
            signal: controller.signal,
            headers: { Accept: "application/json" },
            next: { revalidate: 0 },
          });
          const text = await res.text();
          let out: unknown;
          try {
            out = JSON.parse(text) as unknown;
          } catch {
            out = { raw: text.slice(0, 2000), status: res.status };
          }
          return clipJson(out);
        } finally {
          clearTimeout(t);
        }
      }
      case "run_pytest": {
        const enabled =
          runtimeEnv("HAPPY_PYTEST_ENABLED") === "1" || runtimeEnv("HAPPY_PYTEST_ENABLED") === "true";
        const cwd = runtimeEnv("HAPPY_PYTEST_CWD")?.trim();
        if (!enabled || !cwd) {
          return JSON.stringify({
            ok: false,
            message:
              "Pytest is not enabled. For local dev set HAPPY_PYTEST_ENABLED=true and HAPPY_PYTEST_CWD to the repo root (folder containing pyproject.toml). Hosted environments often omit this.",
          });
        }
        const uv = process.platform === "win32" ? "uv.cmd" : "uv";
        const argv = ["run", "pytest", "-v", "--tb=short", "--no-header", "-q"];
        if (typeof args.keyword === "string" && args.keyword.trim()) {
          argv.push("-k", args.keyword.trim());
        }
        if (typeof args.path === "string" && args.path.trim()) {
          argv.push(args.path.trim());
        }
        try {
          const { stdout, stderr } = await execFileAsync(uv, argv, {
            cwd,
            maxBuffer: 512 * 1024,
            timeout: 120_000,
            windowsHide: true,
          });
          const out = {
            ok: true,
            stdout: String(stdout).slice(0, 80_000),
            stderr: String(stderr).slice(0, 20_000),
          };
          return clipJson(out);
        } catch (e) {
          const err = e as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
          return clipJson({
            ok: false,
            code: err.code,
            message: err.message,
            stdout: err.stdout ? String(err.stdout).slice(0, 40_000) : "",
            stderr: err.stderr ? String(err.stderr).slice(0, 20_000) : "",
          });
        }
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "tool failed";
    return JSON.stringify({ error: message });
  }
}
