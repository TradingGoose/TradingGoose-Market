import { sql, type SQL } from "drizzle-orm";

import { db } from "@tradinggoose/db";

export type CityRow = {
  id: string;
  name: string;
  countryId: string;
  countryCode: string | null;
  countryName: string | null;
  timeZoneId: string | null;
  timeZoneName: string | null;
  timeZoneOffset: string | null;
  timeZoneOffsetDst?: string | null;
  timeZoneObservesDst?: boolean | null;
  updatedAt: string | null;
};

export type CityExportRow = {
  id: string | null;
  countryCode: string | null;
  name: string;
  timeZone: string | null;
};

export type CitiesQuery = {
  page: number;
  pageSize: number;
  id?: string;
  name?: string;
  countryId?: string | null;
  timeZoneId?: string | null;
};

function buildFilters({ id, name, countryId, timeZoneId }: CitiesQuery): SQL[] {
  const filters: SQL[] = [];

  if (id) {
    filters.push(sql`(ct.id ILIKE ${`%${id}%`} OR ct.name ILIKE ${`%${id}%`})`);
  }
  if (name) {
    filters.push(sql`ct.name ILIKE ${`%${name}%`}`);
  }
  if (countryId !== undefined) {
    if (countryId === null) {
      filters.push(sql`ct.country_id IS NULL`);
    } else {
      filters.push(sql`ct.country_id = ${countryId}`);
    }
  }
  if (timeZoneId !== undefined) {
    if (timeZoneId === null) {
      filters.push(sql`ct.time_zone_id IS NULL`);
    } else {
      filters.push(sql`ct.time_zone_id = ${timeZoneId}`);
    }
  }

  return filters;
}

export async function fetchCitiesFromDb(query: CitiesQuery) {
  const filters = buildFilters(query);
  const whereClause = filters.length ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;
  const offset = (query.page - 1) * query.pageSize;

  const [{ total }] = (await db!.execute(sql`
    SELECT COUNT(*)::int AS total
    FROM cities ct
    LEFT JOIN countries c ON c.id = ct.country_id
    LEFT JOIN time_zones tz ON tz.id = ct.time_zone_id
    ${whereClause}
  `)) as { total: number }[];

  const rowsFromDb = (await db!.execute(sql`
    SELECT
      ct.id,
      ct.name,
      ct.country_id AS "countryId",
      c.code AS "countryCode",
      c.name AS "countryName",
      ct.time_zone_id AS "timeZoneId",
      tz.name AS "timeZoneName",
      tz.offset AS "timeZoneOffset",
      tz.offset_dst AS "timeZoneOffsetDst",
      tz.observes_dst AS "timeZoneObservesDst",
      ct.updated_at AS "updatedAt"
    FROM cities ct
    LEFT JOIN countries c ON c.id = ct.country_id
    LEFT JOIN time_zones tz ON tz.id = ct.time_zone_id
    ${whereClause}
    ORDER BY ct.name ASC
    LIMIT ${query.pageSize}
    OFFSET ${offset}
  `)) as (Omit<CityRow, "updatedAt"> & { updatedAt: string | Date | null })[];

  const rows: CityRow[] = rowsFromDb.map(row => ({
    ...row,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt
  }));

  return { data: rows, total };
}

function buildCityId(countryCode: string | null, cityName: string) {
  if (!countryCode) return null;
  const slug = cityName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${countryCode.toUpperCase()}_${slug || "UNKNOWN"}`;
}

export async function fetchCitiesForExport() {
  const rows = (await db!.execute(sql`
    SELECT
      ct.name,
      c.code AS "countryCode",
      tz.name AS "timeZoneName"
    FROM cities ct
    LEFT JOIN countries c ON c.id = ct.country_id
    LEFT JOIN time_zones tz ON tz.id = ct.time_zone_id
    ORDER BY ct.name ASC
  `)) as { name: string; countryCode: string | null; timeZoneName: string | null }[];

  return rows.map((row) => ({
    id: buildCityId(row.countryCode, row.name),
    countryCode: row.countryCode,
    name: row.name,
    timeZone: row.timeZoneName ?? null
  }));
}
