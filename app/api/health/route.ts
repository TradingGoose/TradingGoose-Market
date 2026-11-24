import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireDatabase } from "@/lib/db/runtime";
import {
  createManifestMethodPolicy,
  toExplicitHeadResponse,
} from "@/lib/market-api/core/method-guards";

export const runtime = "nodejs";
const methods = createManifestMethodPolicy("/api/health");
const headers = { "x-market-api": "next", "Cache-Control": "no-store" };

export async function GET(_request: Request) {
  try {
    await requireDatabase().execute(sql`
      select 1
      from "user", "system_admin", "market_usage_owner", "subscription",
        "user_stats", "market_api_keys", "market_api_usage_events"
      where false
    `);
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers });
  }
  return NextResponse.json({
    status: "ok",
    service: "tradinggoose-market",
    runtime: "nodejs",
  }, { headers });
}

export const HEAD = (request: Request) => toExplicitHeadResponse(GET(request));
export const POST = methods.POST;
export const PUT = methods.PUT;
export const PATCH = methods.PATCH;
export const DELETE = methods.DELETE;
export const OPTIONS = methods.OPTIONS;
