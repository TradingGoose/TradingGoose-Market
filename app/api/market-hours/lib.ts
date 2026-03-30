import { sql, type SQL } from "drizzle-orm";

import { db } from "@tradinggoose/db";

export type MarketHourRow = {
  id: string;
  countryId: string | null;
  countryCode: string | null;
  countryName: string | null;
  cityId: string | null;
  cityName: string | null;
  marketId: string | null;
  marketCode: string | null;
  marketName: string | null;
  assetClass: string | null;
  listingId: string | null;
  listingBase: string | null;
  timeZoneId: string;
  timeZoneName: string | null;
  timeZoneOffset: string | null;
  timeZoneOffsetDst?: string | null;
  sessionsCount: number;
  holidaysCount: number;
  updatedAt: string | null;
  hours?: unknown;
};

export type MarketHoursExportHours = {
  sessions: {
    sunday: unknown[];
    monday: unknown[];
    tuesday: unknown[];
    wednesday: unknown[];
    thursday: unknown[];
    friday: unknown[];
    saturday: unknown[];
  };
  holidays: unknown[];
  earlyCloses: Record<string, unknown>;
};

export type MarketHoursExportRow = {
  marketCode: string | null;
  marketName: string | null;
  assetClass: string | null;
  cityId: string | null;
  countryId: string | null;
  segment: string | null;
  timeZoneId: string;
  hours: MarketHoursExportHours;
};

export type MarketHoursQuery = {
  page: number;
  pageSize: number;
  search?: string;
  countryId?: string | null;
  marketId?: string | null;
  assetClass?: string | null;
};

function buildFilters({ search, countryId, marketId, assetClass }: MarketHoursQuery): SQL[] {
  const filters: SQL[] = [];

  if (search) {
    filters.push(
      sql`(
        mh.id ILIKE ${`%${search}%`} OR
        COALESCE(l.base, '') ILIKE ${`%${search}%`} OR
        COALESCE(mk.code, lm.code, '') ILIKE ${`%${search}%`} OR
        COALESCE(mk.name, lm.name, '') ILIKE ${`%${search}%`} OR
        COALESCE(ct_mk.name, ct_lm.name, '') ILIKE ${`%${search}%`} OR
        COALESCE(c.name, '') ILIKE ${`%${search}%`} OR
        COALESCE(c.code, '') ILIKE ${`%${search}%`}
      )`
    );
  }

  if (countryId !== undefined) {
    if (countryId === null) {
      filters.push(sql`mh.country_id IS NULL`);
    } else {
      filters.push(sql`mh.country_id = ${countryId}`);
    }
  }

  if (marketId !== undefined) {
    if (marketId === null) {
      filters.push(sql`COALESCE(mh.market_id, l.market_id) IS NULL`);
    } else {
      filters.push(sql`COALESCE(mh.market_id, l.market_id) = ${marketId}`);
    }
  }

  if (assetClass !== undefined && assetClass !== null) {
    filters.push(sql`mh.asset_class = ${assetClass}`);
  }

  return filters;
}

