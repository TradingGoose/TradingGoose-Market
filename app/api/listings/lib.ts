import { sql, type SQL } from "drizzle-orm";

import { db } from "@tradinggoose/db";

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

export async function fetchListingsFromDb(query: ListingsQuery) {
  const filters = buildFilters(query);
  const whereClause = filters.length ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;
  const offset = (query.page - 1) * query.pageSize;

  const [{ total }] = (await db!.execute(sql`
    SELECT COUNT(*)::int AS total
    FROM listings l
    LEFT JOIN exchanges pm ON pm.id = l.primary_exch_id
    LEFT JOIN countries c ON c.id = pm.country_id
    LEFT JOIN currencies cq ON cq.id = l.quote
    ${whereClause}
  `)) as { total: number }[];

  const rowsFromDb = (await db!.execute(sql`
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
  `)) as (Omit<ListingRow, "secondaryExchDetails" | "marketId" | "marketCode" | "marketName"> & {
    secondaryExchDetails: unknown;
    rank: number;
  })[];

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
