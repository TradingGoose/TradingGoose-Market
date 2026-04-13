import { sql, type SQL } from "drizzle-orm";
import type { ApiContext } from "@/lib/market-api/core/context";
import type { PluginContext } from "@/lib/market-api/plugins/types";
import { triggerEntityEnrichersInBackground } from "@/lib/market-api/plugins/runtime";

import { db } from "@tradinggoose/db";
import { resolveIconUrl } from "../utils";
import type { CryptoPair } from "../types";
import { resolveSearchParams } from "../params";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_QUOTE_LIMIT = 10;
const DEFAULT_BASE_LIMIT = 50;

type CryptoRow = {
  id: string;
  code: string;
  name: string;
  iconUrl: string | null;
  assetType: string | null;
  rank: number;
};

type CryptoRowMeta = CryptoRow & {
  logoMissing?: boolean | null;
  logoCheckedAt?: string | Date | null;
};

export type CryptoDetail = Omit<CryptoRowMeta, "logoMissing" | "logoCheckedAt" | "assetType">;

type CurrencyRow = {
  id: string;
  code: string;
  name: string;
  iconUrl: string | null;
  rank: number;
};

type QuoteCandidate =
  | ({ type: "crypto" } & CryptoRowMeta)
  | ({ type: "currency" } & CurrencyRow);

function parsePositiveInt(value: string | null | undefined, fallback: number, max?: number) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.max(Math.floor(parsed), 1);
  if (typeof max === "number") return Math.min(normalized, max);
  return normalized;
}

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function parseListParam(searchParams: URLSearchParams, key: string) {
  const rawValues = [
    ...searchParams.getAll(key),
    ...searchParams.getAll(`${key}[]`)
  ];
  if (!rawValues.length) return [];

  const tokens: string[] = [];
  for (const raw of rawValues) {
    if (!raw) continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const pushToken = (value: string) => {
      const cleaned = value.trim().replace(/^['"]|['"]$/g, "");
      if (cleaned) tokens.push(cleaned);
    };

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item === null || item === undefined) continue;
            pushToken(String(item));
          }
          continue;
        }
      } catch {
        // fall through
      }
      const inner = trimmed.slice(1, -1);
      if (inner) {
        inner.split(",").forEach((value) => pushToken(value));
      }
      continue;
    }

    if (trimmed.includes(",")) {
      trimmed.split(",").forEach((value) => pushToken(value));
      continue;
    }

    pushToken(trimmed);
  }

  return uniqueNonEmpty(tokens);
}

function normalizeQuoteType(value: string | null) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "both") return "both" as const;
  if (normalized === "crypto") return "crypto" as const;
  if (normalized === "currency" || normalized === "fiat") return "currency" as const;
  return "both" as const;
}

