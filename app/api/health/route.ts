import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const response = NextResponse.json({ status: "ok", service: "market-api", runtime: "LOCAL" });
  response.headers.set("x-market-api", "next");
  return response;
}
