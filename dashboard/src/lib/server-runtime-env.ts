/**
 * Read env vars in a way that survives Next.js build-time `process.env` inlining.
 *
 * 1) On Linux (Railway, Docker), `/proc/self/environ` reflects the **real** process
 *    environment at runtime — secrets injected by the platform are visible here even
 *    when Webpack/Turbopack replaced `process.env.FOO` with `undefined` in the bundle.
 * 2) Fallback: `process.env[key]` (dynamic key) for local dev (Windows/macOS) where
 *    `/proc` does not exist.
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

export function runtimeEnv(key: string): string | undefined {
  const fromProc = parseLinuxEnviron();
  if (fromProc && Object.prototype.hasOwnProperty.call(fromProc, key)) {
    const v = fromProc[key];
    if (v === undefined || v === "") return undefined;
    return v;
  }
  if (typeof process === "undefined") return undefined;
  const v = process.env[key];
  if (v === undefined || v === "") return undefined;
  return v;
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

export function hasRailwayGraphqlCredential(): boolean {
  for (const key of PROJECT_ACCESS_TOKEN_KEYS) {
    if (runtimeEnv(key)?.trim()) return true;
  }
  for (const key of ACCOUNT_BEARER_TOKEN_KEYS) {
    if (runtimeEnv(key)?.trim()) return true;
  }
  return false;
}

export function getRailwayGraphqlAuthHeaders(): Record<string, string> {
  for (const key of PROJECT_ACCESS_TOKEN_KEYS) {
    const v = runtimeEnv(key)?.trim();
    if (v) return { "Project-Access-Token": v };
  }
  for (const key of ACCOUNT_BEARER_TOKEN_KEYS) {
    const v = runtimeEnv(key)?.trim();
    if (v) return { Authorization: `Bearer ${v}` };
  }
  throw new Error(
    "Set RAILWAY_PROJECT_TOKEN or RAILWAY_API_TOKEN for Railway visibility"
  );
}
