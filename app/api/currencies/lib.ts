import { sql, type SQL } from "drizzle-orm";

import { db } from "@tradinggoose/db";

export type CurrencyRow = {
  id: string;
  code: string;
  name: string;
  iconUrl: string | null;
  updatedAt: string | null;
};

export type CurrencyExportRow = {
  code: string;
  name: string;
};

export type CurrenciesQuery = {
  page: number;
  pageSize: number;
  id?: string;
  code?: string;
  name?: string;
};

function buildFilters({ id, code, name }: CurrenciesQuery): SQL[] {
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

export async function fetchCurrenciesFromDb(query: CurrenciesQuery) {
  const filters = buildFilters(query);
  const whereClause = filters.length ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;
  const offset = (query.page - 1) * query.pageSize;

  const [{ total }] = (await db!.execute(sql`
    SELECT COUNT(*)::int AS total
    FROM currencies c
    ${whereClause}
  `)) as { total: number }[];

  const rowsFromDb = (await db!.execute(sql`
    SELECT
      c.id,
      c.code,
      c.name,
      c.icon_url AS "iconUrl",
      c.updated_at AS "updatedAt"
    FROM currencies c
    ${whereClause}
    ORDER BY c.code ASC
    LIMIT ${query.pageSize}
    OFFSET ${offset}
  `)) as (Omit<CurrencyRow, "updatedAt"> & { updatedAt: string | Date | null })[];

  const rows: CurrencyRow[] = rowsFromDb.map(row => ({
    ...row,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt
  }));

  return { data: rows, total };
}

export async function fetchCurrenciesForExport() {
  const rows = (await db!.execute(sql`
    SELECT
      c.code,
      c.name
    FROM currencies c
    ORDER BY c.code ASC
  `)) as CurrencyExportRow[];

  return rows;
}