export async function fetchMarketHoursFromDb(query: MarketHoursQuery) {
  const filters = buildFilters(query);
  const whereClause = filters.length ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;
  const offset = (query.page - 1) * query.pageSize;

  const [{ total }] = (await db!.execute(sql`
    SELECT COUNT(*)::int AS total
    FROM market_hours mh
    LEFT JOIN countries c ON c.id = mh.country_id
    LEFT JOIN markets mk ON mk.id = mh.market_id
    LEFT JOIN listings l ON l.id = mh.listing_id
    LEFT JOIN markets lm ON lm.id = l.market_id
    LEFT JOIN cities ct_mk ON ct_mk.id = mk.city_id
    LEFT JOIN cities ct_lm ON ct_lm.id = lm.city_id
    ${whereClause}
  `)) as { total: number }[];

  const rowsFromDb = (await db!.execute(sql`
    SELECT
      mh.id,
      mh.country_id AS "countryId",
      c.code AS "countryCode",
      c.name AS "countryName",
      COALESCE(ct_mk.id, ct_lm.id) AS "cityId",
      COALESCE(ct_mk.name, ct_lm.name) AS "cityName",
      COALESCE(mh.market_id, l.market_id) AS "marketId",
      COALESCE(mk.code, lm.code) AS "marketCode",
      COALESCE(mk.name, lm.name) AS "marketName",
      mh.asset_class AS "assetClass",
      mh.listing_id AS "listingId",
      l.base AS "listingBase",
      mh.time_zone_id AS "timeZoneId",
      tz.name AS "timeZoneName",
      tz.offset AS "timeZoneOffset",
      tz.offset_dst AS "timeZoneOffsetDst",
      mh.hours AS "hours",
      COALESCE(jsonb_array_length(mh.hours -> 'sessions' -> 'monday'), 0) +
      COALESCE(jsonb_array_length(mh.hours -> 'sessions' -> 'tuesday'), 0) +
      COALESCE(jsonb_array_length(mh.hours -> 'sessions' -> 'wednesday'), 0) +
      COALESCE(jsonb_array_length(mh.hours -> 'sessions' -> 'thursday'), 0) +
      COALESCE(jsonb_array_length(mh.hours -> 'sessions' -> 'friday'), 0) +
      COALESCE(jsonb_array_length(mh.hours -> 'sessions' -> 'saturday'), 0) +
      COALESCE(jsonb_array_length(mh.hours -> 'sessions' -> 'sunday'), 0) AS "sessionsCount",
      COALESCE(jsonb_array_length(mh.hours -> 'holidays'), 0) AS "holidaysCount",
      mh.updated_at AS "updatedAt"
    FROM market_hours mh
    LEFT JOIN countries c ON c.id = mh.country_id
    LEFT JOIN markets mk ON mk.id = mh.market_id
    LEFT JOIN listings l ON l.id = mh.listing_id
    LEFT JOIN markets lm ON lm.id = l.market_id
    LEFT JOIN cities ct_mk ON ct_mk.id = mk.city_id
    LEFT JOIN cities ct_lm ON ct_lm.id = lm.city_id
    LEFT JOIN time_zones tz ON tz.id = mh.time_zone_id
    ${whereClause}
    ORDER BY c.name NULLS LAST,
      COALESCE(ct_mk.name, ct_lm.name) NULLS LAST,
      COALESCE(mk.code, lm.code) NULLS LAST,
      mh.asset_class NULLS LAST
    LIMIT ${query.pageSize}
    OFFSET ${offset}
  `)) as (Omit<MarketHourRow, "updatedAt"> & { updatedAt: string | Date | null })[];

  const rows: MarketHourRow[] = rowsFromDb.map(row => ({
    ...row,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt
  }));

  return { data: rows, total };
}

function parseHoursValue(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof value === "object") return value as Record<string, unknown>;
  return {};
}

function normalizeMarketHours(value: unknown): MarketHoursExportHours {
  const hours = parseHoursValue(value);
  const sessionsRaw =
    typeof hours.sessions === "object" && hours.sessions !== null
      ? (hours.sessions as Record<string, unknown>)
      : {};
  const normalizeArray = (input: unknown) => (Array.isArray(input) ? input : []);
  const earlyCloses =
    typeof hours.earlyCloses === "object" && hours.earlyCloses !== null
      ? (hours.earlyCloses as Record<string, unknown>)
      : {};

  return {
    sessions: {
      sunday: normalizeArray(sessionsRaw.sunday),
      monday: normalizeArray(sessionsRaw.monday),
      tuesday: normalizeArray(sessionsRaw.tuesday),
      wednesday: normalizeArray(sessionsRaw.wednesday),
      thursday: normalizeArray(sessionsRaw.thursday),
      friday: normalizeArray(sessionsRaw.friday),
      saturday: normalizeArray(sessionsRaw.saturday)
    },
    holidays: normalizeArray(hours.holidays),
    earlyCloses
  };
}

export async function fetchMarketHoursForExport() {
  const rows = (await db!.execute(sql`
    SELECT
      COALESCE(mk.code, lm.code) AS "marketCode",
      COALESCE(mk.name, lm.name) AS "marketName",
      mh.asset_class AS "assetClass",
      COALESCE(ct_mk.name, ct_lm.name) AS "cityName",
      c.code AS "countryCode",
      l.base AS "listingBase",
      mh.time_zone_id AS "timeZoneId",
      mh.hours AS "hours"
    FROM market_hours mh
    LEFT JOIN countries c ON c.id = mh.country_id
    LEFT JOIN markets mk ON mk.id = mh.market_id
    LEFT JOIN listings l ON l.id = mh.listing_id
    LEFT JOIN markets lm ON lm.id = l.market_id
    LEFT JOIN cities ct_mk ON ct_mk.id = mk.city_id
    LEFT JOIN cities ct_lm ON ct_lm.id = lm.city_id
    ORDER BY c.name NULLS LAST,
      COALESCE(ct_mk.name, ct_lm.name) NULLS LAST,
      COALESCE(mk.code, lm.code) NULLS LAST,
      mh.asset_class NULLS LAST
  `)) as {
    marketCode: string | null;
    marketName: string | null;
    assetClass: string | null;
    cityName: string | null;
    countryCode: string | null;
    listingBase: string | null;
    timeZoneId: string;
    hours: unknown;
  }[];

  return rows.map((row) => ({
    marketCode: row.marketCode ?? null,
    marketName: row.marketName ?? null,
    assetClass: row.assetClass ?? null,
    cityId: row.cityName ?? null,
    countryId: row.countryCode ?? null,
    segment: row.listingBase ?? null,
    timeZoneId: row.timeZoneId,
    hours: normalizeMarketHours(row.hours)
  }));
}
