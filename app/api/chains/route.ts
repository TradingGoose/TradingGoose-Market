import { NextResponse } from "next/server";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@tradinggoose/db";
import { fetchChainsFromDb, type ChainsQuery } from "./lib";
import { apiRequireEditor } from "@/lib/auth/session";

export const runtime = "nodejs";

type ChainOptionRow = {
  id: string;
  code: string;
  name: string;
  iconUrl: string | null;
};

function parsePositiveInt(value: string | null | undefined, fallback: number, max?: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.max(Math.floor(parsed), 1);
  if (typeof max === "number") return Math.min(normalized, max);
  return normalized;
}

function normalizeNullableString(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === "") return null;
  return value;
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

    // Option mode for selects
    if (!isTableRequest) {
      const query = searchParams.get("query")?.trim();
      const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "200"), 1), 500);

      const filters: SQL[] = [];
      if (query) {
        filters.push(sql`(code ILIKE ${`%${query}%`} OR name ILIKE ${`%${query}%`})`);
      }

      const whereClause = filters.length ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;

      const rows = (await db.execute(sql`
        SELECT id, code, name, icon_url AS "iconUrl"
        FROM chains
        ${whereClause}
        ORDER BY code ASC
        LIMIT ${limit}
      `)) as ChainOptionRow[];

      return NextResponse.json({ data: rows });
    }

    // Table (paginated) mode
    const page = parsePositiveInt(pageParam, 1);
    const pageSize = parsePositiveInt(pageSizeParam, 10, 200);
    const id = searchParams.get("id")?.trim();
    const code = searchParams.get("code")?.trim();
    const name = searchParams.get("name")?.trim();

    const query: ChainsQuery = {
      page,
      pageSize,
      id,
      code,
      name
    };

    const payload = await fetchChainsFromDb(query);

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[chains] API error:", message);
    return NextResponse.json({ data: [], total: 0, error: message }, { status: 500 });
  }
}

const createChainSchema = z.object({
  code: z.string().trim().min(1).max(16),
  name: z.string().trim().min(1).max(255),
  iconUrl: z.union([z.string().url().trim(), z.literal(""), z.null()]).optional()
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

  let payload: z.infer<typeof createChainSchema>;
  try {
    payload = createChainSchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.errors[0]?.message ?? "Invalid payload." : "Invalid payload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const code = payload.code.trim().toUpperCase();
  const name = payload.name.trim();
  const iconUrl = normalizeNullableString(payload.iconUrl) ?? null;

  let newId: string | null = null;
  try {
    const result = await db
      .insert(schema.chains)
      .values({ code, name, iconUrl })
      .returning({ id: schema.chains.id });

    newId = result[0]?.id ?? null;
  } catch (error: any) {
    if (error?.code === "23505") {
      return NextResponse.json({ error: "Chain already exists." }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "Failed to create chain.";
    console.error("[chains:create] API error:", message);
    return NextResponse.json({ error: "Failed to create chain." }, { status: 500 });
  }

  if (!newId) {
    return NextResponse.json({ error: "Failed to create chain." }, { status: 500 });
  }

  const refreshed = await fetchChainsFromDb({
    page: 1,
    pageSize: 1,
    id: newId
  });

  const createdChain = refreshed.data.find(row => row.id === newId) ?? null;

  return NextResponse.json({ data: createdChain }, { status: 201 });
}
