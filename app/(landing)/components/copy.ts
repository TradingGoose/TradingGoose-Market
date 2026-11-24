export const landingProduct = {
  brand: "TradingGoose Market",
  family: "TradingGoose",
  footerHoverText: "HONK!",
  footerDescription: "Market hours and listing identities for financial applications.",
  description:
    "Market hours, exchange details, and listing IDs in one API. Connect your apps to trading sessions, holidays, currencies, and market time zones."
} as const;

export const landingExternalLinks = {
  marketGitHub: "https://github.com/TradingGoose/TradingGoose-Market",
  studioSite: "https://www.tradinggoose.ai",
  discord: "https://discord.gg/wavf5JWhuT"
} as const;

export type LandingNavLink = {
  label: string;
  href: string;
  ariaLabel?: string;
  external?: boolean;
};

export const landingNavLinks: readonly LandingNavLink[] = [
  {
    label: "Hours",
    href: "/#market-hours"
  },
  {
    label: "Listings",
    href: "/#listing-identities"
  }
];

export const landingGitHubLink = {
  href: landingExternalLinks.marketGitHub,
  ariaLabel: "TradingGoose Market source repository"
} as const;

export const landingHero = {
  statusBadge: "No more broken market identities.",
  headlineLead: "Get",
  headlineRotatingPhrases: [
    "market hours",
    "ticker identity",
    "exchange info"
  ],
  headlineSuffix: "from TradingGoose",
  description:
    "Financial assets identity hub with accurate trading hours data powering financial systems.",
  featureBadges: [
    "Stocks",
    "Exchanges",
    "Market hours",
    "Currencies"
  ],
  secondaryAction: {
    label: "Studio",
    href: landingExternalLinks.studioSite
  }
} as const;

/* Public GET entry points from the finite versioned Market manifest. */
export const apiEntryPoints = [
  {
    method: "GET",
    urlTemplate: "/api/search?version=v1&search_query={search_query}"
  },
  {
    method: "GET",
    urlTemplate: "/api/get/listing?version=v1&listing_id={listing_id}"
  },
  {
    method: "GET",
    urlTemplate: "/api/get/market-hours?version=v1&listing_id={listing_id}&listingType=default&date={date}"
  },
  {
    method: "GET",
    urlTemplate: "/api/get/crypto?version=v1&crypto_id={crypto_id}"
  }
] as const;

export const structuredFeatureList = [
  "Market listing search by symbol and name",
  "Single-record and batch listing lookups",
  "Time-zone-aware trading schedules, holidays, and early closes",
  "Exchange, currency, country, city, and time-zone reference lookups",
  "Versioned anonymous or customer-key public reads",
  "Customer API keys, request activity, and request logs",
  "Optional per-key API charge limits when usage billing is enabled",
  "Self-hostable Market service"
] as const;
