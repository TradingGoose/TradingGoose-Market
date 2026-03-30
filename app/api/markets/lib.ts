import { sql, type SQL } from "drizzle-orm";

import { db } from "@tradinggoose/db";

export type MarketRow = {
  id: string;
  code: string;
  name: string;
  url: string | null;
  countryId: string | null;
  countryCode: string | null;
  countryName: string | null;
  cityId: string | null;
  cityName: string | null;
  timeZoneId: string | null;
  timeZoneName: string | null;
  timeZoneOffset: string | null;
  timeZoneOffsetDst?: string | null;
};

export type MarketExportRow = {
  code: string;
  name: string;
  countryCode: string | null;
  cityName: string | null;
  timeZone: string | null;
  url: string | null;
};

export type MarketsQuery = {
  page: number;
  pageSize: number;
  id?: string;
  code?: string;
  name?: string;
  countryId?: string | null;
  cityId?: string | null;
  timeZoneId?: string | null;
};

function buildFilters({ id, code, name, countryId, cityId, timeZoneId }: MarketsQuery): SQL[] {
  const filters: SQL[] = [];

  if (id) {
    filters.push(
      sql`(m.id ILIKE ${`%${id}%`} OR m.code ILIKE ${`%${id}%`} OR COALESCE(m.name, '') ILIKE ${`%${id}%`})`
    );
  }
  if (code) {
    filters.push(sql`m.code ILIKE ${`%${code}%`}`);
  }
  if (name) {
    filters.push(sql`COALESCE(m.name, '') ILIKE ${`%${name}%`}`);
  }
  if (countryId !== undefined) {
    if (countryId === null) {
      filters.push(sql`m.country_id IS NULL`);
    } else {
      filters.push(sql`m.country_id = ${countryId}`);
    }
  }
  if (cityId !== undefined) {
    if (cityId === null) {
      filters.push(sql`m.city_id IS NULL`);
    } else {
      filters.push(sql`m.city_id = ${cityId}`);
    }
  }
  if (timeZoneId !== undefined) {
    if (timeZoneId === null) {
      filters.push(sql`m.time_zone_id IS NULL`);
    } else {
      filters.push(sql`m.time_zone_id = ${timeZoneId}`);
    }
  }

  return filters;
}

export async function fetchMarketsFromDb(query: MarketsQuery) {
  const filters = buildFilters(query);
  const whereClause = filters.length ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;
  const offset = (query.page - 1) * query.pageSize;

  const [{ total }] = (await db!.execute(sql`
    SELECT COUNT(*)::int AS total
    FROM markets m
    LEFT JOIN countries c ON c.id = m.country_id
    LEFT JOIN cities ct ON ct.id = m.city_id
    LEFT JOIN time_zones tz ON tz.id = m.time_zone_id
    ${whereClause}
  `)) as { total: number }[];

  const rowsFromDb = (await db!.execute(sql`
    SELECT
      m.id,
      m.code,
      m.name,
      m.url,
      m.country_id AS "countryId",
      c.code AS "countryCode",
      c.name AS "countryName",
      m.city_id AS "cityId",
      ct.name AS "cityName",
      m.time_zone_id AS "timeZoneId",
      tz.name AS "timeZoneName",
      tz.offset AS "timeZoneOffset",
      tz.offset_dst AS "timeZoneOffsetDst"
    FROM markets m
    LEFT JOIN countries c ON c.id = m.country_id
    LEFT JOIN cities ct ON ct.id = m.city_id
    LEFT JOIN time_zones tz ON tz.id = m.time_zone_id
    ${whereClause}
    ORDER BY m.code ASC
    LIMIT ${query.pageSize}
    OFFSET ${offset}
  `)) as MarketRow[];

  return { data: rowsFromDb, total };
}

export async function fetchMarketsForExport() {
  const rows = (await db!.execute(sql`
    SELECT
      m.code,
      m.name,
      c.code AS "countryCode",
      ct.name AS "cityName",
      tz.name AS "timeZoneName",
      m.url
    FROM markets m
    LEFT JOIN countries c ON c.id = m.country_id
    LEFT JOIN cities ct ON ct.id = m.city_id
    LEFT JOIN time_zones tz ON tz.id = m.time_zone_id
    ORDER BY m.code ASC
  `)) as {
    code: string;
    name: string;
    countryCode: string | null;
    cityName: string | null;
    timeZoneName: string | null;
    url: string | null;
  }[];

  return rows.map((row) => ({
    code: row.code,
    name: row.name,
    countryCode: row.countryCode ?? null,
    cityName: row.cityName ?? null,
    timeZone: row.timeZoneName ?? null,
    url: row.url ?? null
  }));
}