function normalizeAssetType(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function stripAssetType<T extends { assetType?: string | null }>(row: T) {
  const { assetType: _assetType, ...rest } = row;
  return rest;
}

function resolveCryptoIcon(request: Request, row: CryptoRowMeta) {
  const { logoMissing: _logoMissing, logoCheckedAt: _logoCheckedAt, ...rest } = row;
  return { ...rest, iconUrl: resolveIconUrl(request, row.iconUrl) };
}

function resolveCurrencyIcon(request: Request, row: CurrencyRow) {
  return { ...row, iconUrl: resolveIconUrl(request, row.iconUrl) };
}

function buildContractExists(filter: SQL) {
  return sql`EXISTS (
    SELECT 1
    FROM jsonb_array_elements(cr.contract_addresses) AS c
    WHERE ${filter}
  )`;
}

function buildChainExists(filter: SQL) {
  return sql`EXISTS (
    SELECT 1
    FROM jsonb_array_elements(cr.contract_addresses) AS c
    JOIN chains ch ON ch.id = c->>'chainId'
    WHERE ${filter}
  )`;
}

async function fetchCryptos(
  filters: SQL[],
  limit: number
): Promise<CryptoRowMeta[]> {
  if (!db) return [];
  const whereClause = filters.length ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;
  const rows = (await db.execute(sql`
    SELECT
      cr.id,
      cr.code,
      cr.name,
      cr.icon_url AS "iconUrl",
      cr.logo_missing AS "logoMissing",
      cr.logo_checked_at AS "logoCheckedAt",
      cr.asset_type AS "assetType",
      cr.rank
    FROM cryptos cr
    ${whereClause}
    ORDER BY cr.rank DESC, cr.code ASC
    LIMIT ${limit}
  `)) as unknown as CryptoRowMeta[];
  return rows;
}

async function fetchCurrencies(
  filters: SQL[],
  limit: number
): Promise<CurrencyRow[]> {
  if (!db) return [];
  const whereClause = filters.length ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;
  const rows = (await db.execute(sql`
    SELECT
      id,
      code,
      name,
      icon_url AS "iconUrl",
      rank
    FROM currencies
    ${whereClause}
    ORDER BY rank DESC, code ASC
    LIMIT ${limit}
  `)) as unknown as CurrencyRow[];
  return rows;
}

export async function fetchCryptoById(
  request: Request,
  cryptoId: string,
  options?: { forceLogoRefresh?: boolean }
): Promise<CryptoDetail | null> {
  if (!db) {
    throw new Error("Database connection is not configured.");
  }

  const trimmedId = cryptoId.trim();
  if (!trimmedId) return null;

  const rows = await fetchCryptos([sql`cr.id = ${trimmedId}`], 1);
  const row = rows[0];
  if (!row) return null;

  const resolved = resolveCryptoIcon(request, row);

  return stripAssetType(resolved);
}

export async function fetchCryptosByIds(
  request: Request,
  cryptoIds: string[],
  options?: { forceLogoRefresh?: boolean }
): Promise<Map<string, CryptoDetail>> {
  if (!db) {
    throw new Error("Database connection is not configured.");
  }

  const ids = uniqueNonEmpty(
    cryptoIds.map((id) => id.trim()).filter((id) => id.length > 0)
  );
  if (!ids.length) return new Map();

  const rows = await fetchCryptos(
    [sql`cr.id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`],
    ids.length
  );
  if (!rows.length) return new Map();

  const resolved = rows.map((row) => stripAssetType(resolveCryptoIcon(request, row)));
  return new Map(resolved.map((row) => [row.id, row]));
}

export async function searchCryptoPairs(
  request: Request,
  searchParams: URLSearchParams,
  options?: { preferCurrencyQuote?: boolean },
  plugin?: PluginContext
): Promise<CryptoPair[]> {
  if (!db) {
    throw new Error("Database connection is not configured.");
  }

  const limit = parsePositiveInt(searchParams.get("limit"), DEFAULT_LIMIT, MAX_LIMIT);
  const quoteType = normalizeQuoteType(
    searchParams.get("crypto_quote_type") ?? searchParams.get("quote_type")
  );

  const baseIds = parseListParam(searchParams, "crypto_base_id");
  const baseCodes = parseListParam(searchParams, "crypto_base_code").map((code) => code.toUpperCase());
  const baseNames = parseListParam(searchParams, "crypto_base_name");
  const baseQuery =
    searchParams.get("base_query")?.trim() ??
    searchParams.get("search_query")?.trim();
  const chainTokens = parseListParam(searchParams, "chain");
  const chainCodes = parseListParam(searchParams, "chain_code").map((code) => code.toUpperCase());
  const chainNames = parseListParam(searchParams, "chain_name");
  const chainIds = parseListParam(searchParams, "chain_id");

  const quoteIds = parseListParam(searchParams, "crypto_quote_id");
  const quoteCodes = parseListParam(searchParams, "crypto_quote_code").map((code) => code.toUpperCase());
  const quoteNames = parseListParam(searchParams, "crypto_quote_name");
  const quoteQuery = searchParams.get("quote_query")?.trim();

  const hasBaseFilters = Boolean(
    baseIds.length ||
    baseCodes.length ||
    baseNames.length ||
    baseQuery ||
    chainTokens.length ||
    chainCodes.length ||
    chainNames.length ||
    chainIds.length
  );
  const hasQuoteFilters = Boolean(
    quoteIds.length || quoteCodes.length || quoteNames.length || quoteQuery
  );

  const baseFilters: SQL[] = [];
  if (baseIds.length) {
    baseFilters.push(sql`cr.id IN (${sql.join(baseIds.map((id) => sql`${id}`), sql`, `)})`);
  }
  if (baseCodes.length) {
    const uniqueCodes = uniqueNonEmpty(baseCodes);
    baseFilters.push(sql`cr.code IN (${sql.join(uniqueCodes.map((code) => sql`${code}`), sql`, `)})`);
  }
  if (baseNames.length) {
    const nameFilters = baseNames.map((name) => sql`cr.name ILIKE ${`%${name}%`}`);
    baseFilters.push(sql`(${sql.join(nameFilters, sql` OR `)})`);
  }
  if (baseQuery) {
    const pattern = `%${baseQuery}%`;
    baseFilters.push(sql`(cr.code ILIKE ${pattern} OR cr.name ILIKE ${pattern})`);
  }
  baseFilters.push(sql`lower(cr.asset_type) = 'coin'`);
  baseFilters.push(sql`cr.active = true`);
  if (chainTokens.length) {
    const tokenFilters = chainTokens.flatMap((token) => [
      buildChainExists(sql`ch.code ILIKE ${token}`),
      buildChainExists(sql`ch.name ILIKE ${`%${token}%`}`),
      buildContractExists(sql`c->>'chainId' = ${token}`)
    ]);
    baseFilters.push(sql`(${sql.join(tokenFilters, sql` OR `)})`);
  }
  if (chainCodes.length) {
    const uniqueCodes = uniqueNonEmpty(chainCodes);
    baseFilters.push(
      buildChainExists(
        sql`ch.code IN (${sql.join(uniqueCodes.map((code) => sql`${code}`), sql`, `)})`
      )
    );
  }
  if (chainNames.length) {
    const chainNameFilters = chainNames.map((name) => sql`ch.name ILIKE ${`%${name}%`}`);
    baseFilters.push(buildChainExists(sql`(${sql.join(chainNameFilters, sql` OR `)})`));
  }
  if (chainIds.length) {
    baseFilters.push(
      buildContractExists(
        sql`c->>'chainId' IN (${sql.join(chainIds.map((id) => sql`${id}`), sql`, `)})`
      )
    );
  }

  const quoteCryptoFilters: SQL[] = [];
  if (quoteIds.length) {
    quoteCryptoFilters.push(sql`cr.id IN (${sql.join(quoteIds.map((id) => sql`${id}`), sql`, `)})`);
  }
  if (quoteCodes.length) {
    const uniqueCodes = uniqueNonEmpty(quoteCodes);
    quoteCryptoFilters.push(sql`cr.code IN (${sql.join(uniqueCodes.map((code) => sql`${code}`), sql`, `)})`);
  }
  if (quoteNames.length) {
    const nameFilters = quoteNames.map((name) => sql`cr.name ILIKE ${`%${name}%`}`);
    quoteCryptoFilters.push(sql`(${sql.join(nameFilters, sql` OR `)})`);
  }
  if (quoteQuery) {
    const pattern = `%${quoteQuery}%`;
    quoteCryptoFilters.push(sql`(cr.code ILIKE ${pattern} OR cr.name ILIKE ${pattern})`);
  }
  quoteCryptoFilters.push(sql`lower(cr.asset_type) = 'coin'`);
  quoteCryptoFilters.push(sql`cr.active = true`);

  const quoteCurrencyFilters: SQL[] = [];
  if (quoteIds.length) {
    quoteCurrencyFilters.push(sql`id IN (${sql.join(quoteIds.map((id) => sql`${id}`), sql`, `)})`);
  }
  if (quoteCodes.length) {
    const uniqueCodes = uniqueNonEmpty(quoteCodes);
    quoteCurrencyFilters.push(sql`code IN (${sql.join(uniqueCodes.map((code) => sql`${code}`), sql`, `)})`);
  }
  if (quoteNames.length) {
    const nameFilters = quoteNames.map((name) => sql`name ILIKE ${`%${name}%`}`);
    quoteCurrencyFilters.push(sql`(${sql.join(nameFilters, sql` OR `)})`);
  }
  if (quoteQuery) {
    const pattern = `%${quoteQuery}%`;
    quoteCurrencyFilters.push(sql`(code ILIKE ${pattern} OR name ILIKE ${pattern})`);
  }

  const baseLimit = hasBaseFilters ? Math.min(limit, MAX_LIMIT) : Math.min(DEFAULT_BASE_LIMIT, limit);
  const quoteLimit = hasQuoteFilters ? Math.min(limit, MAX_LIMIT) : Math.min(DEFAULT_QUOTE_LIMIT, limit);

  // Run all independent DB fetches concurrently
  const baseCryptosPromise = fetchCryptos(baseFilters, baseLimit);
  const quoteCryptoPromise = quoteType !== "currency"
    ? fetchCryptos(quoteCryptoFilters, quoteLimit)
    : Promise.resolve([] as CryptoRowMeta[]);
  const quoteCurrencyPromise = quoteType !== "crypto"
    ? fetchCurrencies(quoteCurrencyFilters, quoteLimit)
    : Promise.resolve([] as CurrencyRow[]);

  const [rawBaseCryptos, rawCryptoQuotes, rawCurrencyQuotes] = await Promise.all([
    baseCryptosPromise,
    quoteCryptoPromise,
    quoteCurrencyPromise,
  ]);

  // Apply enrichers if plugin context is available
  if (plugin) {
    triggerEntityEnrichersInBackground(plugin, "crypto", "search", rawBaseCryptos);
  }
  const baseCryptos = rawBaseCryptos;

  const quoteCandidates: QuoteCandidate[] = [];
  if (quoteType !== "currency" && rawCryptoQuotes.length) {
    if (plugin) {
      triggerEntityEnrichersInBackground(plugin, "crypto", "search", rawCryptoQuotes);
    }
    const cryptoQuotes = rawCryptoQuotes;
    cryptoQuotes.forEach((row) => quoteCandidates.push({ type: "crypto", ...row }));
  }
  if (quoteType !== "crypto" && rawCurrencyQuotes.length) {
    if (plugin) {
      triggerEntityEnrichersInBackground(plugin, "currency", "search", rawCurrencyQuotes);
    }
    const currencyQuotes = rawCurrencyQuotes;
    currencyQuotes.forEach((row) => quoteCandidates.push({ type: "currency", ...row }));
  }

  if (!baseCryptos.length || !quoteCandidates.length) {
    return [];
  }

  const resultsByKey = new Map<string, {
    pairRank: number;
    crypto_base: CryptoRow;
    crypto_quote: QuoteCandidate;
  }>();
  const resolvedBases = baseCryptos.map((row) => resolveCryptoIcon(request, row));
  const resolvedQuotes: QuoteCandidate[] = quoteCandidates.map((row) =>
    row.type === "crypto"
      ? ({ type: "crypto" as const, ...resolveCryptoIcon(request, row) })
      : ({ type: "currency" as const, ...resolveCurrencyIcon(request, row) })
  );

  for (const base of resolvedBases) {
    const baseCode = base.code.trim().toUpperCase();
    const baseAssetType = normalizeAssetType(base.assetType);
    for (const quote of resolvedQuotes) {
      if (quote.type === "crypto" && quote.id === base.id) continue;
      if (quote.type === "currency" && quote.code.toUpperCase() === base.code.toUpperCase()) {
        continue;
      }
      const quoteCode = quote.code.trim().toUpperCase();
      const quoteAssetType =
        quote.type === "crypto" ? normalizeAssetType(quote.assetType) : "currency";
      const pairRank = base.rank ?? 0;
      const key = `${baseCode}|${baseAssetType}|${quoteCode}|${quoteAssetType}`;
      const existing = resultsByKey.get(key);
      if (!existing || pairRank > existing.pairRank) {
        resultsByKey.set(key, { pairRank, crypto_base: base, crypto_quote: quote });
      }
    }
  }

  let results = Array.from(resultsByKey.values());
  const preferCurrencyQuote = options?.preferCurrencyQuote ?? false;
  if (preferCurrencyQuote) {
    const grouped = new Map<string, { currency?: (typeof results)[number]; cryptos: (typeof results)[number][] }>();
    for (const result of results) {
      const baseCode = result.crypto_base.code.trim().toUpperCase();
      const baseAssetType = normalizeAssetType(result.crypto_base.assetType);
      const quoteCode = result.crypto_quote.code.trim().toUpperCase();
      const key = `${baseCode}|${baseAssetType}|${quoteCode}`;
      const bucket = grouped.get(key) ?? { cryptos: [] };
      if (result.crypto_quote.type === "currency") {
        if (!bucket.currency || result.pairRank > bucket.currency.pairRank) {
          bucket.currency = result;
        }
      } else {
        bucket.cryptos.push(result);
      }
      grouped.set(key, bucket);
    }
    const collapsed: typeof results = [];
    for (const bucket of grouped.values()) {
      if (bucket.currency) {
        collapsed.push(bucket.currency);
      } else {
        collapsed.push(...bucket.cryptos);
      }
    }
    results = collapsed;
  }
  results.sort((a, b) => {
    if (b.pairRank !== a.pairRank) return b.pairRank - a.pairRank;
    const baseDiff = a.crypto_base.code.localeCompare(b.crypto_base.code);
    if (baseDiff !== 0) return baseDiff;
    return a.crypto_quote.code.localeCompare(b.crypto_quote.code);
  });

  return results.slice(0, limit).map(({ pairRank: _pairRank, crypto_base, crypto_quote }) => ({
    crypto_base: stripAssetType(crypto_base),
    crypto_quote: crypto_quote.type === "crypto" ? stripAssetType(crypto_quote) : crypto_quote
  }));
}

export async function getSearchCrypto(c: ApiContext, plugin?: PluginContext) {
  try {
    if (!db) {
      return c.json({ data: [], error: "Database connection is not configured." }, 503);
    }

    const request = c.req.raw;
    const searchParams = await resolveSearchParams(request);
    const cryptoId = searchParams.get("crypto_id")?.trim() ?? searchParams.get("cryptoId")?.trim();
    if (cryptoId) {
      return c.json(
        { data: [], error: "crypto_id is not supported on /search/cryptos. Use /get/crypto instead." },
        400
      );
    }
    const data = await searchCryptoPairs(request, searchParams, undefined, plugin);

    return c.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[search/cryptos] API error:", message);
    return c.json({ data: [], error: message }, 500);
  }
}
