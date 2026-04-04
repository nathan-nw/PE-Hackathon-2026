/** Maps Compose service name to Flask `INSTANCE_ID` (Kafka log field). */
export function instanceIdFromComposeService(service: string): string | null {
  if (service === "url-shortener-a") return "1";
  if (service === "url-shortener-b") return "2";
  return null;
}

export function labelForInstanceId(id: string): string {
  if (id === "1") return "Replica A (url-shortener-a)";
  if (id === "2") return "Replica B (url-shortener-b)";
  return `Instance ${id}`;
}
