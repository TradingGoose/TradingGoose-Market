export const landingProduct = {
  brand: "TradingGoose Market",
  family: "TradingGoose",
  footerHoverText: "HONK!",
  description:
    "Self-hostable canonical market reference data for TradingGoose, with admin curation and versioned API access."
} as const;

export const landingExternalLinks = {
  marketGitHub: "https://github.com/TradingGoose/TradingGoose-Market",
  marketReadme: "https://github.com/TradingGoose/TradingGoose-Market#readme",
  studioSite: "https://www.tradinggoose.ai",
  discord: "https://discord.gg/wavf5JWhuT",
  marketBlog:
    "https://www.tradinggoose.ai/blog/building-tradinggoose-market#how-rule-resolution-works"
} as const;

export type LandingNavLink = {
  label: string;
  href: string;
  ariaLabel?: string;
};

export const landingNavLinks: readonly LandingNavLink[] = [
  {
    label: "Studio",
    href: landingExternalLinks.studioSite,
    ariaLabel: "TradingGoose Studio website"
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
  primaryAction: { label: "Comming soon" },
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
    urlTemplate: "/api/get/crypto?version=v1&crypto_id={crypto_id}"
  }
] as const;

export const structuredFeatureList = [
  "Canonical market reference data management",
  "Listings, exchanges, cryptocurrencies, currencies, countries, cities, time zones, chains, market groups, and trading hours",
  "Admin browse, create, edit, export, and upload workflows",
  "Versioned anonymous or customer-key public reads",
  "Per-key spend windows with Market-owned Activity and Logs",
  "Icon upload storage across local filesystem, Vercel Blob, or Azure Blob"
] as const;
