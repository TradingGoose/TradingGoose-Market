import { sql, type SQL } from "drizzle-orm";

import { db, schema } from "@tradinggoose/db";

export type CryptoContract = {
  chainId: string;
  chainCode: string | null;
  chainName: string | null;
  address: string;
  contractType: string;
};

export type CryptoRow = {
  id: string;
  code: string;
  name: string;
  assetType: string | null;
  active: boolean;
  contractAddresses: CryptoContract[];
  iconUrl: string | null;
  updatedAt: string | null;
};

export type CryptoExportRow = {
  code: string;
  name: string;
  assetType: string | null;
  active: boolean;
  contractAddresses: CryptoContract[];
};

export type CryptoOptionRow = {
  id: string;
  code: string;
  name: string;
  assetType: string | null;
  active: boolean;
  contractAddresses: CryptoContract[];
  iconUrl: string | null;
};

export type CryptosQuery = {
  page: number;
  pageSize: number;
  id?: string;
  query?: string;
  code?: string;
  name?: string;
  chainId?: string;
  assetType?: string;
};

function buildFilters({ id, query, code, name, chainId, assetType }: CryptosQuery): SQL[] {
  const filters: SQL[] = [];

  if (id) {
    filters.push(sql`cr.id = ${id}`);
  }
  if (query) {
    filters.push(sql`(
      cr.code ILIKE ${`%${query}%`} OR
      cr.name ILIKE ${`%${query}%`}
    )`);
  }
  if (code) {
    filters.push(sql`cr.code ILIKE ${`%${code}%`}`);
  }
  if (name) {
    filters.push(sql`cr.name ILIKE ${`%${name}%`}`);
  }
  if (chainId) {
    filters.push(sql`
      EXISTS (
        SELECT 1
        FROM jsonb_array_elements(cr.contract_addresses) AS c
        WHERE c->>'chainId' = ${chainId}
      )
    `);
  }
  if (assetType) {
    filters.push(sql`lower(cr.asset_type) = lower(${assetType})`);
  }

  return filters;
}

type RawContract = {
  chainId?: unknown;
  address?: unknown;
  contractType?: unknown;
};

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeContract(raw: RawContract): CryptoContract | null {
  const chainId = typeof raw.chainId === "string" ? raw.chainId.trim() : "";
  if (!chainId) return null;
  const address = typeof raw.address === "string" ? raw.address.trim() : "";
  const contractType = typeof raw.contractType === "string" ? raw.contractType.trim() : "";
  return {
    chainId,
    chainCode: null,
    chainName: null,
    address,
    contractType
  };
}

