import { sql, type SQL } from "drizzle-orm";
import type { ApiContext } from "@/lib/market-api/core/context";

import { db } from "@tradinggoose/db";
import { parseListParam } from "../parsing";
import { resolveSearchParams } from "../params";

type CitySearchRow = {
  id: string;
  name: string;
  countryId: string | null;
};

export type CitySearchParams = {
  cityId?: string | null;
  cityName?: string | null;
  countryIds?: string[] | null;
  limit?: string | null;
};

function parsePositiveInt(value: string | null | undefined, fallback: number, max?: number) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.max(Math.floor(parsed), 1);
  if (typeof max === "number") return Math.min(normalized, max);
  return normalized;
}

export async function searchCitiesRows(params: CitySearchParams) {
  if (!db) {
    throw new Error("Database connection is not configured.");
  }

  const cityId = params.cityId?.trim() ?? "";
  const cityName = params.cityName?.trim() ?? "";
  const countryIds = params.countryIds?.filter(Boolean) ?? [];
  const limit = parsePositiveInt(params.limit ?? null, 200, 500);

  if (!cityId && !cityName && !countryIds.length) {
    return [] as CitySearchRow[];
  }

  const filters: SQL[] = [];
  if (countryIds.length) {
    if (countryIds.length === 1) {
      filters.push(sql`country_id = ${countryIds[0]}`);
    } else {
      filters.push(sql`country_id IN (${sql.join(countryIds.map((id) => sql`${id}`), sql`, `)})`);
    }
  }
  if (cityId) {
    filters.push(sql`id = ${cityId}`);
  }
  if (cityName) {
    filters.push(sql`COALESCE(name, '') ILIKE ${`%${cityName}%`}`);
  }

  const whereClause = sql`WHERE ${sql.join(filters, sql` AND `)}`;

  const rows = (await db.execute(sql`
    SELECT id, name, country_id AS "countryId"
    FROM cities
    ${whereClause}
    ORDER BY name ASC
    LIMIT ${limit}
  `)) as unknown as CitySearchRow[];

  return rows;
}

export async function getSearchCities(c: ApiContext) {
  try {
    if (!db) {
      return c.json({ data: [], error: "Database connection is not configured." }, 503);
    }

    const request = c.req.raw;
    const searchParams = await resolveSearchParams(request);
    const cityId = searchParams.get("city_id")?.trim();
    const cityName = searchParams.get("city_name")?.trim();
    const countryIds = parseListParam(searchParams, "country_id");

    if (!cityId && !cityName && !countryIds.length) {
      return c.json({ data: [], error: "At least one search parameter is required." }, 400);
    }

    const rows = await searchCitiesRows({
      cityId,
      cityName,
      countryIds,
      limit: searchParams.get("limit")
    });

    return c.json({ data: rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[search/cities] API error:", message);
    return c.json({ data: [], error: message }, 500);
  }
}
