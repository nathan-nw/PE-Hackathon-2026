import { NextResponse } from "next/server";

/**
 * Runtime API base for the browser (load balancer URL).
 * Docker / Railway set BACKEND_URL; local dev can use NEXT_PUBLIC_BACKEND_URL at build time
 * or rely on this default.
 */
export async function GET() {
  const backendUrl =
    process.env.BACKEND_URL?.trim() ||
    process.env.NEXT_PUBLIC_BACKEND_URL?.trim() ||
    "http://localhost:18080";
  return NextResponse.json({ backendUrl: backendUrl.replace(/\/+$/, "") });
}
