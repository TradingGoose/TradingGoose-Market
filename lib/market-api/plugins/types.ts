import type { AuthContext } from "@/lib/market-api/core/auth";
import type { ApiContext } from "@/lib/market-api/core/context";

import type { db } from "@tradinggoose/db";

export type PluginRouteNamespace = "search" | "get" | "update";

export type EntityKind =
  | "listing"
  | "crypto"
  | "currency"
  | "country"
  | "exchange"
  | "market"
  | "market-hours";

export type EnrichmentStage = "search" | "get" | "admin-read" | "after-write";

export type MarketDb = NonNullable<typeof db>;

export interface PluginContext {
  request: Request;
  db: typeof db;
  auth: AuthContext;
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  log: Pick<Console, "info" | "warn" | "error">;
  requireDb(): MarketDb;
}

export type CoreRouteHandler = (context: ApiContext, plugin?: PluginContext) => Promise<Response>;

export type PluginRouteHandler = (
  context: ApiContext,
  plugin: PluginContext
) => Promise<Response>;

export interface EntityEnricher<T = unknown> {
  stage: EnrichmentStage;
  run(context: PluginContext, rows: T[]): Promise<T[]>;
}

export interface LogoProviderInput {
  entityKind: Exclude<EntityKind, "market-hours">;
  id?: string | null;
  code?: string | null;
  symbol?: string | null;
  name?: string | null;
  assetClass?: string | null;
  countryCode?: string | null;
  primaryMicCode?: string | null;
  currentIconUrl?: string | null;
  metadata?: Record<string, unknown>;
}

export interface LogoProviderResult {
  iconUrl: string;
  source?: string;
}

export interface LogoProvider {
  run(context: PluginContext, input: LogoProviderInput): Promise<LogoProviderResult | null>;
}

export interface MarketHoursSession {
  type: string;
  start: string;
  end: string;
}

export interface MarketHoursHoliday {
  date: string;
  name?: string;
}

export interface MarketHoursEarlyClose {
  date: string;
  closeTime: string;
}

export interface MarketHoursProviderInput {
  listingId?: string | null;
  listingType?: string | null;
  date?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  metadata?: Record<string, unknown>;
}

export interface MarketHoursData {
  sessions?: MarketHoursSession[];
  holidays?: MarketHoursHoliday[];
  earlyCloses?: MarketHoursEarlyClose[];
  timeZone?: string;
}

export interface MarketHoursProviderResult {
  data: MarketHoursData;
  source?: string;
  /** If true, completely replace core hours instead of merging */
  replace?: boolean;
}

export interface MarketHoursProvider {
  run(
    context: PluginContext,
    input: MarketHoursProviderInput
  ): Promise<MarketHoursProviderResult | null>;
}

export interface ExchangeDetailProviderInput {
  exchangeId?: string | null;
  micCode?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ExchangeDetailData {
  mic?: string;
  name?: string | null;
  lei?: string | null;
  url?: string | null;
  active?: boolean;
  isSegment?: boolean;
  parentId?: string | null;
  countryId?: string | null;
  countryCode?: string | null;
  countryName?: string | null;
  cityId?: string | null;
  cityName?: string | null;
  createdAt?: string | null;
  expiredAt?: string | null;
  updatedAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ExchangeDetailProviderResult {
  data: ExchangeDetailData;
  source?: string;
}

export interface ExchangeDetailProvider {
  run(
    context: PluginContext,
    input: ExchangeDetailProviderInput
  ): Promise<ExchangeDetailProviderResult | null>;
}

export interface MarketPlugin {
  name: string;
  routes?: Partial<Record<PluginRouteNamespace, Record<string, PluginRouteHandler>>>;
  enrichers?: Partial<Record<EntityKind, EntityEnricher[]>>;
  providers?: {
    logo?: LogoProvider[];
    marketHours?: MarketHoursProvider[];
    exchangeDetail?: ExchangeDetailProvider[];
  };
}
