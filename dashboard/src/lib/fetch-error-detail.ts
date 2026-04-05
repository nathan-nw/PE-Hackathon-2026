/**
 * Surface undici/Node fetch failure causes (DNS, ECONNREFUSED, TLS) in API JSON.
 */

export function formatFetchError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const parts: string[] = [e.name === "AbortError" ? "request timed out" : e.message];
  let c: unknown = e.cause;
  for (let i = 0; i < 6 && c !== undefined && c !== null; i++) {
    if (c instanceof Error) {
      parts.push(c.message);
      c = c.cause;
    } else if (typeof c === "object") {
      const o = c as { code?: string; errno?: number; syscall?: string };
      const bit = [o.syscall, o.code, o.errno].filter(Boolean).join(" ");
      if (bit) parts.push(bit);
      break;
    } else {
      parts.push(String(c));
      break;
    }
  }
  return parts.filter(Boolean).join(" | ");
}
