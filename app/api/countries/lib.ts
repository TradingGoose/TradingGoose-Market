import { sql, type SQL } from "drizzle-orm";

import { db } from "@tradinggoose/db";

export type CountryRow = {
  id: string;
  code: string;
  name: string;
  iconUrl: string | null;
  updatedAt: string | null;
};

export type CountryExportRow = {
  code: string;
  name: string;
};

export type CountriesQuery = {
  page: number;
  pageSize: number;
  id?: string;
  code?: string;
  name?: string;
};

function buildFilters({ id, code, name }: CountriesQuery): SQL[] {
  const filters: SQL[] = [];

  if (id) {
    filters.push(sql`(c.id ILIKE ${`%${id}%`} OR c.code ILIKE ${`%${id}%`} OR c.name ILIKE ${`%${id}%`})`);
  }
  if (code) {
    filters.push(sql`c.code ILIKE ${`%${code}%`}`);
  }
  if (name) {
    filters.push(sql`c.name ILIKE ${`%${name}%`}`);
  }

  return filters;
}

export async function fetchCountriesFromDb(query: CountriesQuery) {
  const filters = buildFilters(query);
  const whereClause = filters.length ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;
  const offset = (query.page - 1) * query.pageSize;

  const [{ total }] = (await db!.execute(sql`
    SELECT COUNT(*)::int AS total
    FROM countries c
    ${whereClause}
  `)) as { total: number }[];

  const rowsFromDb = (await db!.execute(sql`
    SELECT
      c.id,
      c.code,
      c.name,
      c.icon_url AS "iconUrl",
      c.updated_at AS "updatedAt"
    FROM countries c
    ${whereClause}
    ORDER BY c.name ASC
    LIMIT ${query.pageSize}
    OFFSET ${offset}
  `)) as (Omit<CountryRow, "updatedAt"> & { updatedAt: string | Date | null })[];

  const rows: CountryRow[] = rowsFromDb.map(row => ({
    ...row,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt
  }));

  return { data: rows, total };
}

export async function fetchCountriesForExport() {
  const rows = (await db!.execute(sql`
    SELECT
      c.code,
      c.name
    FROM countries c
    ORDER BY c.name ASC
  `)) as CountryExportRow[];

  return rows;
}
