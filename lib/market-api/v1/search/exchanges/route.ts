import { sql, type SQL } from "drizzle-orm";
import type { ApiContext } from "@/lib/market-api/core/context";

import { db } from "@tradinggoose/db";
import { parseListParam } from "../parsing";
import { resolveSearchParams } from "../params";

type ExchangeSearchRow = {
  id: string;
  mic: string;
  name: string | null;
};

export type ExchangeSearchParams = {
  micId?: string | null;
  micName?: string | null;
  micCode?: string | null;
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

export async function searchExchangesRows(params: ExchangeSearchParams) {
  if (!db) {
    throw new Error("Database connection is not configured.");
  }

  const micId = params.micId?.trim() ?? "";
  const micName = params.micName?.trim() ?? "";
  const micCode = params.micCode?.trim() ?? "";
  const countryIds = params.countryIds?.filter(Boolean) ?? [];
  const limit = parsePositiveInt(params.limit ?? null, 200, 500);

  if (!micId && !micName && !micCode && !countryIds.length) {
    return [] as ExchangeSearchRow[];
  }

  const filters: SQL[] = [];
  filters.push(sql`active = true`);
  if (countryIds.length) {
    if (countryIds.length === 1) {
      filters.push(sql`country_id = ${countryIds[0]}`);
    } else {
      filters.push(sql`country_id IN (${sql.join(countryIds.map((id) => sql`${id}`), sql`, `)})`);
    }
  }
  if (micId) {
    filters.push(sql`id = ${micId}`);
  }
  if (micName) {
    filters.push(sql`COALESCE(name, '') ILIKE ${`%${micName}%`}`);
  }
  if (micCode) {
    filters.push(sql`mic ILIKE ${`%${micCode}%`}`);
  }

  const whereClause = sql`WHERE ${sql.join(filters, sql` AND `)}`;

  const rows = (await db.execute(sql`
    SELECT id, mic, name
    FROM exchanges
    ${whereClause}
    ORDER BY mic ASC
    LIMIT ${limit}
  `)) as unknown as ExchangeSearchRow[];

  return rows;
}

export async function getSearchExchanges(c: ApiContext) {
  try {
    if (!db) {
      return c.json({ data: [], error: "Database connection is not configured." }, 503);
    }

    const request = c.req.raw;
    const searchParams = await resolveSearchParams(request);
    const micId = searchParams.get("exch_id")?.trim();
    const micName = searchParams.get("mic_name")?.trim();
    const micCode = searchParams.get("mic_code")?.trim();
    const countryIds = parseListParam(searchParams, "country_id");

    if (!micId && !micName && !micCode && !countryIds.length) {
      return c.json({ data: [], error: "At least one search parameter is required." }, 400);
    }

    const rows = await searchExchangesRows({
      micId,
      micName,
      micCode,
      countryIds,
      limit: searchParams.get("limit")
    });

    return c.json({ data: rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[search/exchanges] API error:", message);
    return c.json({ data: [], error: message }, 500);
  }
}
