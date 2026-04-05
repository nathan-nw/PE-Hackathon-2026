/**
 * Base URL for the dashboard to call its own Route Handlers from server-side tool code.
 * Browser `Origin` can be :3001 while the process listens on PORT (e.g. 3000) in Docker — avoid that mismatch.
 */
export function dashboardSelfOrigin(): string {
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    const host = vercel.replace(/^https?:\/\//, "");
    return `https://${host}`;
  }
  const port = process.env.PORT || "3000";
  return `http://127.0.0.1:${port}`;
}
