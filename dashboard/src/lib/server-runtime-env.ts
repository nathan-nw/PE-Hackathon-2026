/**
 * Read env vars in a way that survives Next.js build-time `process.env` inlining.
 *
 * 1) On Linux (Railway, Docker), `/proc/self/environ` reflects the real process environment.
 * 2) **Fuzzy key match**: Railway UI / copy-paste sometimes saves names with leading/trailing
 *    spaces (e.g. `RAILWAY_PROJECT_TOKEN `), which breaks exact lookups — we match `key.trim()`.
 * 3) **Value trim**: strips accidental surrounding quotes from values.
 */

import { readFileSync } from "node:fs";

let linuxEnvironCache: Record<string, string> | null | undefined;

function parseLinuxEnviron(): Record<string, string> | null {
  if (linuxEnvironCache !== undefined) return linuxEnvironCache;
  if (typeof process === "undefined" || process.platform === "win32") {
    linuxEnvironCache = null;
    return null;
  }
  try {
    const buf = readFileSync("/proc/self/environ");
    const out: Record<string, string> = {};
    let start = 0;
    for (let i = 0; i <= buf.length; i++) {
      if (i === buf.length || buf[i] === 0) {
        if (i > start) {
          const line = buf.subarray(start, i).toString("utf8");
          const eq = line.indexOf("=");
          if (eq > 0) {
            out[line.slice(0, eq)] = line.slice(eq + 1);
          }
        }
        start = i + 1;
      }
    }
    linuxEnvironCache = out;
    return out;
  } catch {
    linuxEnvironCache = null;
    return null;
  }
}

function normalizeEnvValue(v: string): string {
  let s = v.trim();
  if (s.length >= 2) {
    const q = s[0];
    if (
      (q === '"' || q === "'") &&
      s[s.length - 1] === q
    ) {
      s = s.slice(1, -1);
    }
  }
  return s.trim();
}

/** Resolve env by exact key, then by trimmed key equality (fixes stray spaces in var names). */
export function runtimeEnv(preferredKey: string): string | undefined {
  const want = preferredKey.trim();
  const fromProc = parseLinuxEnviron();

  if (fromProc) {
    if (Object.prototype.hasOwnProperty.call(fromProc, preferredKey)) {
      const raw = fromProc[preferredKey];
      if (raw !== undefined && raw !== "") {
        const n = normalizeEnvValue(raw);
        if (n) return n;
      }
    }
    for (const [k, v] of Object.entries(fromProc)) {
      if (k.trim() === want && v !== undefined && v !== "") {
        const n = normalizeEnvValue(v);
        if (n) return n;
      }
    }
  }

  if (typeof process !== "undefined" && process.env) {
    const e = process.env;
    if (e[preferredKey] !== undefined && e[preferredKey] !== "") {
      const n = normalizeEnvValue(e[preferredKey]!);
      if (n) return n;
    }
    for (const k of Object.keys(e)) {
      if (k.trim() === want && e[k] !== undefined && e[k] !== "") {
        const n = normalizeEnvValue(e[k]!);
        if (n) return n;
      }
    }
  }

  return undefined;
}

/** Order: project token (header) first, then account bearer tokens. */
const PROJECT_ACCESS_TOKEN_KEYS = [
  "RAILWAY_PROJECT_TOKEN",
  "DASHBOARD_RAILWAY_PROJECT_TOKEN",
] as const;

const ACCOUNT_BEARER_TOKEN_KEYS = [
  "RAILWAY_API_TOKEN",
  "RAILWAY_TOKEN",
  "DASHBOARD_RAILWAY_API_TOKEN",
] as const;

const ALL_TOKEN_KEYS = [
  ...PROJECT_ACCESS_TOKEN_KEYS,
  ...ACCOUNT_BEARER_TOKEN_KEYS,
] as const;

export function debugEnvEnabled(): boolean {
  return (
    runtimeEnv("DASHBOARD_DEBUG_ENV") === "1" ||
    runtimeEnv("DASHBOARD_DEBUG_ENV") === "true"
  );
}

let railwayEnvDebugLoggedOnce = false;

/** When `DASHBOARD_DEBUG_ENV=1`, logs a safe snapshot once per process (no secret values). */
function logRailwayEnvDebugOnce(): void {
  if (!debugEnvEnabled() || railwayEnvDebugLoggedOnce) return;
  railwayEnvDebugLoggedOnce = true;
  logRailwayEnvToConsole();
}

export function hasRailwayGraphqlCredential(): boolean {
  logRailwayEnvDebugOnce();
  return (
    PROJECT_ACCESS_TOKEN_KEYS.some((k) => Boolean(runtimeEnv(k))) ||
    ACCOUNT_BEARER_TOKEN_KEYS.some((k) => Boolean(runtimeEnv(k)))
  );
}

