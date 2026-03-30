import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@tradinggoose/db";
import { fetchMarketHoursFromDb, type MarketHoursQuery } from "./lib";

export const runtime = "nodejs";

function parsePositiveInt(value: string | null | undefined, fallback: number, max?: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.max(Math.floor(parsed), 1);
  if (typeof max === "number") return Math.min(normalized, max);
  return normalized;
}

const assetClassEnum = z.enum(["stock", "etf", "indice", "mutualfund", "future", "crypto", "currency"]);

export async function GET(request: Request) {
  try {
    if (!db) {
      return NextResponse.json(
        { data: [], total: 0, error: "Database connection is not configured." },
        { status: 503 }
      );
    }

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
