import { NextResponse } from "next/server";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@tradinggoose/db";
import { fetchTimeZonesFromDb, type TimeZonesQuery } from "./lib";
import { apiRequireEditor } from "@/lib/auth/session";

export const runtime = "nodejs";

type TimeZoneOptionRow = {
  id: string;
  name: string;
  offset: string;
  offsetDst: string | null;
  observesDst: boolean;
};

function parsePositiveInt(value: string | null | undefined, fallback: number, max?: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.max(Math.floor(parsed), 1);
  if (typeof max === "number") return Math.min(normalized, max);
  return normalized;
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
      const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "500"), 1), 1000);

      const filters: SQL[] = [];
      if (query) {
        filters.push(
          sql`(id ILIKE ${`%${query}%`} OR name ILIKE ${`%${query}%`} OR "offset" ILIKE ${`%${query}%`} OR "offset_dst" ILIKE ${`%${query}%`})`
        );
      }

      const whereClause = filters.length ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;

      const rows = (await db.execute(sql`
        SELECT id, name, "offset", "offset_dst" AS "offsetDst", "observes_dst" AS "observesDst"
        FROM time_zones
        ${whereClause}
        ORDER BY name ASC
        LIMIT ${limit}
      `)) as TimeZoneOptionRow[];

      return NextResponse.json({ data: rows });
    }

    // Table (paginated) mode
    const page = parsePositiveInt(pageParam, 1);
    const pageSize = parsePositiveInt(pageSizeParam, 10, 1000);
    const id = searchParams.get("id")?.trim();
    const name = searchParams.get("name")?.trim();
    const offset = searchParams.get("offset")?.trim();

    const query: TimeZonesQuery = {
      page,
      pageSize,
      id,
      name,
      offset
    };

    const payload = await fetchTimeZonesFromDb(query);

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[time-zones] API error:", message);
    return NextResponse.json({ data: [], total: 0, error: message }, { status: 500 });
  }
}

const createTimeZoneSchema = z.object({
  name: z.string().trim().min(1).max(255),
  offset: z.string().trim().min(1).max(32),
  offsetDst: z.string().trim().min(1).max(32).nullable().optional(),
  observesDst: z.boolean().optional()
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

  let payload: z.infer<typeof createTimeZoneSchema>;
  try {
    payload = createTimeZoneSchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.errors[0]?.message ?? "Invalid payload." : "Invalid payload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const name = payload.name.trim();
  const offset = payload.offset.trim();
  const normalizedOffsetDst =
    payload.offsetDst === undefined || payload.offsetDst === null ? null : payload.offsetDst.trim();
  const observesDst = payload.observesDst ?? Boolean(normalizedOffsetDst);
  const offsetDst = observesDst ? normalizedOffsetDst : null;

  if (observesDst && !offsetDst) {
    return NextResponse.json(
      { error: "DST offset is required when daylight saving time is enabled." },
      { status: 400 }
    );
  }

  let newId: string | null = null;
  try {
    const result = await db
      .insert(schema.timeZones)
      .values({ name, offset, offsetDst, observesDst })
      .returning({ id: schema.timeZones.id });

    newId = result[0]?.id ?? null;
  } catch (error: any) {
    if (error?.code === "23505") {
      return NextResponse.json({ error: "Time zone already exists." }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "Failed to create time zone.";
    console.error("[time-zones:create] API error:", message);
    return NextResponse.json({ error: "Failed to create time zone." }, { status: 500 });
  }

  if (!newId) {
    return NextResponse.json({ error: "Failed to create time zone." }, { status: 500 });
  }

  const refreshed = await fetchTimeZonesFromDb({
    page: 1,
    pageSize: 1,
    id: newId
  });

  const createdTimeZone = refreshed.data.find(row => row.id === newId) ?? null;

  return NextResponse.json({ data: createdTimeZone }, { status: 201 });
}
