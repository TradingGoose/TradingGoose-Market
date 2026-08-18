import type { MarketApiActor } from "@/lib/market-api/core/access";
import type { ApiContext } from "@/lib/market-api/core/context";
import { getCrypto } from "@/lib/market-api/v1/get/crypto/route";
import { getCurrency } from "@/lib/market-api/v1/get/currency/route";
import { getListing } from "@/lib/market-api/v1/get/listing/route";
import { getMarketHours } from "@/lib/market-api/v1/get/market-hours/route";
import { getTimeZones } from "@/lib/market-api/v1/get/timezone/route";
import { getSearchCities } from "@/lib/market-api/v1/search/cities/route";
import { getSearchCountries } from "@/lib/market-api/v1/search/countries/route";
import { getSearchCrypto } from "@/lib/market-api/v1/search/cryptos/route";
import { getSearchCurrencies } from "@/lib/market-api/v1/search/currencies/route";
import { getSearchExchanges } from "@/lib/market-api/v1/search/exchanges/route";
import { getSearchListings } from "@/lib/market-api/v1/search/listings/route";
import { getSearch } from "@/lib/market-api/v1/search/route";
import { postDecayCryptoRank } from "@/lib/market-api/v1/update/crypto-rank/decay/route";
import { postUpdateCryptoRank } from "@/lib/market-api/v1/update/crypto-rank/route";
import { postDecayCurrencyRank } from "@/lib/market-api/v1/update/currency-rank/decay/route";
import { postUpdateCurrencyRank } from "@/lib/market-api/v1/update/currency-rank/route";
import { postDecayListingRank } from "@/lib/market-api/v1/update/listing-rank/decay/route";
import { postUpdateListingRank } from "@/lib/market-api/v1/update/listing-rank/route";

export const MARKET_API_METHODS = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
] as const;

export type MarketApiMethod = (typeof MARKET_API_METHODS)[number];

export type MarketApiAccessOwner =
  | "public-read"
  | "private-key"
  | "customer-session"
  | "system-admin-session"
  | "auth-public-same-origin"
  | "auth-session-same-origin"
  | "auth-sensitive-session"
  | "auth-callback"
  | "stripe-webhook"
  | "public-support"
  | "support-rewrite";

export type MarketApiSurface =
  | "keyed"
  | "browser"
  | "entity"
  | "auth"
  | "protocol"
  | "support"
  | "rewrite";

export type MarketApiResourceId =
  | "market_instrument"
  | "city"
  | "country"
  | "currency"
  | "crypto"
  | "exchange"
  | "listing_identity"
  | "market_hour"
  | "timezone";

export type MarketApiResource = Readonly<{
  id: MarketApiResourceId;
  label:
    | "Market Instrument"
    | "City"
    | "Country"
    | "Currency"
    | "Cryptocurrency"
    | "Exchange"
    | "Listing Identity"
    | "Market Hours"
    | "Timezone";
}>;

export type MarketCoreRouteHandler = (
  context: ApiContext,
  actor: MarketApiActor | null,
) => Promise<Response>;

type CommonDescriptor = Readonly<{
  id: string;
  path: string;
  methods: readonly MarketApiMethod[];
  access: MarketApiAccessOwner;
  surface: MarketApiSurface;
  keyed: boolean;
  billable: boolean;
  cors: "public-read" | "private-key" | null;
  category: string | null;
  resource: MarketApiResource | null;
  rewriteDestination?: string;
}>;

export type KeyedMarketRouteDescriptor = CommonDescriptor &
  Readonly<{
    access: "public-read" | "private-key";
    surface: "keyed";
    keyed: true;
    cors: "public-read" | "private-key";
    category: string;
    resource: MarketApiResource;
    handler: MarketCoreRouteHandler;
  }>;

export type NonKeyedMarketRouteDescriptor = CommonDescriptor &
  Readonly<{
    keyed: false;
    billable: false;
    cors: null;
    category: null;
    resource: null;
    handler?: never;
  }>;

export type MarketRouteDescriptor =
  | KeyedMarketRouteDescriptor
  | NonKeyedMarketRouteDescriptor;

