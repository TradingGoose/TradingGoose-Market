import { sql, type SQL } from "drizzle-orm";

import { db } from "@tradinggoose/db";

/* ------------------------------------------------------------------ */
/*  Shared PG-error and resolution helpers (used by route.ts & [id])  */
/* ------------------------------------------------------------------ */

export function extractPgErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const anyError = error as { code?: string; cause?: { code?: string } };
  return anyError.code ?? anyError.cause?.code ?? null;
}

export function extractPgConstraint(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const anyError = error as { constraint?: string; cause?: { constraint?: string } };
  return anyError.constraint ?? anyError.cause?.constraint ?? null;
}

export async function resolveCurrencyId(value: string | null) {
  if (!db) return null;
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const result = (await db.execute(sql`
    SELECT id FROM currencies
    WHERE id = ${trimmed} OR code ILIKE ${trimmed}
    ORDER BY CASE WHEN id = ${trimmed} THEN 0 ELSE 1 END
    LIMIT 1
  `)) as { id: string }[];

  return result[0]?.id ?? null;
}

export async function resolveExchId(value: string | null) {
  if (!db) return null;
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const rows = (await db.execute(sql`
    SELECT id
    FROM exchanges
    WHERE id = ${trimmed}
    LIMIT 1
  `)) as { id: string }[];

  return rows[0]?.id ?? null;
}

export async function resolveMarketId(value: string | null) {
  if (!db) return null;
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const rows = (await db.execute(sql`
    SELECT id
    FROM markets
    WHERE id = ${trimmed} OR code ILIKE ${trimmed}
    ORDER BY CASE WHEN id = ${trimmed} THEN 0 ELSE 1 END
    LIMIT 1
  `)) as { id: string }[];

  return rows[0]?.id ?? null;
}

export async function resolveExchIds(values: string[]) {
  if (!db) return [] as string[];
  const tokens = Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  );
  if (!tokens.length) return [] as string[];

  const rows = (await db.execute(sql`
    SELECT id
    FROM exchanges
    WHERE id IN (${sql.join(tokens.map((token) => sql`${token}`), sql`, `)})
  `)) as { id: string }[];

  const idSet = new Set(rows.map((row) => row.id));
  return tokens.filter((token) => idSet.has(token));
}

export type SecondaryExchDetail = {
  id: string;
  mic: string | null;
  name: string | null;
};

export type ListingRow = {
  id: string;
  base: string;
  quote: string | null;
  quoteName: string | null;
  name: string | null;
  iconUrl: string | null;
  marketId: string | null;
  marketCode: string | null;
  marketName: string | null;
  primaryExchId: string | null;
  primaryMicCode: string | null;
  countryId: string | null;
  countryCode: string | null;
  countryName: string | null;
  secondaryExchIds: string[];
  secondaryExchDetails: SecondaryExchDetail[];
  assetClass: string;
  active: boolean;
};

export type ListingExportRow = {
  base: string;
  quote: string | null;
  name: string | null;
  primaryExchId: string | null;
  secondaryExchIds: string[];
  assetClass: string;
  active: boolean;
  rank: number;
};

export interface ListingInfo {
  id: string;
  base: string;
  quote: string | null;
  baseId?: string | null;
  quoteId?: string | null;
  name: string | null;
  iconUrl: string | null;
  assetClass: string;
  primaryMicCode: string | null;
  countryCode: string | null;
  cityName: string | null;
  timeZoneName: string | null;
}

export type ListingsQuery = {
  page: number;
  pageSize: number;
  id?: string;
  assetClass?: string;
  base?: string;
  quote?: string | null;
  marketId?: string | null;
  primaryExchId?: string | null;
  countryId?: string | null;
  active?: boolean;
};

