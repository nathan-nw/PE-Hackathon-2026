/** Normalize API origin (no trailing slash). */
export function normalizeBase(url: string): string {
  return (url || "").replace(/\/+$/, "");
}

/**
 * Use "localhost" instead of 127.0.0.1 when the page is on http(s)://localhost
 * to avoid Chrome Private Network Access issues in some setups.
 */
export function normalizeLoopbackHost(base: string): string {
  try {
    if (!/^https?:\/\//i.test(base)) return base;
    if (typeof window === "undefined") return base;
    const loc = window.location.hostname;
    if (loc !== "localhost" && loc !== "127.0.0.1") return base;
    const u = new URL(base);
    if (u.hostname === "127.0.0.1" || u.hostname === "[::1]") {
      u.hostname = "localhost";
      return u.toString().replace(/\/+$/, "");
    }
  } catch {
    /* ignore */
  }
  return base;
}

export function fkId(v: unknown): number | string | null {
  if (v && typeof v === "object" && v !== null && "id" in v) {
    const id = (v as { id: unknown }).id;
    if (id != null) return id as number | string;
  }
  return v as number | string | null;
}

export function formatWhen(iso: string | null | undefined): string {
  if (iso == null || iso === "") return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString();
  } catch {
    return String(iso);
  }
}

export function shortFull(base: string, code: string): string {
  return `${base}/${encodeURIComponent(code)}`;
}