const resources = {
  marketInstrument: { id: "market_instrument", label: "Market Instrument" },
  city: { id: "city", label: "City" },
  country: { id: "country", label: "Country" },
  currency: { id: "currency", label: "Currency" },
  crypto: { id: "crypto", label: "Cryptocurrency" },
  exchange: { id: "exchange", label: "Exchange" },
  listingIdentity: { id: "listing_identity", label: "Listing Identity" },
  marketHour: { id: "market_hour", label: "Market Hours" },
  timezone: { id: "timezone", label: "Timezone" },
} as const satisfies Record<string, MarketApiResource>;

function keyed(
  id: string,
  path: string,
  methods: readonly MarketApiMethod[],
  access: "public-read" | "private-key",
  category: string,
  resource: MarketApiResource,
  handler: MarketCoreRouteHandler,
): KeyedMarketRouteDescriptor {
  return Object.freeze({
    id,
    path,
    methods,
    access,
    surface: "keyed",
    keyed: true,
    billable: access === "public-read",
    cors: access,
    category,
    resource,
    handler,
  });
}

function nonKeyed(
  id: string,
  path: string,
  methods: readonly MarketApiMethod[],
  access: Exclude<MarketApiAccessOwner, "public-read" | "private-key">,
  surface: Exclude<MarketApiSurface, "keyed">,
  rewriteDestination?: string,
): NonKeyedMarketRouteDescriptor {
  return Object.freeze({
    id,
    path,
    methods,
    access,
    surface,
    keyed: false,
    billable: false,
    cors: null,
    category: null,
    resource: null,
    ...(rewriteDestination ? { rewriteDestination } : {}),
  });
}

const publicRoutes = [
  keyed("public.search", "/api/search", ["GET", "HEAD"], "public-read", "public.search", resources.marketInstrument, getSearch),
  keyed("public.search.cities", "/api/search/cities", ["GET", "HEAD"], "public-read", "public.search.cities", resources.city, getSearchCities),
  keyed("public.search.countries", "/api/search/countries", ["GET", "HEAD"], "public-read", "public.search.countries", resources.country, getSearchCountries),
  keyed("public.search.currencies", "/api/search/currencies", ["GET", "HEAD"], "public-read", "public.search.currencies", resources.currency, getSearchCurrencies),
  keyed("public.search.cryptos", "/api/search/cryptos", ["GET", "HEAD"], "public-read", "public.search.cryptos", resources.crypto, getSearchCrypto),
  keyed("public.search.exchanges", "/api/search/exchanges", ["GET", "HEAD"], "public-read", "public.search.exchanges", resources.exchange, getSearchExchanges),
  keyed("public.search.listings", "/api/search/listings", ["GET", "HEAD"], "public-read", "public.search.listings", resources.listingIdentity, getSearchListings),
  keyed("public.get.crypto", "/api/get/crypto", ["GET", "HEAD"], "public-read", "public.get.crypto", resources.crypto, getCrypto),
  keyed("public.get.currency", "/api/get/currency", ["GET", "HEAD"], "public-read", "public.get.currency", resources.currency, getCurrency),
  keyed("public.get.listing", "/api/get/listing", ["GET", "HEAD"], "public-read", "public.get.listing", resources.listingIdentity, getListing),
  keyed("public.get.market-hours", "/api/get/market-hours", ["GET", "HEAD"], "public-read", "public.get.market-hours", resources.marketHour, getMarketHours),
  keyed("public.get.timezone", "/api/get/timezone", ["GET", "HEAD"], "public-read", "public.get.timezone", resources.timezone, getTimeZones),
] as const;

const privateRoutes = [
  keyed("private.update.crypto-rank", "/api/update/crypto-rank", ["POST"], "private-key", "private.update.crypto-rank", resources.crypto, postUpdateCryptoRank),
  keyed("private.update.crypto-rank.decay", "/api/update/crypto-rank/decay", ["POST"], "private-key", "private.update.crypto-rank.decay", resources.crypto, postDecayCryptoRank),
  keyed("private.update.currency-rank", "/api/update/currency-rank", ["POST"], "private-key", "private.update.currency-rank", resources.currency, postUpdateCurrencyRank),
  keyed("private.update.currency-rank.decay", "/api/update/currency-rank/decay", ["POST"], "private-key", "private.update.currency-rank.decay", resources.currency, postDecayCurrencyRank),
  keyed("private.update.listing-rank", "/api/update/listing-rank", ["POST"], "private-key", "private.update.listing-rank", resources.listingIdentity, postUpdateListingRank),
  keyed("private.update.listing-rank.decay", "/api/update/listing-rank/decay", ["POST"], "private-key", "private.update.listing-rank.decay", resources.listingIdentity, postDecayListingRank),
] as const;