function buildFilters({
  id,
  assetClass,
  base,
  quote,
  marketId,
  primaryExchId,
  countryId,
  active
}: ListingsQuery): SQL[] {
  const filters: SQL[] = [];
  if (id) {
    filters.push(
      sql`(
        l.id ILIKE ${`%${id}%`} OR
        l.base ILIKE ${`%${id}%`} OR
        COALESCE(l.name, '') ILIKE ${`%${id}%`}
      )`
    );
  }
  if (assetClass) {
    filters.push(sql`l.asset_class = ${assetClass}`);
  }
  if (base) {
    filters.push(sql`l.base ILIKE ${`%${base}%`}`);
  }
  if (quote !== undefined) {
    if (quote === null) {
      filters.push(sql`l.quote IS NULL`);
    } else {
      filters.push(sql`cq.code ILIKE ${quote}`);
    }
  }
  if (marketId !== undefined) {
    if (marketId === null) {
      filters.push(sql`l.market_id IS NULL`);
    } else {
      filters.push(sql`l.market_id = ${marketId}`);
    }
  }
  if (primaryExchId !== undefined) {
    if (primaryExchId === null) {
      filters.push(sql`l.primary_exch_id IS NULL`);
    } else {
      filters.push(sql`pm.id = ${primaryExchId}`);
    }
  }
  if (countryId !== undefined) {
    if (countryId === null) {
      filters.push(sql`pm.country_id IS NULL`);
    } else {
      filters.push(sql`pm.country_id = ${countryId}`);
    }
  }
  if (active !== undefined) {
    filters.push(sql`l.active = ${active}`);
  }
  return filters;
}

