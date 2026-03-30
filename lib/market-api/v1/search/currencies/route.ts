import { sql, type SQL } from "drizzle-orm";
import type { ApiContext } from "@/lib/market-api/core/context";

import { db } from "@tradinggoose/db";
import { resolveIconUrl } from "../utils";
import { uniqueNonEmpty } from "../parsing";
import { resolveSearchParams } from "../params";

type CurrencySearchRow = {
  id: string;
  code: string;
  name: string;
  iconUrl: string | null;
};

function parsePositiveInt(value: string | null | undefined, fallback: number, max?: number) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.max(Math.floor(parsed), 1);
  if (typeof max === "number") return Math.min(normalized, max);
  return normalized;
}

export async function fetchCurrencyById(
  request: Request,
  currencyId: string
): Promise<CurrencySearchRow | null> {
  if (!db) {
    throw new Error("Database connection is not configured.");
  }

  const trimmedId = currencyId.trim();
  if (!trimmedId) return null;

  const rows = (await db.execute(sql`
    SELECT id, code, name, icon_url AS "iconUrl"
    FROM currencies
    WHERE id = ${trimmedId}
    LIMIT 1
  `)) as unknown as CurrencySearchRow[];

  const row = rows[0];
  if (!row) return null;

  return {
    ...row,
    iconUrl: resolveIconUrl(request, row.iconUrl)
  };
}

export async function fetchCurrenciesByIds(
  request: Request,
  currencyIds: string[]
): Promise<Map<string, CurrencySearchRow>> {
  if (!db) {
    throw new Error("Database connection is not configured.");
  }

  const ids = uniqueNonEmpty(
    currencyIds.map((id) => id.trim()).filter((id) => id.length > 0)
  );
  if (!ids.length) return new Map();

  const rows = (await db.execute(sql`
    SELECT id, code, name, icon_url AS "iconUrl"
    FROM currencies
    WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
  `)) as unknown as CurrencySearchRow[];

  const resolved = rows.map((row) => ({
    ...row,
    iconUrl: resolveIconUrl(request, row.iconUrl)
  }));

  return new Map(resolved.map((row) => [row.id, row]));
}

export async function getSearchCurrencies(c: ApiContext) {
  try {
    if (!db) {
      return c.json({ data: [], error: "Database connection is not configured." }, 503);
    }

    const request = c.req.raw;
    const searchParams = await resolveSearchParams(request);
    const currencyId = searchParams.get("currency_id")?.trim();
    const currencyName = searchParams.get("currency_name")?.trim();
    const currencyCode = searchParams.get("currency_code")?.trim();
    const currencyQuery = searchParams.get("currency_query")?.trim();
    const limit = parsePositiveInt(searchParams.get("limit"), 200, 500);

    if (currencyId) {
      return c.json(
        { data: [], error: "currency_id is not supported on /search/currencies. Use /get/currency instead." },
        400
      );
    }

    if (!currencyId && !currencyName && !currencyCode && !currencyQuery) {
      return c.json({ data: [], error: "At least one search parameter is required." }, 400);
    }

    const filters: SQL[] = [];
    if (currencyName) {
      filters.push(sql`COALESCE(name, '') ILIKE ${`%${currencyName}%`}`);
    }
    if (currencyCode) {
      filters.push(sql`COALESCE(code, '') ILIKE ${`%${currencyCode}%`}`);
    }
    if (currencyQuery) {
      const pattern = `%${currencyQuery}%`;
      filters.push(
        sql`(
          id ILIKE ${pattern} OR
          code ILIKE ${pattern} OR
          COALESCE(name, '') ILIKE ${pattern}
        )`
      );
    }

    const whereClause = sql`WHERE ${sql.join(filters, sql` AND `)}`;

    const rows = (await db.execute(sql`
      SELECT id, code, name, icon_url AS "iconUrl"
      FROM currencies
      ${whereClause}
      ORDER BY code ASC
      LIMIT ${limit}
    `)) as unknown as CurrencySearchRow[];

    const data = rows.map((row) => ({
      ...row,
      iconUrl: resolveIconUrl(request, row.iconUrl)
    }));

    return c.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[search/currencies] API error:", message);
    return c.json({ data: [], error: message }, 500);
  }
}