const accountRoutes = [
  nonKeyed("account.billing", "/api/account/billing", ["GET"], "customer-session", "browser"),
  nonKeyed("account.billing.activate", "/api/account/billing/payg/activate", ["POST"], "customer-session", "browser"),
  nonKeyed("account.billing.portal", "/api/account/billing/portal", ["POST"], "customer-session", "browser"),
  nonKeyed("account.api-keys", "/api/account/api-keys", ["GET", "POST"], "customer-session", "browser"),
  nonKeyed("account.api-key", "/api/account/api-keys/[id]", ["GET", "PATCH", "DELETE"], "customer-session", "browser"),
  nonKeyed("account.activity", "/api/account/activity", ["GET"], "customer-session", "browser"),
  nonKeyed("account.logs", "/api/account/logs", ["GET"], "customer-session", "browser"),
  nonKeyed("account.profile-image", "/api/account/profile/image", ["POST", "DELETE"], "customer-session", "browser"),
  nonKeyed("admin.api-keys", "/api/admin/api-keys", ["GET", "POST"], "system-admin-session", "browser"),
  nonKeyed("admin.api-key", "/api/admin/api-keys/[id]", ["DELETE"], "system-admin-session", "browser"),
  nonKeyed("admin.api-usage", "/api/admin/api-usage", ["GET"], "system-admin-session", "browser"),
] as const;

const entityRoots = [
  "/api/chains",
  "/api/cities",
  "/api/countries",
  "/api/cryptos",
  "/api/currencies",
  "/api/exchanges",
  "/api/listings",
  "/api/markets",
  "/api/time-zones",
] as const;

const entityItems = [
  "/api/chains/[id]",
  "/api/cities/[id]",
  "/api/countries/[id]",
  "/api/cryptos/[id]",
  "/api/currencies/[id]",
  "/api/exchanges/[id]",
  "/api/listings/[id]",
  "/api/markets/[id]",
  "/api/time-zones/[id]",
] as const;

const entityExports = [
  "/api/chains/export",
  "/api/cities/export",
  "/api/countries/export",
  "/api/cryptos/export",
  "/api/currencies/export",
  "/api/exchanges/export",
  "/api/listings/export",
  "/api/market-hours/export",
  "/api/markets/export",
  "/api/time-zones/export",
] as const;

const entityUploads = [
  "/api/uploads/chain-icon",
  "/api/uploads/country-icon",
  "/api/uploads/crypto-icon",
  "/api/uploads/currency-icon",
  "/api/uploads/listing-icon",
] as const;

const entityRoutes = [
  ...entityRoots.map((path) =>
    nonKeyed(`entity.${path.slice(5).replaceAll("/", ".")}`, path, ["GET", "HEAD", "POST"], "system-admin-session", "entity"),
  ),
  nonKeyed("entity.market-hours", "/api/market-hours", ["GET", "HEAD"], "system-admin-session", "entity"),
  ...entityItems.map((path) =>
    nonKeyed(`entity.${path.slice(5).replaceAll("/", ".")}`, path, ["PATCH", "DELETE"], "system-admin-session", "entity"),
  ),
  nonKeyed("entity.market-hours.item", "/api/market-hours/[id]", ["DELETE"], "system-admin-session", "entity"),
  ...entityExports.map((path) =>
    nonKeyed(`entity.${path.slice(5).replaceAll("/", ".")}`, path, ["GET", "HEAD"], "system-admin-session", "entity"),
  ),
  ...entityUploads.map((path) =>
    nonKeyed(`entity.${path.slice(5).replaceAll("/", ".")}`, path, ["POST"], "system-admin-session", "entity"),
  ),
] as const;

