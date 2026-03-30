import type { CryptoPair, CurrencyPair, ListingResult } from "./types";

export function toCryptoListing(pair: CryptoPair): ListingResult {
  const base = pair.crypto_base;
  const quote = pair.crypto_quote;
  const baseName = base.name?.trim() || base.code;
  const quoteName = quote.name?.trim() || quote.code;
  return {
    listing_id: null,
    base_id: base.id,
    quote_id: quote.id,
    base: base.code,
    quote: quote.code,
    name: `${baseName} to ${quoteName} pair`,
    iconUrl: base.iconUrl,
    assetClass: "crypto",
    listing_type: "crypto",
    rank: base.rank ?? 0,
    base_asset_class: "crypto",
    quote_asset_class: quote.type === "crypto" ? "crypto" : "currency",
    primaryMicCode: null,
    countryCode: null,
    cityName: null,
    timeZoneName: null
  };
}

export function toCurrencyListing(pair: CurrencyPair): ListingResult {
  const base = pair.currency_base;
  const quote = pair.currency_quote;
  const baseName = base.name?.trim() || base.code;
  const quoteName = quote.name?.trim() || quote.code;
  return {
    listing_id: null,
    base_id: base.id,
    quote_id: quote.id,
    base: base.code,
    quote: quote.code,
    name: `${baseName} to ${quoteName} pair`,
    iconUrl: base.iconUrl,
    assetClass: "currency",
    listing_type: "currency",
    rank: base.rank ?? 0,
    base_asset_class: "currency",
    quote_asset_class: "currency",
    primaryMicCode: null,
    countryCode: null,
    cityName: null,
    timeZoneName: null
  };
}
