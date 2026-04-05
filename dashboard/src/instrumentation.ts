/**
 * Prefer IPv4 when resolving `*.railway.internal` — Node's fetch (undici) can fail or time out
 * when IPv6 is returned first for private Railway hostnames.
 * @see https://nodejs.org/api/dns.html#dnssetdefaultresultorderorder
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const dns = await import("node:dns");
    if (typeof dns.setDefaultResultOrder === "function") {
      dns.setDefaultResultOrder("ipv4first");
    }
  }
}