const authRoutes = [
  nonKeyed("auth.sign-up.email", "/api/auth/sign-up/email", ["POST"], "auth-public-same-origin", "auth"),
  nonKeyed("auth.sign-in.email", "/api/auth/sign-in/email", ["POST"], "auth-public-same-origin", "auth"),
  nonKeyed("auth.sign-out", "/api/auth/sign-out", ["POST"], "auth-session-same-origin", "auth"),
  nonKeyed("auth.get-session", "/api/auth/get-session", ["GET"], "auth-session-same-origin", "auth"),
  nonKeyed("auth.email-otp.send", "/api/auth/email-otp/send-verification-otp", ["POST"], "auth-public-same-origin", "auth"),
  nonKeyed("auth.sign-in.email-otp", "/api/auth/sign-in/email-otp", ["POST"], "auth-public-same-origin", "auth"),
  nonKeyed("auth.request-password-reset", "/api/auth/request-password-reset", ["POST"], "auth-public-same-origin", "auth"),
  nonKeyed("auth.reset-password.token", "/api/auth/reset-password/[token]", ["GET"], "auth-callback", "auth"),
  nonKeyed("auth.reset-password", "/api/auth/reset-password", ["POST"], "auth-public-same-origin", "auth"),
  nonKeyed("auth.update-user", "/api/auth/update-user", ["POST"], "auth-session-same-origin", "auth"),
  nonKeyed("auth.change-email", "/api/auth/change-email", ["POST"], "auth-sensitive-session", "auth"),
  nonKeyed("auth.verify-email", "/api/auth/verify-email", ["GET"], "auth-callback", "auth"),
] as const;

const supportRoutes = [
  nonKeyed("billing.stripe.webhook", "/api/billing/stripe/webhook", ["POST"], "stripe-webhook", "protocol"),
  nonKeyed("support.health", "/api/health", ["GET", "HEAD"], "public-support", "support"),
  nonKeyed("support.files", "/api/files/serve/[...key]", ["GET", "HEAD"], "public-support", "support"),
  nonKeyed("support.github-stars", "/api/github-stars", ["GET", "HEAD"], "public-support", "support"),
  nonKeyed("rewrite.health", "/health", ["GET", "HEAD"], "support-rewrite", "rewrite", "/api/health"),
  nonKeyed("rewrite.files", "/files/serve/[...key]", ["GET", "HEAD"], "support-rewrite", "rewrite", "/api/files/serve/[...key]"),
] as const;

export const MARKET_API_ROUTE_MANIFEST = Object.freeze([
  ...publicRoutes,
  ...privateRoutes,
  ...accountRoutes,
  ...entityRoutes,
  ...authRoutes,
  ...supportRoutes,
] satisfies readonly MarketRouteDescriptor[]);

const descriptorsByPath = new Map(
  MARKET_API_ROUTE_MANIFEST.map((descriptor) => [descriptor.path, descriptor] as const),
);

const keyedDescriptorsByPath = new Map(
  MARKET_API_ROUTE_MANIFEST.filter(
    (descriptor): descriptor is KeyedMarketRouteDescriptor => descriptor.keyed,
  ).map((descriptor) => [descriptor.path, descriptor] as const),
);

function matchesTemplate(template: string, pathname: string): boolean {
  if (!template.includes("[")) return template === pathname;

  const templateSegments = template.split("/").filter(Boolean);
  const pathSegments = pathname.split("/").filter(Boolean);
  const catchAllIndex = templateSegments.findIndex((segment) => segment.startsWith("[..."));

  if (catchAllIndex === -1 && templateSegments.length !== pathSegments.length) return false;
  if (catchAllIndex !== -1 && pathSegments.length <= catchAllIndex) return false;

  for (let index = 0; index < templateSegments.length; index += 1) {
    const templateSegment = templateSegments[index];
    const pathSegment = pathSegments[index];
    if (templateSegment.startsWith("[...")) return true;
    if (templateSegment.startsWith("[") && templateSegment.endsWith("]")) {
      if (!pathSegment) return false;
      continue;
    }
    if (templateSegment !== pathSegment) return false;
  }

  return true;
}

export function getMarketRouteDescriptorByTemplate(
  template: string,
): MarketRouteDescriptor {
  const descriptor = descriptorsByPath.get(template);
  if (!descriptor) throw new Error(`Unknown Market route descriptor: ${template}`);
  return descriptor;
}

export function resolveMarketRouteDescriptor(
  pathname: string,
): MarketRouteDescriptor | null {
  return (
    descriptorsByPath.get(pathname) ??
    MARKET_API_ROUTE_MANIFEST.find((descriptor) => matchesTemplate(descriptor.path, pathname)) ??
    null
  );
}

export function resolveKeyedMarketRoute(
  pathname: string,
): KeyedMarketRouteDescriptor | null {
  return keyedDescriptorsByPath.get(pathname) ?? null;
}

export function isMarketApiMethod(value: string): value is MarketApiMethod {
  return (MARKET_API_METHODS as readonly string[]).includes(value);
}
