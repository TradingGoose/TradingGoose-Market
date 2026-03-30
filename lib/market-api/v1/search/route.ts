import type { ApiContext } from "@/lib/market-api/core/context";

import { db } from "@tradinggoose/db";
import { buildCurrencyPairs } from "./currency";
import { toCryptoListing, toCurrencyListing } from "./mappers";
import type { CryptoPair, Listing, ListingResult } from "./types";
import {
  LISTING_ASSET_CLASSES,
  expandAssetClasses,
  parseFiltersParam,
  parseListParam,
  parsePositiveInt,
  parseSearchQuery
} from "./parsing";
import { resolveSearchParams } from "./params";
import { searchCryptoPairs } from "./cryptos/route";
import { searchListingRows } from "./listings/route";


type RankedListing = {
  listing: ListingResult;
  normalizedRank: number;
  rankValue: number;
};

export async function getSearch(c: ApiContext) {
  try {
    const request = c.req.raw;
    const searchParams = await resolveSearchParams(request);
    const filters = parseFiltersParam(searchParams);
    const limit = parsePositiveInt(filters.limit, 50, 200);
    const rawQuery = searchParams.get("search_query")?.trim() ?? null;
    const parsedQuery = parseSearchQuery(rawQuery);
    const baseQuery = parsedQuery.baseQuery ?? null;
    const quoteQuery = parsedQuery.quoteQuery ?? null;

    const assetClassTokens = filters.assetClasses.length
      ? filters.assetClasses
      : parsedQuery.assetClass
        ? [parsedQuery.assetClass]
        : [];
    const effectiveAssetClasses = expandAssetClasses(assetClassTokens);
    const listingAssetClasses = effectiveAssetClasses.filter((value) =>
      LISTING_ASSET_CLASSES.includes(value as (typeof LISTING_ASSET_CLASSES)[number])
    );
    if (assetClassTokens.length && !effectiveAssetClasses.length) {
      return c.json({ data: [], error: "Invalid asset_class filter." }, 400);
    }

    const regionTokens = filters.regions.length
      ? filters.regions
      : parsedQuery.region
        ? [parsedQuery.region]
        : [];

    const listingQuoteCodes = parseListParam(searchParams, "listing_quote_code");
    const listingQuoteNames = parseListParam(searchParams, "listing_quote_name");

    const cryptoQuoteCodes = parseListParam(searchParams, "crypto_quote_code");
    const cryptoQuoteNames = parseListParam(searchParams, "crypto_quote_name");

    const currencyQuoteCodes = parseListParam(searchParams, "currency_quote_code");
    const currencyQuoteNames = parseListParam(searchParams, "currency_quote_name");

    const micTokens = filters.micTokens;
    const marketTokens = filters.marketTokens;
    const chainTokens = filters.chainTokens;

    const hasListingQuoteFilters = Boolean(listingQuoteCodes.length || listingQuoteNames.length);
    const hasCryptoQuoteFilters = Boolean(cryptoQuoteCodes.length || cryptoQuoteNames.length);
    const hasCurrencyQuoteFilters = Boolean(currencyQuoteCodes.length || currencyQuoteNames.length);
    const hasMicFilters = Boolean(micTokens.length);
    const hasMarketFilters = Boolean(marketTokens.length);
    const hasChainFilters = Boolean(chainTokens.length);

    const hasAnyFilters = Boolean(
      rawQuery ||
      regionTokens.length ||
      hasListingQuoteFilters ||
      hasCryptoQuoteFilters ||
      hasCurrencyQuoteFilters ||
      hasMicFilters ||
      hasMarketFilters ||
      hasChainFilters ||
      effectiveAssetClasses.length
    );

    if (!hasAnyFilters) {
      return c.json({ data: [], error: "At least one search parameter is required." }, 400);
    }

    const normalizedRegionCodes = regionTokens
      .map((token) => token.trim().toUpperCase())
      .filter(Boolean);

    const includeListing = effectiveAssetClasses.length === 0 || listingAssetClasses.length > 0;
    const includeCrypto =
      effectiveAssetClasses.length === 0 || effectiveAssetClasses.includes("crypto");
    const includeCurrency =
      effectiveAssetClasses.length === 0 || effectiveAssetClasses.includes("currency");
    const groupCount = Number(includeListing) + Number(includeCrypto) + Number(includeCurrency);
    const isDefaultQuery = !rawQuery;
    const groupLimit =
      isDefaultQuery && groupCount > 1 ? Math.max(1, Math.ceil(limit / groupCount)) : limit;

    const hasListingCriteria = Boolean(
      rawQuery ||
      regionTokens.length ||
      hasListingQuoteFilters ||
      hasMicFilters ||
      hasMarketFilters ||
      listingAssetClasses.length
    );
    const hasCryptoCriteria = Boolean(
      rawQuery ||
      hasCryptoQuoteFilters ||
      hasChainFilters ||
      effectiveAssetClasses.includes("crypto") ||
      (isDefaultQuery && includeCrypto)
    );
    const hasCurrencyCriteria = Boolean(
      rawQuery ||
      hasCurrencyQuoteFilters ||
      effectiveAssetClasses.includes("currency") ||
      (isDefaultQuery && includeCurrency)
    );

    if (regionTokens.length && !includeListing) {
      return c.json({ data: [] });
    }

    const tasks: Array<Promise<unknown>> = [];
    const params = new URLSearchParams();
    params.set("limit", String(groupLimit));
    if (baseQuery) params.set("base_query", baseQuery);
    if (quoteQuery) params.set("quote_query", quoteQuery);
    regionTokens.forEach((value) => params.append("region", value));
    listingQuoteCodes.forEach((value) => params.append("listing_quote_code", value));
    listingQuoteNames.forEach((value) => params.append("listing_quote_name", value));
    micTokens.forEach((value) => params.append("mic", value));
    marketTokens.forEach((value) => params.append("market", value));

    const listingParams = new URLSearchParams(params);
    listingParams.set("limit", String(groupLimit));
    if (listingAssetClasses.length) {
      listingAssetClasses.forEach((value) => listingParams.append("asset_class", value));
    }

    const results: {
      listings?: Listing[];
      cryptos?: CryptoPair[];
      currencies?: Awaited<ReturnType<typeof buildCurrencyPairs>>;
    } = {};

    if (includeListing && hasListingCriteria) {
      tasks.push(
        searchListingRows(request, listingParams).then((rows) => {
          results.listings = rows;
        })
      );
    }
    if (includeCrypto && hasCryptoCriteria) {
      const cryptoParams = new URLSearchParams();
      cryptoParams.set("limit", String(groupLimit));
      if (baseQuery) cryptoParams.set("base_query", baseQuery);
      if (quoteQuery) cryptoParams.set("quote_query", quoteQuery);
      cryptoQuoteCodes.forEach((value) => cryptoParams.append("crypto_quote_code", value));
      cryptoQuoteNames.forEach((value) => cryptoParams.append("crypto_quote_name", value));
      chainTokens.forEach((value) => cryptoParams.append("chain", value));
      tasks.push(
        searchCryptoPairs(request, cryptoParams, { preferCurrencyQuote: true }).then((rows) => {
          results.cryptos = rows;
        })
      );
    }
    if (includeCurrency && hasCurrencyCriteria) {
      if (!db) {
        return c.json({ data: [], error: "Database connection is not configured." }, 503);
      }
      tasks.push(
        buildCurrencyPairs(
          request,
          {
            baseQuery,
            quoteQuery,
            quoteCodes: currencyQuoteCodes,
            quoteNames: currencyQuoteNames
          },
          groupLimit
        ).then((rows) => {
          results.currencies = rows;
        })
      );
    }

    if (!tasks.length) {
      return c.json({ data: [], error: "No matching asset classes were selected." }, 400);
    }

    await Promise.all(tasks);

    const merged: ListingResult[] = [];
    if (results.listings?.length) {
      for (const listing of results.listings) {
        if (normalizedRegionCodes.length) {
          const countryCode = listing.countryCode?.trim().toUpperCase();
          if (!countryCode || !normalizedRegionCodes.includes(countryCode)) {
            continue;
          }
        }
        merged.push(listing);
      }
    }
    if (results.cryptos?.length) {
      for (const pair of results.cryptos) {
        merged.push(toCryptoListing(pair));
      }
    }
    if (results.currencies?.length) {
      const seen = new Set<string>();
      for (const pair of results.currencies) {
        const listing = toCurrencyListing(pair);
        const key = `${listing.base}:${listing.quote}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(listing);
      }
    }

    const baseNeedle = baseQuery?.trim().toUpperCase();
    const quoteNeedle = quoteQuery?.trim().toUpperCase();
    const filteredMerged =
      baseNeedle && quoteNeedle
        ? merged.filter((listing) => {
          const base = listing.base?.trim().toUpperCase();
          const quote = listing.quote?.trim().toUpperCase();
          return Boolean(base && quote && base.includes(baseNeedle) && quote.includes(quoteNeedle));
        })
        : merged;

    const maxRankByType = new Map<string, number>();
    for (const listing of filteredMerged) {
      const listingType = listing.listing_type ?? "default";
      const rankValue = Number(listing.rank ?? 0);
      const current = maxRankByType.get(listingType) ?? 0;
      if (Number.isFinite(rankValue) && rankValue > current) {
        maxRankByType.set(listingType, rankValue);
      }
    }

    const scored: RankedListing[] = filteredMerged.map((listing) => {
      const listingType = listing.listing_type ?? "default";
      const maxRank = maxRankByType.get(listingType) ?? 0;
      const rankValue = Number(listing.rank ?? 0);
      const normalizedRank =
        Number.isFinite(rankValue) && maxRank > 0 ? rankValue / maxRank : 0;
      return {
        listing,
        normalizedRank,
        rankValue: Number.isFinite(rankValue) ? rankValue : 0
      };
    });

    scored.sort((a, b) => {
      const rankDiff = b.normalizedRank - a.normalizedRank;
      if (rankDiff !== 0) return rankDiff;
      const rawRankDiff = b.rankValue - a.rankValue;
      if (rawRankDiff !== 0) return rawRankDiff;
      const baseDiff = a.listing.base.localeCompare(b.listing.base);
      if (baseDiff !== 0) return baseDiff;
      const quoteA = a.listing.quote ?? "";
      const quoteB = b.listing.quote ?? "";
      return quoteA.localeCompare(quoteB);
    });

    return c.json({
      data: scored.slice(0, limit).map((item) => item.listing)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[search] API error:", message);
    return c.json({ data: [], error: message }, 500);
  }
}