function parseSecondaryExchDetails(value: unknown): SecondaryExchDetail[] {
  if (value == null) return [];
  let parsed: unknown;
  if (Array.isArray(value)) {
    parsed = value;
  } else if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  } else {
    parsed = value;
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  return parsed
    .map((entry) => {
      const obj = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
      return {
        id: typeof obj.id === "string" ? obj.id : "",
        mic: typeof obj.mic === "string" ? obj.mic : null,
        name: typeof obj.name === "string" ? obj.name : null
      };
    })
    .filter((entry) => {
      if (!entry.id || seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
}

type ListingExportSource = Omit<ListingRow, "secondaryExchDetails" | "marketId" | "marketCode" | "marketName"> & {
  rank: number;
};

function mapListingForExport(listing: ListingExportSource): ListingExportRow {
  const secondaryExchIds = Array.isArray(listing.secondaryExchIds)
    ? listing.secondaryExchIds.filter((exchId): exchId is string => typeof exchId === "string" && exchId.length > 0)
    : [];
  const primaryExchId = listing.primaryExchId ?? null;

  return {
    base: listing.base,
    quote: listing.quote,
    name: listing.name,
    primaryExchId,
    secondaryExchIds,
    assetClass: listing.assetClass,
    active: listing.active,
    rank: Number.isFinite(listing.rank) ? listing.rank : 0
  };
}

// Cached unfiltered count (refreshes every 30s, avoids 350k+ row scan per request)
let unfilteredListingCount: { total: number; ts: number } | null = null;
const UNFILTERED_COUNT_TTL = 30_000;

function buildCountQuery(query: ListingsQuery, filters: SQL[]) {
  if (!filters.length) {
    // No filters: plain count, no JOINs needed
    return sql`SELECT COUNT(*)::int AS total FROM listings`;
  }

  // Only add JOINs that the active filters actually reference
  const joins: SQL[] = [];
  if (query.quote !== undefined) {
    joins.push(sql`LEFT JOIN currencies cq ON cq.id = l.quote`);
  }
  if (query.primaryExchId !== undefined || query.countryId !== undefined) {
    joins.push(sql`LEFT JOIN exchanges pm ON pm.id = l.primary_exch_id`);
  }
  if (query.countryId !== undefined) {
    joins.push(sql`LEFT JOIN countries c ON c.id = pm.country_id`);
  }

  const joinClause = joins.length ? sql.join(joins, sql` `) : sql``;
  const whereClause = sql`WHERE ${sql.join(filters, sql` AND `)}`;
  return sql`SELECT COUNT(*)::int AS total FROM listings l ${joinClause} ${whereClause}`;
}

export async function fetchListingsFromDb(query: ListingsQuery) {
  const filters = buildFilters(query);
  const whereClause = filters.length ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;
  const offset = (query.page - 1) * query.pageSize;
  const hasFilters = filters.length > 0;

  // Use cached total for unfiltered queries
  let totalPromise: Promise<number>;
  if (!hasFilters && unfilteredListingCount && Date.now() - unfilteredListingCount.ts < UNFILTERED_COUNT_TTL) {
    totalPromise = Promise.resolve(unfilteredListingCount.total);
  } else {
    totalPromise = (db!.execute(buildCountQuery(query, filters)) as Promise<{ total: number }[]>)
      .then((rows) => {
        const total = rows[0]?.total ?? 0;
        if (!hasFilters) unfilteredListingCount = { total, ts: Date.now() };
        return total;
      });
  }

  const [total, rowsFromDb] = await Promise.all([
    totalPromise,

    db!.execute(sql`
      SELECT
        l.id,
        l.base,
        cq.code AS "quote",
        cq.name AS "quoteName",
        l.name,
        l.icon_url AS "iconUrl",
        l.market_id AS "marketId",
        mk.code AS "marketCode",
        mk.name AS "marketName",
        l.asset_class AS "assetClass",
        l.active,
        l.rank,
        pm.id AS "primaryExchId",
        pm.mic AS "primaryMicCode",
        pm.country_id AS "countryId",
        c.code AS "countryCode",
        c.name AS "countryName",
        COALESCE(l.secondary_exch_ids, ARRAY[]::text[]) AS "secondaryExchIds",
        COALESCE(
          (
            SELECT jsonb_agg(jsonb_build_object('id', sm.id, 'mic', sm.mic, 'name', sm.name))
            FROM (
              SELECT DISTINCT m.id, m.mic, m.name
              FROM exchanges m
              WHERE l.secondary_exch_ids IS NOT NULL AND m.id = ANY(l.secondary_exch_ids)
              ORDER BY m.mic ASC NULLS LAST
            ) sm
          ),
          '[]'::jsonb
        ) AS "secondaryExchDetails"
      FROM listings l
      LEFT JOIN exchanges pm ON pm.id = l.primary_exch_id
      LEFT JOIN currencies cq ON cq.id = l.quote
      LEFT JOIN countries c ON c.id = pm.country_id
      LEFT JOIN markets mk ON mk.id = l.market_id
      ${whereClause}
      ORDER BY l.rank DESC, l.base ASC
      LIMIT ${query.pageSize}
      OFFSET ${offset}
    `) as Promise<(Omit<ListingRow, "secondaryExchDetails" | "marketId" | "marketCode" | "marketName"> & {
      secondaryExchDetails: unknown;
      rank: number;
    })[]>,
  ]);

  const rows = rowsFromDb.map(({ secondaryExchDetails, rank, ...rest }) => ({
    ...rest,
    secondaryExchDetails: parseSecondaryExchDetails(secondaryExchDetails)
  }));

  return { data: rows, total };
}

export async function fetchListingsForExport() {
  const rowsFromDb = (await db!.execute(sql`
    SELECT
      l.id,
      l.base,
      cq.code AS "quote",
      l.name,
      l.asset_class AS "assetClass",
      l.active,
      l.rank,
      pm.id AS "primaryExchId",
      pm.mic AS "primaryMicCode",
      COALESCE(l.secondary_exch_ids, ARRAY[]::text[]) AS "secondaryExchIds",
      COALESCE(
        (
          SELECT jsonb_agg(jsonb_build_object('id', sm.id, 'mic', sm.mic, 'name', sm.name))
          FROM (
            SELECT DISTINCT m.id, m.mic, m.name
            FROM exchanges m
            WHERE l.secondary_exch_ids IS NOT NULL AND m.id = ANY(l.secondary_exch_ids)
            ORDER BY m.mic ASC NULLS LAST
          ) sm
        ),
        '[]'::jsonb
      ) AS "secondaryExchDetails"
    FROM listings l
    LEFT JOIN exchanges pm ON pm.id = l.primary_exch_id
    LEFT JOIN currencies cq ON cq.id = l.quote
    ORDER BY l.rank DESC, l.base ASC
  `)) as (Omit<ListingRow, "secondaryExchDetails" | "marketId" | "marketCode" | "marketName"> & {
    secondaryExchDetails: unknown;
    rank: number;
  })[];

  const rows = rowsFromDb.map(({ secondaryExchDetails, ...rest }) => ({
    ...rest,
    secondaryExchDetails: parseSecondaryExchDetails(secondaryExchDetails)
  }));

  return rows.map(mapListingForExport);
}
