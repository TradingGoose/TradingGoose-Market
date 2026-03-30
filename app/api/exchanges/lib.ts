import { sql, type SQL } from "drizzle-orm";

import { db } from "@tradinggoose/db";

export type ExchangeTableRow = {
  id: string;
  mic: string;
  name: string | null;
  lei: string | null;
  url: string | null;
  createdAt: string | null;
  expiredAt: string | null;
  active: boolean;
  isSegment: boolean;
  parentId: string | null;
  countryId: string | null;
  countryCode: string | null;
  countryName: string | null;
  cityId: string | null;
  cityName: string | null;
  updatedAt: string | null;
};

export type ExchangeExportRow = {
  mic: string;
  name: string | null;
  lei: string | null;
  url: string | null;
  createdAt: string | null;
  expiredAt: string | null;
  active: boolean;
  countryId: string | null;
  cityId: string | null;
};

export type ExchangesQuery = {
  page: number;
  pageSize: number;
  id?: string;
  countryId?: string | null;
  cityId?: string | null;
  active?: boolean;
};

function buildFilters({ id, countryId, cityId, active }: ExchangesQuery): SQL[] {
  const filters: SQL[] = [];

  if (id) {
    filters.push(
      sql`(m.id ILIKE ${`%${id}%`} OR m.mic ILIKE ${`%${id}%`} OR COALESCE(m.name, '') ILIKE ${`%${id}%`})`
    );
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

  if (active !== undefined) {
    filters.push(sql`m.active = ${active}`);
  }

  return filters;
}

export async function fetchExchangesFromDb(query: ExchangesQuery) {
  const filters = buildFilters(query);
  const whereClause = filters.length ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;
  const offset = (query.page - 1) * query.pageSize;

  const [{ total }] = (await db!.execute(sql`
    SELECT COUNT(*)::int AS total
    FROM exchanges m
    LEFT JOIN countries c ON c.id = m.country_id
    LEFT JOIN cities ct ON ct.id = m.city_id
    ${whereClause}
  `)) as { total: number }[];

  const rowsFromDb = (await db!.execute(sql`
    SELECT
      m.id,
      m.mic,
      m.name,
      m.lei,
      m.url,
      m.created_at AS "createdAt",
      m.expired_at AS "expiredAt",
      m.active,
      m.is_segment AS "isSegment",
      m.parent_id AS "parentId",
      m.country_id AS "countryId",
      c.code AS "countryCode",
      c.name AS "countryName",
      m.city_id AS "cityId",
      ct.name AS "cityName",
      m.updated_at AS "updatedAt"
    FROM exchanges m
    LEFT JOIN countries c ON c.id = m.country_id
    LEFT JOIN cities ct ON ct.id = m.city_id
    ${whereClause}
    ORDER BY m.mic ASC
    LIMIT ${query.pageSize}
    OFFSET ${offset}
  `)) as (Omit<ExchangeTableRow, "updatedAt" | "createdAt" | "expiredAt"> & {
    updatedAt: string | Date | null;
    createdAt: string | Date | null;
    expiredAt: string | Date | null;
  })[];

  const rows: ExchangeTableRow[] = rowsFromDb.map(row => ({
    ...row,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    expiredAt: row.expiredAt instanceof Date ? row.expiredAt.toISOString() : row.expiredAt
  }));

  return { data: rows, total };
}

export async function fetchExchangesForExport() {
  const rows = (await db!.execute(sql`
    SELECT
      m.mic,
      m.name,
      m.lei,
      m.url,
      m.created_at AS "createdAt",
      m.expired_at AS "expiredAt",
      m.active,
      c.code AS "countryCode",
      ct.name AS "cityName"
    FROM exchanges m
    LEFT JOIN countries c ON c.id = m.country_id
    LEFT JOIN cities ct ON ct.id = m.city_id
    ORDER BY m.mic ASC
  `)) as {
    mic: string;
    name: string | null;
    lei: string | null;
    url: string | null;
    createdAt: string | Date | null;
    expiredAt: string | Date | null;
    active: boolean;
    countryCode: string | null;
    cityName: string | null;
  }[];

  return rows.map((row) => ({
    mic: row.mic,
    name: row.name,
    lei: row.lei ?? null,
    url: row.url ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt ?? null,
    expiredAt: row.expiredAt instanceof Date ? row.expiredAt.toISOString() : row.expiredAt ?? null,
    active: row.active,
    countryId: row.countryCode ?? null,
    cityId: row.cityName ?? null
  }));
}
