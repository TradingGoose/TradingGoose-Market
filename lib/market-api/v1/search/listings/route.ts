import { sql, type SQL } from "drizzle-orm";
import type { ApiContext } from "@/lib/market-api/core/context";
import type { HttpStatusCode } from "@/lib/market-api/core/http";

import { db } from "@tradinggoose/db";
import { resolveIconUrl } from "../utils";
import type { Listing } from "../types";
import { resolveSearchParams } from "../params";

function parsePositiveInt(value: string | null | undefined, fallback: number, max?: number) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.max(Math.floor(parsed), 1);
  if (typeof max === "number") return Math.min(normalized, max);
  return normalized;
}

type CountrySearchRow = {
  id: string;
};

type ExchangeSearchRow = {
  id: string;
};

type MarketSearchRow = {
  id: string;
};

type CurrencySearchRow = {
  id: string;
};

function intersectIds(current: string[] | null, next: string[]) {
  if (!current) return next;
  if (!next.length) return [];
  const nextSet = new Set(next);
  return current.filter((id) => nextSet.has(id));
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
        // Fall through to manual parsing.
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

async function fetchCountryIdsByTokens(tokens: string[]) {
  if (!db) return [];
  if (!tokens.length) return [];
  const filters = tokens.map(
    (token) =>
      sql`(COALESCE(name, '') ILIKE ${`%${token}%`} OR COALESCE(code, '') ILIKE ${`%${token}%`})`
  );
  const rows = (await db.execute(sql`
    SELECT id
    FROM countries
    WHERE ${sql.join(filters, sql` OR `)}
  `)) as unknown as CountrySearchRow[];
  return uniqueNonEmpty(rows.map((row) => row.id));
}

function buildOrderBy(searchTerm?: string) {
  const term = searchTerm?.trim();
  if (!term) {
    return sql`ORDER BY l.rank DESC, l.base ASC`;
  }

  const prefix = `${term}%`;
  const contains = `%${term}%`;
  return sql`
    ORDER BY
      CASE
        WHEN l.base ILIKE ${term} THEN 0
        WHEN l.name ILIKE ${term} THEN 1
        WHEN l.base ILIKE ${prefix} THEN 2
        WHEN l.name ILIKE ${prefix} THEN 3
        WHEN l.base ILIKE ${contains} THEN 4
        WHEN l.name ILIKE ${contains} THEN 5
        ELSE 6
      END,
      l.rank DESC,
      l.base ASC
  `;
}

type ListingSearchResult = {
  listingId: string | null;
  baseId: string | null;
  quoteId: string | null;
  base: string;
  quote: string | null;
  name: string | null;
  iconUrl: string | null;
  assetClass: string;
  rank: number | null;
  logoMissing?: boolean | null;
  logoCheckedAt?: string | Date | null;
  primaryMicCode: string | null;
  marketCode: string | null;
  countryCode: string | null;
  cityName: string | null;
  timeZoneName: string | null;
};

function withIconUrl(request: Request, listing: ListingSearchResult) {
  return {
    ...listing,
    iconUrl: resolveIconUrl(request, listing.iconUrl)
  };
}

function buildPublicListings(
  request: Request,
  rows: ListingSearchResult[]
): Listing[] {
  return rows.map((row) => toPublicListing(withIconUrl(request, row)));
}

async function fetchListingsByFilters(filters: SQL[], limit: number, searchTerm?: string) {
  if (!db) return [] as ListingSearchResult[];
  if (!filters.length) return [] as ListingSearchResult[];
  const whereClause = sql`WHERE ${sql.join(filters, sql` AND `)}`;
  const orderByClause = buildOrderBy(searchTerm);
  const rows = (await db.execute(sql`
    SELECT
      l.id AS "listingId",
      l.base,
      cq.code AS "quote",
      NULL::text AS "baseId",
      NULL::text AS "quoteId",
      l.name AS "name",
      l.icon_url AS "iconUrl",
      l.asset_class AS "assetClass",
      l.rank AS "rank",
      l.logo_missing AS "logoMissing",
      l.logo_checked_at AS "logoCheckedAt",
      pm.mic AS "primaryMicCode",
      mk.code AS "marketCode",
      c.code AS "countryCode",
      ct.name AS "cityName",
      tz.name AS "timeZoneName"
    FROM listings l
    LEFT JOIN currencies cq ON cq.id = l.quote
    LEFT JOIN exchanges pm ON pm.id = l.primary_exch_id
    LEFT JOIN markets mk ON mk.id = l.market_id
    LEFT JOIN countries c ON c.id = pm.country_id
    LEFT JOIN cities ct ON ct.id = pm.city_id
    LEFT JOIN time_zones tz ON tz.id = ct.time_zone_id
    ${whereClause}
    ${orderByClause}
    LIMIT ${limit}
  `)) as unknown as ListingSearchResult[];

  return rows;
}

export async function fetchListingById(
  request: Request,
  listingId: string,
  options?: { forceLogoRefresh?: boolean }
): Promise<Listing | null> {
  if (!db) {
    throw new Error("Database connection is not configured.");
  }

  const trimmedId = listingId.trim();
  if (!trimmedId) return null;

  const rows = await fetchListingsByFilters([sql`l.id = ${trimmedId}`], 1);
  const listing = rows[0];
  if (!listing) return null;

  return toPublicListing(withIconUrl(request, listing));
}

export async function fetchListingsByIds(
  request: Request,
  listingIds: string[],
  options?: { forceLogoRefresh?: boolean }
): Promise<Map<string, Listing>> {
  if (!db) {
    throw new Error("Database connection is not configured.");
  }

  const ids = uniqueNonEmpty(
    listingIds.map((id) => id.trim()).filter((id) => id.length > 0)
  );
  if (!ids.length) return new Map();

  const rows = await fetchListingsByFilters(
    [sql`l.id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`],
    ids.length
  );
  if (!rows.length) return new Map();

  const listings = buildPublicListings(request, rows);
  const map = new Map<string, Listing>();
  for (const listing of listings) {
    if (listing.listing_id) {
      map.set(listing.listing_id, listing);
    }
  }
  return map;
}

type ListingSearchResponse = {
  data: Listing[] | Listing | null;
  status: HttpStatusCode;
  error?: string;
};

async function runListingSearch(
  request: Request,
  searchParams: URLSearchParams
): Promise<ListingSearchResponse> {
  if (!db) {
    return { data: [], error: "Database connection is not configured.", status: 503 };
  }

  const listingId = searchParams.get("listing_id")?.trim();
  if (listingId) {
    return {
      data: [],
      error: "listing_id is not supported on /search/listings. Use /get/listing instead.",
      status: 400
    };
  }
  const countryIdsParam = parseListParam(searchParams, "country_id");
  const assetClassParam = parseListParam(searchParams, "asset_class");
  const listingQuoteIdsParam = parseListParam(searchParams, "listing_quote_id");
  const listingQuoteCodesParam = uniqueNonEmpty(
    parseListParam(searchParams, "listing_quote_code").map((code) => code.toUpperCase())
  );
  const listingQuoteNamesParam = parseListParam(searchParams, "listing_quote_name");
  const countryNameTokens = parseListParam(searchParams, "country_name");
  const countryCodeTokens = parseListParam(searchParams, "country_code");
  const baseQuery =
    searchParams.get("base_query")?.trim() ??
    searchParams.get("search_query")?.trim();
  const quoteQuery = searchParams.get("quote_query")?.trim();
  const regionTokens = parseListParam(searchParams, "region");
  const countryTokens = uniqueNonEmpty([
    ...regionTokens,
    ...countryNameTokens,
    ...countryCodeTokens
  ]);
  const listingName = searchParams.get("listing_name")?.trim();
  const listingBase = searchParams.get("listing_base")?.trim();
  const listingQuote = searchParams.get("listing_quote")?.trim();
  const marketTokens = parseListParam(searchParams, "market");
  const marketIdsParam = parseListParam(searchParams, "market_id");
  const marketCodesParam = parseListParam(searchParams, "market_code");
  const marketNamesParam = parseListParam(searchParams, "market_name");

  const limit = parsePositiveInt(searchParams.get("limit"), 50, 200);
  const activeFilter = sql`l.active = true`;

  let quoteIds: string[] | null = null;
  if (listingQuoteIdsParam.length) {
    quoteIds = listingQuoteIdsParam;
  }
  if (listingQuote || quoteQuery || listingQuoteCodesParam.length || listingQuoteNamesParam.length) {
    const filters: SQL[] = [];
    if (listingQuote) {
      filters.push(sql`COALESCE(code, '') ILIKE ${`%${listingQuote}%`}`);
    }
    if (quoteQuery) {
      filters.push(sql`(COALESCE(code, '') ILIKE ${`%${quoteQuery}%`} OR COALESCE(name, '') ILIKE ${`%${quoteQuery}%`})`);
    }
    if (listingQuoteCodesParam.length) {
      filters.push(sql`COALESCE(code, '') IN (${sql.join(listingQuoteCodesParam.map((code) => sql`${code}`), sql`, `)})`);
    }
    if (listingQuoteNamesParam.length) {
      const nameFilters = listingQuoteNamesParam.map(
        (name) => sql`COALESCE(name, '') ILIKE ${`%${name}%`}`
      );
      filters.push(sql`(${sql.join(nameFilters, sql` OR `)})`);
    }
    if (filters.length) {
      const rows = (await db.execute(sql`
        SELECT id
        FROM currencies
        WHERE ${sql.join(filters, sql` AND `)}
      `)) as unknown as CurrencySearchRow[];
      const resolvedIds = uniqueNonEmpty(rows.map((row) => row.id));
      quoteIds = intersectIds(quoteIds, resolvedIds);
      if (quoteIds && !quoteIds.length) {
        return { data: [], status: 200 };
      }
    }
  }

  const quoteFilter = quoteIds && quoteIds.length
    ? sql`l.quote IN (${sql.join(quoteIds.map((id) => sql`${id}`), sql`, `)})`
    : null;

  let marketIds: string[] | null = null;
  if (marketIdsParam.length) {
    marketIds = marketIdsParam;
  }
  if (marketTokens.length) {
    const normalized = uniqueNonEmpty(marketTokens.map((token) => token.toUpperCase()));
    const rows = (await db.execute(sql`
      SELECT id
      FROM markets
      WHERE id IN (${sql.join(normalized.map((token) => sql`${token}`), sql`, `)})
         OR code IN (${sql.join(normalized.map((token) => sql`${token}`), sql`, `)})
    `)) as unknown as MarketSearchRow[];
    marketIds = intersectIds(marketIds, uniqueNonEmpty(rows.map((row) => row.id)));
  }
  if (marketCodesParam.length) {
    const codeFilters = marketCodesParam.map(
      (code) => sql`COALESCE(code, '') ILIKE ${`%${code}%`}`
    );
    const rows = (await db.execute(sql`
      SELECT id
      FROM markets
      WHERE ${sql.join(codeFilters, sql` OR `)}
    `)) as unknown as MarketSearchRow[];
    marketIds = intersectIds(marketIds, uniqueNonEmpty(rows.map((row) => row.id)));
  }
  if (marketNamesParam.length) {
    const rows = (await db.execute(sql`
      SELECT id
      FROM markets
      WHERE ${sql.join(
      marketNamesParam.map((name) => sql`COALESCE(name, '') ILIKE ${`%${name}%`}`),
      sql` OR `
    )}
    `)) as unknown as MarketSearchRow[];
    marketIds = intersectIds(marketIds, uniqueNonEmpty(rows.map((row) => row.id)));
  }
  if (marketIds && !marketIds.length) {
    return { data: [], status: 200 };
  }

  let countryIds: string[] | null = null;
  if (countryIdsParam.length) {
    countryIds = countryIdsParam;
  }
  if (countryTokens.length) {
    const resolvedCountryIds = await fetchCountryIdsByTokens(countryTokens);
    countryIds = intersectIds(countryIds, resolvedCountryIds);
  }
  if (countryIds && !countryIds.length) {
    return { data: [], status: 200 };
  }

  let countryExchangeIds: string[] | null = null;
  if (countryIds && countryIds.length) {
    const rows = (await db.execute(sql`
      SELECT id
      FROM exchanges
      WHERE country_id IN (${sql.join(countryIds.map((id) => sql`${id}`), sql`, `)})
    `)) as unknown as ExchangeSearchRow[];
    countryExchangeIds = uniqueNonEmpty(rows.map((row) => row.id));
    if (!countryExchangeIds.length) {
      return { data: [], status: 200 };
    }
  }

  const countryFilter = countryExchangeIds && countryExchangeIds.length
    ? sql`(
        pm.id IN (${sql.join(countryExchangeIds.map((id) => sql`${id}`), sql`, `)}) OR
        (l.secondary_exch_ids && ARRAY[${sql.join(countryExchangeIds.map((id) => sql`${id}`), sql`, `)}]::text[])
      )`
    : null;

  const marketFilter = marketIds && marketIds.length
    ? sql`l.market_id IN (${sql.join(marketIds.map((id) => sql`${id}`), sql`, `)})`
    : null;

  const listingNameFilter = listingName
    ? sql`COALESCE(l.name, '') ILIKE ${`%${listingName}%`}`
    : null;
  const listingBaseFilter = listingBase ? sql`l.base ILIKE ${`%${listingBase}%`}` : null;
  const listingSearchFilter = baseQuery
    ? sql`(
        l.base ILIKE ${`%${baseQuery}%`} OR
        COALESCE(l.name, '') ILIKE ${`%${baseQuery}%`}
      )`
    : null;
  const assetClassFilter =
    assetClassParam.length > 0
      ? sql`(${sql.join(
        assetClassParam.map((value) => sql`l.asset_class ILIKE ${value}`),
        sql` OR `
      )})`
      : null;

  const rankedFilters: SQL[][] = [];

  if (baseQuery) {
    const filters = [
      listingSearchFilter,
      assetClassFilter,
      quoteFilter,
      countryFilter,
      marketFilter,
      activeFilter
    ]
      .filter(Boolean) as SQL[];
    const rows = await fetchListingsByFilters(filters, limit, baseQuery);
    if (!rows.length) {
      return { data: [], status: 200 };
    }
    return { data: buildPublicListings(request, rows), status: 200 };
  }

  const orderByTerm = listingName ?? listingBase ?? undefined;
  if (listingName) {
    if (listingBaseFilter && quoteFilter) {
      rankedFilters.push(
        [
          listingNameFilter,
          listingBaseFilter,
          assetClassFilter,
          quoteFilter,
          countryFilter,
          marketFilter,
          activeFilter
        ]
          .filter(Boolean) as SQL[]
      );
    }
    if (quoteFilter) {
      rankedFilters.push(
        [
          listingNameFilter,
          assetClassFilter,
          quoteFilter,
          countryFilter,
          marketFilter,
          activeFilter
        ].filter(Boolean) as SQL[]
      );
    }
    if (listingBaseFilter) {
      rankedFilters.push(
        [
          listingNameFilter,
          listingBaseFilter,
          assetClassFilter,
          countryFilter,
          marketFilter,
          activeFilter
        ].filter(Boolean) as SQL[]
      );
    }
    rankedFilters.push(
      [listingNameFilter, assetClassFilter, countryFilter, marketFilter, activeFilter].filter(Boolean) as SQL[]
    );
  } else if (listingBaseFilter) {
    if (quoteFilter) {
      rankedFilters.push(
        [
          listingBaseFilter,
          assetClassFilter,
          quoteFilter,
          countryFilter,
          marketFilter,
          activeFilter
        ].filter(Boolean) as SQL[]
      );
    }
    rankedFilters.push(
      [listingBaseFilter, assetClassFilter, countryFilter, marketFilter, activeFilter].filter(Boolean) as SQL[]
    );
  }

  for (const filters of rankedFilters) {
    const rows = await fetchListingsByFilters(filters, limit, orderByTerm);
    if (rows.length) {
      return { data: buildPublicListings(request, rows), status: 200 };
    }
  }

  if (baseQuery || listingName || listingBase) {
    return { data: [], status: 200 };
  }

  const fallbackFilters: SQL[] = [];
  if (assetClassFilter) {
    fallbackFilters.push(assetClassFilter);
  }
  if (quoteFilter) {
    fallbackFilters.push(quoteFilter);
  }
  if (countryFilter) {
    fallbackFilters.push(countryFilter);
  }
  if (marketFilter) {
    fallbackFilters.push(marketFilter);
  }
  if (fallbackFilters.length) {
    fallbackFilters.push(activeFilter);
  }

  if (!fallbackFilters.length) {
    const hasMicSearchInput = Boolean(
      searchParams.get("mic") ||
      searchParams.get("mic[]") ||
      searchParams.get("mic_name") ||
      searchParams.get("mic_name[]") ||
      searchParams.get("mic_code") ||
      searchParams.get("mic_code[]") ||
      searchParams.get("exch_id") ||
      searchParams.get("exch_id[]")
    );

    const hasSearchInput = Boolean(
      baseQuery ||
      quoteQuery ||
      regionTokens.length ||
      listingName ||
      listingBase ||
      listingQuote ||
      assetClassParam.length ||
      listingQuoteIdsParam.length ||
      listingQuoteCodesParam.length ||
      listingQuoteNamesParam.length ||
      marketTokens.length ||
      marketIdsParam.length ||
      marketCodesParam.length ||
      marketNamesParam.length ||
      hasMicSearchInput ||
      countryIdsParam.length ||
      countryTokens.length
    );
    if (hasSearchInput) {
      return { data: [], status: 200 };
    }
    return { data: [], error: "At least one search parameter is required.", status: 400 };
  }

  const rows = await fetchListingsByFilters(fallbackFilters, limit, listingName ?? undefined);
  return { data: buildPublicListings(request, rows), status: 200 };
}

export async function getSearchListings(c: ApiContext) {
  try {
    const request = c.req.raw;
    const searchParams = await resolveSearchParams(request);
    const result = await runListingSearch(request, searchParams);
    if (result.status >= 400) {
      return c.json({ data: result.data ?? [], error: result.error ?? "Unknown error" }, result.status);
    }
    return c.json({ data: result.data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[search/listings] API error:", message);
    return c.json({ data: [], error: message }, 500);
  }
}

export async function searchListingRows(
  request: Request,
  searchParams: URLSearchParams
): Promise<Listing[]> {
  const result = await runListingSearch(request, searchParams);
  if (result.status >= 400) {
    throw new Error(result.error ?? `Listing search failed with status ${result.status}`);
  }
  if (!result.data) return [];
  return Array.isArray(result.data) ? result.data : [result.data];
}

function toPublicListing(listing: ListingSearchResult) {
  const assetClass = listing.assetClass?.toLowerCase();
  const listing_type: "default" | "crypto" | "currency" =
    assetClass === "crypto" ? "crypto" : assetClass === "currency" ? "currency" : "default";
  return {
    listing_id: listing.listingId,
    base_id: listing.baseId,
    quote_id: listing.quoteId,
    base: listing.base,
    quote: listing.quote,
    name: listing.name,
    iconUrl: listing.iconUrl,
    assetClass: listing.assetClass,
    listing_type,
    rank: listing.rank,
    primaryMicCode: listing.primaryMicCode,
    marketCode: listing.marketCode,
    countryCode: listing.countryCode,
    cityName: listing.cityName,
    timeZoneName: listing.timeZoneName
  };
}