function parseContractAddresses(value: unknown): CryptoContract[] {
  const raw = parseJson(value);
  if (!Array.isArray(raw)) return [];
  const parsed: CryptoContract[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const contract = normalizeContract(item as RawContract);
    if (!contract) continue;
    const key = `${contract.chainId}||${contract.address}||${contract.contractType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push(contract);
  }
  return parsed;
}

let chainMapCache: { map: Map<string, { code: string; name: string }>; ts: number } | null = null;
const CHAIN_MAP_TTL = 60_000; // 60 seconds

async function buildChainMap() {
  if (chainMapCache && Date.now() - chainMapCache.ts < CHAIN_MAP_TTL) {
    return chainMapCache.map;
  }
  const rows = await db!
    .select({ id: schema.chains.id, code: schema.chains.code, name: schema.chains.name })
    .from(schema.chains);
  const map = new Map<string, { code: string; name: string }>();
  rows.forEach((row) => {
    map.set(row.id, { code: row.code, name: row.name });
  });
  chainMapCache = { map, ts: Date.now() };
  return map;
}

function hydrateContracts(
  contracts: CryptoContract[],
  chainMap: Map<string, { code: string; name: string }>
) {
  return contracts.map((contract) => {
    const chain = chainMap.get(contract.chainId);
    return {
      ...contract,
      chainCode: chain?.code ?? null,
      chainName: chain?.name ?? null
    };
  });
}

export async function fetchCryptoOptions(query: string | null, limit: number) {
  const filters: SQL[] = [];
  if (query) {
    filters.push(sql`(cr.code ILIKE ${`%${query}%`} OR cr.name ILIKE ${`%${query}%`})`);
  }
  const whereClause = filters.length ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;

  const rows = (await db!.execute(sql`
    SELECT
      cr.id,
      cr.code,
      cr.name,
      cr.asset_type AS "assetType",
      cr.active AS "active",
      cr.contract_addresses AS "contractAddresses",
      cr.icon_url AS "iconUrl"
    FROM cryptos cr
    ${whereClause}
    ORDER BY cr.code ASC
    LIMIT ${limit}
  `)) as (Omit<CryptoOptionRow, "contractAddresses"> & { contractAddresses: unknown })[];

  const chainMap = await buildChainMap();
  return rows.map((row) => ({
    ...row,
    contractAddresses: hydrateContracts(parseContractAddresses(row.contractAddresses), chainMap)
  }));
}

// Cached unfiltered count (refreshes every 30s)
let unfilteredCryptoCount: { total: number; ts: number } | null = null;
const UNFILTERED_CRYPTO_COUNT_TTL = 30_000;

export async function fetchCryptosFromDb(query: CryptosQuery) {
  const filters = buildFilters(query);
  const whereClause = filters.length ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;
  const offset = (query.page - 1) * query.pageSize;
  const queryPattern = query.query ? `%${query.query}%` : null;
  const orderClause = queryPattern
    ? sql`ORDER BY (CASE
        WHEN lower(cr.code) = lower(${query.query ?? ""}) THEN 4
        WHEN lower(cr.name) = lower(${query.query ?? ""}) THEN 3
        WHEN cr.code ILIKE ${queryPattern} THEN 2
        WHEN cr.name ILIKE ${queryPattern} THEN 1
        ELSE 0
      END) DESC, cr.rank DESC, cr.code ASC`
    : sql`ORDER BY cr.rank DESC, cr.code ASC`;

  const hasFilters = filters.length > 0;

  let totalPromise: Promise<number>;
  if (!hasFilters && unfilteredCryptoCount && Date.now() - unfilteredCryptoCount.ts < UNFILTERED_CRYPTO_COUNT_TTL) {
    totalPromise = Promise.resolve(unfilteredCryptoCount.total);
  } else {
    totalPromise = (db!.execute(
      hasFilters
        ? sql`SELECT COUNT(*)::int AS total FROM cryptos cr ${whereClause}`
        : sql`SELECT COUNT(*)::int AS total FROM cryptos`
    ) as Promise<{ total: number }[]>).then((rows) => {
      const total = rows[0]?.total ?? 0;
      if (!hasFilters) unfilteredCryptoCount = { total, ts: Date.now() };
      return total;
    });
  }

  const [total, rowsFromDb, chainMap] = await Promise.all([
    totalPromise,

    db!.execute(sql`
      SELECT
        cr.id,
        cr.code,
        cr.name,
        cr.asset_type AS "assetType",
        cr.active AS "active",
        cr.contract_addresses AS "contractAddresses",
        cr.icon_url AS "iconUrl",
        cr.updated_at AS "updatedAt"
      FROM cryptos cr
      ${whereClause}
      ${orderClause}
      LIMIT ${query.pageSize}
      OFFSET ${offset}
    `) as Promise<(Omit<CryptoRow, "updatedAt" | "contractAddresses"> & {
      updatedAt: string | Date | null;
      contractAddresses: unknown;
    })[]>,

    buildChainMap(),
  ]);

  const rows: CryptoRow[] = rowsFromDb.map((row) => {
    const contracts = hydrateContracts(parseContractAddresses(row.contractAddresses), chainMap);
    return {
      ...row,
      contractAddresses: contracts,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt
    };
  });

  return { data: rows, total };
}

export async function fetchCryptosForExport() {
  const rows = (await db!.execute(sql`
    SELECT
      cr.code,
      cr.name,
      cr.asset_type AS "assetType",
      cr.active AS "active",
      cr.contract_addresses AS "contractAddresses"
    FROM cryptos cr
    ORDER BY cr.code ASC
  `)) as (Omit<CryptoExportRow, "contractAddresses"> & { contractAddresses: unknown })[];

  const chainMap = await buildChainMap();

  return rows.map((row) => ({
    ...row,
    contractAddresses: hydrateContracts(parseContractAddresses(row.contractAddresses), chainMap)
  }));
}
