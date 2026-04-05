/**
 * HTTP heartbeat probes for Railway-hosted services (public URL + path).
 * Used by Ops/Chaos visibility and the Railway watchdog when deployment status
 * says SUCCESS but the app is wedged.
 *
 * On Railway, GraphQL often returns `url` / `staticUrl` **without** a scheme
 * (`foo.up.railway.app`), which makes `fetch()` throw "Failed to parse URL".
 * `normalizePublicUrlForFetch` prepends `https://` in that case.
 *
 * When `RAILWAY_PRIVATE_DOMAIN` is set (watchdog/dashboard running on Railway),
 * heartbeats default to the **private mesh**: `http://<service>.railway.internal:<port>/path`
 * unless `RAILWAY_HEARTBEAT_USE_PRIVATE_URL=0`. Port defaults to 8080 or
 * `RAILWAY_HEARTBEAT_INTERNAL_PORT`.
 */

import { runtimeEnv } from "./server-runtime-env";

/** Services with no meaningful public HTTP probe (data / metrics / internal). */
const INTERNAL_HTTP_SERVICES = new Set(
  [
    "db",
    "dashboard-db",
    "postgres",
    "redis",
    "kafka",
    "zookeeper",
    "kafka-log-consumer",
    "db-backup",
  ].map((s) => s.toLowerCase())
);

/**
 * Returns a path to GET for liveness, or null when we should not probe this service.
 */
export function heartbeatPathForService(serviceName: string): string | null {
  const s = serviceName.trim().toLowerCase();
  if (!s) return null;
  if (INTERNAL_HTTP_SERVICES.has(s)) return null;
  if (s.includes("postgres") && !s.includes("shortener")) return null;

  if (s === "dashboard-backend") return "/api/health";
  if (s === "dashboard") return "/api/health";
  if (s === "user-frontend") return "/";
  if (s === "load-balancer" || s.startsWith("url-shortener")) return "/live";
  if (s === "railway-watchdog") return "/health";

  return null;
}

function heartbeatInternalPort(): number {
  const n = parseInt(runtimeEnv("RAILWAY_HEARTBEAT_INTERNAL_PORT") ?? "8080", 10);
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : 8080;
}

/**
 * When true, heartbeats use `http://<service>.railway.internal:<port>` (private mesh).
 * Default ON when `RAILWAY_PRIVATE_DOMAIN` is set; set `RAILWAY_HEARTBEAT_USE_PRIVATE_URL=0` to force public URLs.
 */
export function shouldUsePrivateRailwayHeartbeat(): boolean {
  const explicit = (runtimeEnv("RAILWAY_HEARTBEAT_USE_PRIVATE_URL") ?? "").trim().toLowerCase();
  if (
    explicit === "0" ||
    explicit === "false" ||
    explicit === "no" ||
    explicit === "off"
  ) {
    return false;
  }
  if (
    explicit === "1" ||
    explicit === "true" ||
    explicit === "yes" ||
    explicit === "on"
  ) {
    return true;
  }
  return Boolean(runtimeEnv("RAILWAY_PRIVATE_DOMAIN")?.trim());
}

function serviceInternalHostname(serviceName: string): string {
  return serviceName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

/** Ensure `fetch()` receives an absolute URL with a scheme. */
export function normalizePublicUrlForFetch(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return `https:${s}`;
  return `https://${s}`;
}

export function buildHeartbeatProbeUrl(
  publicUrl: string | undefined,
  serviceName: string
): string | null {
  const path = heartbeatPathForService(serviceName);
  if (!path) return null;

  if (shouldUsePrivateRailwayHeartbeat()) {
    const host = serviceInternalHostname(serviceName);
    const port = heartbeatInternalPort();
    return `http://${host}.railway.internal:${port}${path}`;
  }

  const raw = (publicUrl ?? "").trim();
  if (!raw) return null;
  const base = normalizePublicUrlForFetch(raw).replace(/\/+$/, "");
  return `${base}${path}`;
}

export type HeartbeatPingResult = {
  railwayServiceId: string;
  service: string;
  probeUrl: string | null;
  skipped: boolean;
  /** null when skipped; false = probe ran and failed */
  ok: boolean | null;
  statusCode?: number;
  latencyMs?: number;
  error?: string;
};

const DEFAULT_TIMEOUT_MS = 5_000;

export async function pingHeartbeatUrl(
  probeUrl: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<{ ok: boolean; statusCode?: number; latencyMs: number; error?: string }> {
  const t0 = Date.now();
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(probeUrl, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers: { Accept: "*/*" },
    });
    clearTimeout(id);
    const latencyMs = Date.now() - t0;
    const ok = res.ok;
    return { ok, statusCode: res.status, latencyMs };
  } catch (e) {
    const latencyMs = Date.now() - t0;
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, latencyMs, error: msg };
  }
}

export async function pingRailwayServiceHeartbeats(
  rows: {
    railwayServiceId: string;
    service: string;
    railwayPublicUrl?: string;
  }[],
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<HeartbeatPingResult[]> {
  const out: HeartbeatPingResult[] = [];

  for (const row of rows) {
    const probeUrl = buildHeartbeatProbeUrl(row.railwayPublicUrl, row.service);
    if (!probeUrl) {
      out.push({
        railwayServiceId: row.railwayServiceId,
        service: row.service,
        probeUrl: null,
        skipped: true,
        ok: null,
      });
      continue;
    }

    const r = await pingHeartbeatUrl(probeUrl, timeoutMs);
    out.push({
      railwayServiceId: row.railwayServiceId,
      service: row.service,
      probeUrl,
      skipped: false,
      ok: r.ok,
      statusCode: r.statusCode,
      latencyMs: r.latencyMs,
      ...(r.error ? { error: r.error } : {}),
    });
  }

  return out;
}
