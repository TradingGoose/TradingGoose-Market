import { NextResponse } from "next/server";


import { fetchExchangesForExport } from "../lib";
import { createSystemAdminRoutePolicy } from "@/lib/market-api/core/entity-route";


export const runtime = "nodejs";
const routePolicy = createSystemAdminRoutePolicy("/api/exchanges/export");

export async function GET(_request: Request) {
  const auth = await routePolicy.authorize(_request);
  if (auth.error) return auth.error;

  try {

    const data = await fetchExchangesForExport();
    const body = JSON.stringify(data, null, 2);
    const filename = `exchanges-export-${new Date().toISOString().split("T")[0]}.json`;

    return new Response(body, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[exchanges:export] API error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const HEAD = (request: Request) => routePolicy.head(request, GET);
export const OPTIONS = routePolicy.options;
export const POST = routePolicy.post;
export const PUT = routePolicy.put;
export const PATCH = routePolicy.patch;
export const DELETE = routePolicy.delete;
