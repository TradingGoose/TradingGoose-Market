import { NextResponse } from "next/server";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@tradinggoose/db";
import { fetchMarketsFromDb, type MarketsQuery } from "./lib";
import { apiRequireEditor } from "@/lib/auth/session";
import { parsePositiveInt, normalizeNullableString } from "@/lib/api-utils";
import {
  runAppRouteAdminReadEnrichers,
  runAppRouteAfterWriteEnricher
} from "@/lib/market-api/plugins/app-routes";

export const runtime = "nodejs";

type MarketOptionRow = {
  id: string;
  code: string;
  name: string | null;
};

export async function GET(request: Request) {
  try {
    if (!db) {
      return NextResponse.json(
        { data: [], error: "Database connection is not configured." },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(request.url);
    const pageParam = searchParams.get("page");
    const pageSizeParam = searchParams.get("pageSize");
    const isTableRequest = pageParam !== null || pageSizeParam !== null;

    if (!isTableRequest) {
      const query = searchParams.get("query")?.trim();
      const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "200"), 1), 500);

      const filters: SQL[] = [];
      if (query) {
        filters.push(sql`(code ILIKE ${`%${query}%`} OR COALESCE(name, '') ILIKE ${`%${query}%`})`);
      }

      const whereClause = filters.length ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;

      const rows = (await db.execute(sql`
        SELECT id, code, name
        FROM markets
        ${whereClause}
        ORDER BY code ASC
        LIMIT ${limit}
      `)) as MarketOptionRow[];

      return NextResponse.json({ data: rows });
    }

    const page = parsePositiveInt(pageParam, 1);
    const pageSize = parsePositiveInt(pageSizeParam, 10, 100);
    const id = searchParams.get("id")?.trim();
    const code = searchParams.get("code")?.trim();
    const name = searchParams.get("name")?.trim();
    const countryIdParam = searchParams.get("countryId")?.trim();
    const cityIdParam = searchParams.get("cityId")?.trim();
    const timeZoneIdParam = searchParams.get("timeZoneId")?.trim();

    const query: MarketsQuery = {
      page,
      pageSize,
      id,
      code,
      name,
      countryId: countryIdParam === "__null__" ? null : countryIdParam || undefined,
      cityId: cityIdParam === "__null__" ? null : cityIdParam || undefined,
      timeZoneId: timeZoneIdParam === "__null__" ? null : timeZoneIdParam || undefined
    };

    const payload = await fetchMarketsFromDb(query);
    const data = await runAppRouteAdminReadEnrichers(request, "market", payload.data);

    return NextResponse.json({ ...payload, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[markets] API error:", message);
    return NextResponse.json({ data: [], total: 0, error: message }, { status: 500 });
  }
}

const createMarketSchema = z.object({
  code: z.string().trim().min(1).max(16),
  name: z.string().trim().min(1).max(255),
  countryId: z.string().trim().min(1),
  cityId: z.union([z.string().trim(), z.literal(""), z.null()]).optional(),
  timeZoneId: z.union([z.string().trim(), z.literal(""), z.null()]).optional(),
  url: z.union([z.string().trim().max(2048), z.literal(""), z.null()]).optional()
});

export async function POST(request: Request) {
  const auth = await apiRequireEditor();
  if (auth.error) return auth.error;

  if (!db) {
    return NextResponse.json(
      { error: "Database connection is not configured." },
      { status: 503 }
    );
  }

  let payload: z.infer<typeof createMarketSchema>;
  try {
    payload = createMarketSchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.errors[0]?.message ?? "Invalid payload." : "Invalid payload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const code = payload.code.trim();
  const name = payload.name.trim();
  const countryId = payload.countryId.trim();
  const cityId = normalizeNullableString(payload.cityId) ?? null;
  const timeZoneId = normalizeNullableString(payload.timeZoneId) ?? null;
  const url = normalizeNullableString(payload.url) ?? null;

  let newId: string | null = null;
  try {
    const result = await db
      .insert(schema.markets)
      .values({ code, name, countryId, cityId, timeZoneId, url })
      .returning({ id: schema.markets.id });

    newId = result[0]?.id ?? null;
  } catch (error: any) {
    if (error?.code === "23505") {
      return NextResponse.json({ error: "Market already exists." }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "Failed to create market.";
    console.error("[markets:create] API error:", message);
    return NextResponse.json({ error: "Failed to create market." }, { status: 500 });
  }

  if (!newId) {
    return NextResponse.json({ error: "Failed to create market." }, { status: 500 });
  }

  const refreshed = await fetchMarketsFromDb({
    page: 1,
    pageSize: 1,
    id: newId
  });

  const createdMarket = refreshed.data.find(row => row.id === newId) ?? null;
  const data = await runAppRouteAfterWriteEnricher(request, "market", createdMarket, auth.user.id);

  return NextResponse.json({ data }, { status: 201 });
}
