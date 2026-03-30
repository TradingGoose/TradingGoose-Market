import { NextResponse } from "next/server";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@tradinggoose/db";
import { fetchCitiesFromDb, type CitiesQuery } from "./lib";

export const runtime = "nodejs";

type CityOptionRow = {
  id: string;
  name: string;
  countryId: string;
  countryCode: string | null;
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
      const countryId = searchParams.get("countryId")?.trim();
      const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "200"), 1), 500);

      const filters: SQL[] = [];
      if (query) {
        filters.push(sql`ct.name ILIKE ${`%${query}%`}`);
      }
      if (countryId) {
        filters.push(sql`ct.country_id = ${countryId}`);
      }

      const whereClause = filters.length ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;

      const rows = (await db.execute(sql`
        SELECT ct.id, ct.name, ct.country_id AS "countryId", c.code AS "countryCode"
        FROM cities ct
        LEFT JOIN countries c ON c.id = ct.country_id
        ${whereClause}
        ORDER BY ct.name ASC
        LIMIT ${limit}
      `)) as CityOptionRow[];

      return NextResponse.json({ data: rows });
    }

    // Table (paginated) mode
    const page = parsePositiveInt(pageParam, 1);
    const pageSize = parsePositiveInt(pageSizeParam, 10, 100);
    const id = searchParams.get("id")?.trim();
    const name = searchParams.get("name")?.trim();
    const countryIdParam = searchParams.get("countryId")?.trim();
    const timeZoneIdParam = searchParams.get("timeZoneId")?.trim();

    const query: CitiesQuery = {
      page,
      pageSize,
      id,
      name,
      countryId: countryIdParam === "__null__" ? null : countryIdParam || undefined,
      timeZoneId: timeZoneIdParam === "__null__" ? null : timeZoneIdParam || undefined
    };

    const payload = await fetchCitiesFromDb(query);

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[cities] API error:", message);
    return NextResponse.json({ data: [], total: 0, error: message }, { status: 500 });
  }
}

const createCitySchema = z.object({
  name: z.string().trim().min(1).max(255),
  countryId: z.string().trim().min(1),
  timeZoneId: z.string().trim().min(1)
});

export async function POST(request: Request) {
  if (!db) {
    return NextResponse.json(
      { error: "Database connection is not configured." },
      { status: 503 }
    );
  }

  let payload: z.infer<typeof createCitySchema>;
  try {
    payload = createCitySchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.errors[0]?.message ?? "Invalid payload." : "Invalid payload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const name = payload.name.trim();
  const countryId = payload.countryId.trim();
  const timeZoneId = payload.timeZoneId.trim();

  let newId: string | null = null;
  try {
    const result = await db
      .insert(schema.cities)
      .values({ name, countryId, timeZoneId })
      .returning({ id: schema.cities.id });

    newId = result[0]?.id ?? null;
  } catch (error: any) {
    if (error?.code === "23505") {
      return NextResponse.json({ error: "City already exists." }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "Failed to create city.";
    console.error("[cities:create] API error:", message);
    return NextResponse.json({ error: "Failed to create city." }, { status: 500 });
  }

  if (!newId) {
    return NextResponse.json({ error: "Failed to create city." }, { status: 500 });
  }

  const refreshed = await fetchCitiesFromDb({
    page: 1,
    pageSize: 1,
    id: newId
  });

  const createdCity = refreshed.data.find(row => row.id === newId) ?? null;

  return NextResponse.json({ data: createdCity }, { status: 201 });
}
