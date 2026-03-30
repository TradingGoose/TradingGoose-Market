import { sql, type SQL } from "drizzle-orm";

import { db } from "@tradinggoose/db";

export type TimeZoneRow = {
  id: string;
  name: string;
  offset: string;
  offsetDst: string | null;
  observesDst: boolean;
  updatedAt: string | null;
};

export type TimeZoneExportRow = {
  name: string;
  offset: string;
  offsetDst: string | null;
  observesDst: boolean;
};

export type TimeZonesQuery = {
  page: number;
  pageSize: number;
  id?: string;
  name?: string;
  offset?: string;
};

function buildFilters({ id, name, offset }: TimeZonesQuery): SQL[] {
  const filters: SQL[] = [];

  if (id) {
    filters.push(
      sql`(tz.id ILIKE ${`%${id}%`} OR tz.name ILIKE ${`%${id}%`} OR tz."offset" ILIKE ${`%${id}%`} OR tz."offset_dst" ILIKE ${`%${id}%`})`
    );
  }
  if (name) {
    filters.push(sql`tz.name ILIKE ${`%${name}%`}`);
  }
  if (offset) {
    filters.push(sql`(tz."offset" ILIKE ${`%${offset}%`} OR tz."offset_dst" ILIKE ${`%${offset}%`})`);
  }

  return filters;
}

export async function fetchTimeZonesFromDb(query: TimeZonesQuery) {
  const filters = buildFilters(query);
  const whereClause = filters.length ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;
  const offsetVal = (query.page - 1) * query.pageSize;

  const [{ total }] = (await db!.execute(sql`
    SELECT COUNT(*)::int AS total
    FROM time_zones tz
    ${whereClause}
  `)) as { total: number }[];

  const rowsFromDb = (await db!.execute(sql`
    SELECT
      tz.id,
      tz.name,
      tz."offset" AS "offset",
      tz."offset_dst" AS "offsetDst",
      tz."observes_dst" AS "observesDst",
      tz.updated_at AS "updatedAt"
    FROM time_zones tz
    ${whereClause}
    ORDER BY tz.name ASC
    LIMIT ${query.pageSize}
    OFFSET ${offsetVal}
  `)) as (Omit<TimeZoneRow, "updatedAt"> & { updatedAt: string | Date | null })[];

  const rows: TimeZoneRow[] = rowsFromDb.map(row => ({
    ...row,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt
  }));

  return { data: rows, total };
}

export async function fetchTimeZonesForExport() {
  const rows = (await db!.execute(sql`
    SELECT
      tz.name,
      tz."offset" AS "offset",
      tz."offset_dst" AS "offsetDst",
      tz."observes_dst" AS "observesDst"
    FROM time_zones tz
    ORDER BY tz.name ASC
  `)) as TimeZoneExportRow[];

  return rows;
}
