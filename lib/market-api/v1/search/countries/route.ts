import { sql, type SQL } from "drizzle-orm";
import type { ApiContext } from "@/lib/market-api/core/context";

import { db } from "@tradinggoose/db";
import { resolveIconUrl } from "../utils";
import { resolveSearchParams } from "../params";

type CountrySearchRow = {
  id: string;
  code: string;
  name: string;
  iconUrl: string | null;
};

export type CountrySearchParams = {
  countryId?: string | null;
  countryName?: string | null;
  countryCode?: string | null;
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

export async function searchCountriesRows(request: Request, params: CountrySearchParams) {
  if (!db) {
    throw new Error("Database connection is not configured.");
  }

  const countryId = params.countryId?.trim() ?? "";
  const countryName = params.countryName?.trim() ?? "";
  const countryCode = params.countryCode?.trim() ?? "";
  const limit = parsePositiveInt(params.limit ?? null, 200, 500);

  if (!countryId && !countryName && !countryCode) {
    return [] as CountrySearchRow[];
  }

  const filters: SQL[] = [];
  if (countryId) {
    filters.push(sql`id = ${countryId}`);
  }
  if (countryName) {
    filters.push(sql`COALESCE(name, '') ILIKE ${`%${countryName}%`}`);
  }
  if (countryCode) {
    filters.push(sql`COALESCE(code, '') ILIKE ${`%${countryCode}%`}`);
  }

  const whereClause = sql`WHERE ${sql.join(filters, sql` AND `)}`;

  const rows = (await db.execute(sql`
    SELECT id, code, name, icon_url AS "iconUrl"
    FROM countries
    ${whereClause}
    ORDER BY name ASC
    LIMIT ${limit}
  `)) as unknown as CountrySearchRow[];

  return rows.map((row) => ({
    ...row,
    iconUrl: resolveIconUrl(request, row.iconUrl)
  }));
}

export async function getSearchCountries(c: ApiContext) {
  try {
    if (!db) {
      return c.json({ data: [], error: "Database connection is not configured." }, 503);
    }

    const request = c.req.raw;
    const searchParams = await resolveSearchParams(request);
    const countryId = searchParams.get("country_id")?.trim();
    const countryName = searchParams.get("country_name")?.trim();
    const countryCode = searchParams.get("country_code")?.trim();

    if (!countryId && !countryName && !countryCode) {
      return c.json({ data: [], error: "At least one search parameter is required." }, 400);
    }

    const data = await searchCountriesRows(request, {
      countryId,
      countryName,
      countryCode,
      limit: searchParams.get("limit")
    });

    return c.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[search/countries] API error:", message);
    return c.json({ data: [], error: message }, 500);
  }
}
