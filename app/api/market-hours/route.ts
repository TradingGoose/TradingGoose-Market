import { NextResponse } from "next/server";
import { z } from "zod";


import { fetchMarketHoursFromDb, type MarketHoursQuery } from "./lib";
import { parsePositiveInt } from "@/lib/api-utils";
import { createSystemAdminRoutePolicy } from "@/lib/market-api/core/entity-route";


export const runtime = "nodejs";
const routePolicy = createSystemAdminRoutePolicy("/api/market-hours");

const assetClassEnum = z.enum(["stock", "etf", "indice", "mutualfund", "future", "crypto", "currency"]);

export async function GET(request: Request) {
  const auth = await routePolicy.authorize(request);
  if (auth.error) return auth.error;

  try {

    const { searchParams } = new URL(request.url);
    const page = parsePositiveInt(searchParams.get("page"), 1);
    const pageSize = parsePositiveInt(searchParams.get("pageSize"), 10, 200);
    const search = searchParams.get("q")?.trim() || searchParams.get("id")?.trim() || undefined;
    const countryIdParam = searchParams.get("countryId")?.trim();
    const marketIdParam = searchParams.get("marketId")?.trim();
    const assetClassParam = searchParams.get("assetClass")?.trim();

    const countryId = countryIdParam === "__null__" ? null : countryIdParam || undefined;
    const marketId = marketIdParam === "__null__" ? null : marketIdParam || undefined;
    const assetClass = assetClassParam ? assetClassEnum.safeParse(assetClassParam.toLowerCase()).success ? assetClassParam.toLowerCase() : undefined : undefined;

    const query: MarketHoursQuery = {
      page,
      pageSize,
      search,
      countryId,
      marketId,
      assetClass
    };

    const payload = await fetchMarketHoursFromDb(query);
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[market-hours] API error:", message);
    return NextResponse.json({ data: [], total: 0, error: message }, { status: 500 });
  }
}

export const HEAD = (request: Request) => routePolicy.head(request, GET);
export const OPTIONS = routePolicy.options;
export const POST = routePolicy.post;
export const PUT = routePolicy.put;
export const PATCH = routePolicy.patch;
export const DELETE = routePolicy.delete;
