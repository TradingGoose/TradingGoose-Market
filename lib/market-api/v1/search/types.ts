export type Listing = {
  listing_id: string | null;
  base_id: string | null;
  quote_id: string | null;
  base: string;
  quote: string | null;
  name: string | null;
  iconUrl: string | null;
  assetClass: string;
  listing_type: "default" | "crypto" | "currency";
  rank?: number | null;
  base_asset_class?: string | null;
  quote_asset_class?: string | null;
  primaryMicCode: string | null;
  marketCode?: string | null;
  countryCode: string | null;
  cityName: string | null;
  timeZoneName: string | null;
};

export type CryptoQuote = {
  type: "crypto" | "currency";
  id: string;
  code: string;
  name: string;
  iconUrl: string | null;
  rank?: number | null;
};

export type CryptoBase = {
  id: string;
  code: string;
  name: string;
  iconUrl: string | null;
  rank?: number | null;
};

export type CryptoPair = {
  crypto_base: CryptoBase;
  crypto_quote: CryptoQuote;
};

export type CurrencyPair = {
  currency_base: {
    id: string;
    code: string;
    name: string;
    iconUrl: string | null;
    rank?: number | null;
  };
  currency_quote: {
    id: string;
    code: string;
    name: string;
    iconUrl: string | null;
    rank?: number | null;
  };
};

export type ListingResult = Listing;

export type CurrencyRow = {
  id: string;
  code: string;
  name: string;
  iconUrl: string | null;
  rank: number;
};

export type CurrencyPairFilters = {
  baseQuery?: string | null;
  quoteQuery?: string | null;
  quoteCodes: string[];
  quoteNames: string[];
};
