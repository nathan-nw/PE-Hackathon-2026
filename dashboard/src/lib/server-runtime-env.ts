/**
 * Read env vars without static `process.env.FOO` access.
 *
 * Next.js replaces `process.env.NAME` at **build** time. Railway only injects
 * secrets (e.g. RAILWAY_PROJECT_TOKEN) at **container runtime**, not during
 * `npm run build` in Docker — so inlined tokens become permanently `undefined`.
 * Dynamic `process.env[key]` is not substituted and reflects real runtime env.
 */

export function runtimeEnv(key: string): string | undefined {
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