/** Safe diagnostics — no secret values, only presence and lengths. */
export function getRailwayEnvDebugSnapshot(): {
  platform: string;
  linuxProcParsed: boolean;
  rawProcKeyCount: number;
  /** Keys containing RAILWAY or DASHBOARD (names only, trimmed for display) */
  relevantKeys: string[];
  tokens: Record<
    string,
    { present: boolean; valueLength: number; rawKeyMatched?: string }
  >;
  hasCredential: boolean;
  /** FastAPI log proxy target for `/api/logs` (URL length only, not the URL string). */
  dashboardBackendUrl: { configured: boolean; valueLength: number };
} {
  const fromProc = parseLinuxEnviron();
  const relevantKeys: string[] = [];
  const seen = new Set<string>();

  const collectKeys = (entries: Record<string, string | undefined> | undefined) => {
    if (!entries) return;
    for (const k of Object.keys(entries)) {
      const t = k.trim();
      if (
        (t.includes("RAILWAY") || t.includes("DASHBOARD") || t.includes("VISIBILITY")) &&
        !seen.has(t)
      ) {
        seen.add(t);
        relevantKeys.push(
          k !== k.trim() ? `${t} (variable name had leading/trailing spaces)` : t
        );
      }
    }
  };

  collectKeys(fromProc ?? undefined);
  if (typeof process !== "undefined" && process.env) {
    collectKeys(process.env as Record<string, string>);
  }
  relevantKeys.sort();

  const tokens: Record<
    string,
    { present: boolean; valueLength: number; rawKeyMatched?: string }
  > = {};

  for (const name of ALL_TOKEN_KEYS) {
    let rawKeyMatched: string | undefined;
    let val: string | undefined;

    if (fromProc && fromProc[name] !== undefined) {
      val = fromProc[name];
      rawKeyMatched = Object.keys(fromProc).find((k) => k === name) ?? name;
    } else if (fromProc) {
      const found = Object.entries(fromProc).find(([k]) => k.trim() === name);
      if (found) {
        rawKeyMatched = found[0];
        val = found[1];
      }
    }

    if (val === undefined && typeof process !== "undefined" && process.env) {
      if (process.env[name] !== undefined) {
        val = process.env[name];
        rawKeyMatched = name;
      } else {
        const found = Object.keys(process.env).find((k) => k.trim() === name);
        if (found) {
          rawKeyMatched = found;
          val = process.env[found];
        }
      }
    }

    const normalized = val ? normalizeEnvValue(val) : "";
    tokens[name] = {
      present: Boolean(normalized),
      valueLength: normalized.length,
      ...(rawKeyMatched && rawKeyMatched !== name
        ? { rawKeyMatched }
        : {}),
    };
  }

  const hasCredential = ALL_TOKEN_KEYS.some((k) => tokens[k].present);

  const dashBack = runtimeEnv("DASHBOARD_BACKEND_URL");
  const dashBackNorm = dashBack ? normalizeEnvValue(dashBack) : "";

  return {
    platform: typeof process !== "undefined" ? process.platform : "unknown",
    linuxProcParsed: fromProc !== null,
    rawProcKeyCount: fromProc ? Object.keys(fromProc).length : 0,
    relevantKeys,
    tokens,
    hasCredential,
    dashboardBackendUrl: {
      configured: Boolean(dashBackNorm),
      valueLength: dashBackNorm.length,
    },
  };
}

function logRailwayEnvToConsole(): void {
  try {
    const s = getRailwayEnvDebugSnapshot();
    console.info("[dashboard] RAILWAY env debug (no secret values)", {
      platform: s.platform,
      linuxProcParsed: s.linuxProcParsed,
      rawProcKeyCount: s.rawProcKeyCount,
      relevantKeys: s.relevantKeys,
      tokens: s.tokens,
      hasCredential: s.hasCredential,
      dashboardBackendUrl: s.dashboardBackendUrl,
    });
  } catch (e) {
    console.warn("[dashboard] RAILWAY env debug failed", e);
  }
}

export function getRailwayGraphqlAuthHeaders(): Record<string, string> {
  for (const key of PROJECT_ACCESS_TOKEN_KEYS) {
    const v = runtimeEnv(key);
    if (v) return { "Project-Access-Token": v };
  }
  for (const key of ACCOUNT_BEARER_TOKEN_KEYS) {
    const v = runtimeEnv(key);
    if (v) return { Authorization: `Bearer ${v}` };
  }
  throw new Error(
    "Set RAILWAY_PROJECT_TOKEN or RAILWAY_API_TOKEN for Railway visibility"
  );
}
