import { NextResponse } from "next/server";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@tradinggoose/db";
import { fetchExchangesFromDb, type ExchangesQuery } from "./lib";
import { apiRequireEditor } from "@/lib/auth/session";

export const runtime = "nodejs";

type ExchangeOptionRow = {
  id: string;
  mic: string;
  name: string | null;
};

function parseBoolean(value?: string | null) {
  if (!value) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function parsePositiveInt(value: string | null | undefined, fallback: number, max?: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.max(Math.floor(parsed), 1);
  if (typeof max === "number") return Math.min(normalized, max);
  return normalized;
}

function normalizeNullableString(value?: string | null) {
  if (value === undefined) return undefined;
  if (value === "") return null;
  return value;
}

function parseOptionalDate(value?: string | null) {
  const normalized = normalizeNullableString(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date value.");
  }
  return parsed;
}

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

    // Option mode (used by selects and existing listing form)
    if (!isTableRequest) {
      const query = searchParams.get("query")?.trim();
      const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "50"), 1), 50);

      const filters: SQL[] = [];
      if (query) {
        filters.push(sql`(mic ILIKE ${`%${query}%`} OR name ILIKE ${`%${query}%`})`);
      }

      const whereClause = filters.length ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;

      const rows = (await db.execute(sql`
        SELECT id, mic, name
        FROM exchanges
        ${whereClause}
        ORDER BY mic ASC
        LIMIT ${limit}
      `)) as ExchangeOptionRow[];

      return NextResponse.json({ data: rows });
    }

    // Table mode (paginated)
    const page = parsePositiveInt(pageParam, 1);
    const pageSize = parsePositiveInt(pageSizeParam, 10, 100);
    const id = searchParams.get("id")?.trim();
    const countryParam = searchParams.get("countryId")?.trim();
    const cityParam = searchParams.get("cityId")?.trim();
    const active = parseBoolean(searchParams.get("active"));

    const query: ExchangesQuery = {
      page,
      pageSize,
      id,
      countryId: countryParam === "__null__" ? null : countryParam || undefined,
      cityId: cityParam === "__null__" ? null : cityParam || undefined,
      active
    };

    const payload = await fetchExchangesFromDb(query);

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[exchanges] API error:", message);
    return NextResponse.json({ data: [], total: 0, error: message }, { status: 500 });
  }
}

const createExchangeSchema = z.object({
  mic: z.string().trim().min(1).max(16),
  name: z.union([z.string().trim().max(255), z.literal(""), z.null()]).optional(),
  lei: z.union([z.string().trim().max(32), z.literal(""), z.null()]).optional(),
  url: z.union([z.string().trim().max(2048), z.literal(""), z.null()]).optional(),
  createdAt: z.union([z.string().trim(), z.literal(""), z.null()]).optional(),
  expiredAt: z.union([z.string().trim(), z.literal(""), z.null()]).optional(),
  countryId: z.union([z.string().trim(), z.literal(""), z.null()]).optional(),
  cityId: z.union([z.string().trim(), z.literal(""), z.null()]).optional(),
  active: z.boolean().optional(),
  isSegment: z.boolean().optional(),
  parentId: z.union([z.string().trim(), z.literal(""), z.null()]).optional()
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

  let payload: z.infer<typeof createExchangeSchema>;
  try {
    payload = createExchangeSchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.errors[0]?.message ?? "Invalid payload." : "Invalid payload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const mic = payload.mic.trim();
  const name = normalizeNullableString(payload.name) ?? null;
  const lei = normalizeNullableString(payload.lei) ?? null;
  const url = normalizeNullableString(payload.url) ?? null;
  let createdAt: Date | null = null;
  let expiredAt: Date | null = null;
  try {
    createdAt = parseOptionalDate(payload.createdAt);
    expiredAt = parseOptionalDate(payload.expiredAt);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid date value.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const countryId = normalizeNullableString(payload.countryId) ?? null;
  const cityId = normalizeNullableString(payload.cityId) ?? null;
  const active = payload.active ?? true;
  const isSegment = payload.isSegment ?? false;
  const parentId = isSegment ? normalizeNullableString(payload.parentId) ?? null : null;

  let newId: string | null = null;
  try {
    const result = await db
      .insert(schema.exchanges)
      .values({ mic, name, lei, url, createdAt, expiredAt, countryId, cityId, active, isSegment, parentId })
      .returning({ id: schema.exchanges.id });

    newId = result[0]?.id ?? null;
  } catch (error: any) {
    if (error?.code === "23505") {
      return NextResponse.json({ error: "Exchange already exists." }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "Failed to create exchange.";
    console.error("[exchanges:create] API error:", message);
    return NextResponse.json({ error: "Failed to create exchange." }, { status: 500 });
  }

  if (!newId) {
    return NextResponse.json({ error: "Failed to create exchange." }, { status: 500 });
  }

  const refreshed = await fetchExchangesFromDb({
    page: 1,
    pageSize: 1,
    id: newId
  });

  const createdExchange = refreshed.data.find(row => row.id === newId) ?? null;

  return NextResponse.json({ data: createdExchange }, { status: 201 });
}
