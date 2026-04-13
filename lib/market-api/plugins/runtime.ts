import { getInstalledMarketPlugins } from "@/lib/market-api/plugins/installed";
import { after } from "next/server";
import type {
  CoreRouteHandler,
  EntityEnricher,
  EnrichmentStage,
  EntityKind,
  ExchangeDetailProviderInput,
  ExchangeDetailProviderResult,
  MarketHoursProviderInput,
  MarketHoursProviderResult,
  MarketPlugin,
  LogoProviderInput,
  LogoProviderResult,
  PluginContext,
  PluginRouteHandler,
  PluginRouteNamespace
} from "@/lib/market-api/plugins/types";

export function adaptCoreRouteHandler(handler: CoreRouteHandler): PluginRouteHandler {
  return async (context, plugin) => handler(context, plugin);
}

const routeCache = new Map<string, Promise<Readonly<Record<string, PluginRouteHandler>>>>();
const enricherCache = new Map<string, Promise<EntityEnricher[]>>();

export async function resolvePluginRoutes(
  namespace: PluginRouteNamespace,
  coreRoutes: Record<string, PluginRouteHandler>
) {
  let cached = routeCache.get(namespace);
  if (!cached) {
    cached = (async () => {
      const merged: Record<string, PluginRouteHandler> = { ...coreRoutes };
      const installedMarketPlugins = await getInstalledMarketPlugins();

      for (const plugin of installedMarketPlugins) {
        const routes = plugin.routes?.[namespace];
        if (!routes) continue;

        for (const [key, handler] of Object.entries(routes)) {
          if (merged[key]) {
            throw new Error(
              `Plugin route conflict for ${namespace}/${key}: plugin "${plugin.name}" duplicates an existing route.`
            );
          }
          merged[key] = handler;
        }
      }

      return Object.freeze(merged);
    })();

    routeCache.set(namespace, cached);
  }

  return cached;
}

export async function getEntityEnrichers(
  kind: EntityKind,
  stage: EnrichmentStage
): Promise<EntityEnricher[]> {
  const key = `${kind}:${stage}`;
  let cached = enricherCache.get(key);

  if (!cached) {
    cached = (async () => {
      const installedMarketPlugins = await getInstalledMarketPlugins();

      return installedMarketPlugins.flatMap((plugin) => {
        const enrichers = plugin.enrichers?.[kind] ?? [];
        return enrichers.filter((enricher) => enricher.stage === stage);
      });
    })();

    enricherCache.set(key, cached);
  }

  return cached;
}

export async function runEntityEnrichers<T>(
  context: PluginContext,
  kind: EntityKind,
  stage: EnrichmentStage,
  rows: T[]
) {
  const enrichers = await getEntityEnrichers(kind, stage);
  if (!enrichers.length) return rows;

  let current = rows;
  for (const enricher of enrichers) {
    current = await (enricher as EntityEnricher<T>).run(context, current);
  }
  return current;
}

export function triggerEntityEnrichersInBackground<T>(
  context: PluginContext,
  kind: EntityKind,
  stage: EnrichmentStage,
  rows: T[]
) {
  if (!rows.length) return;

  const queuedRows = [...rows];
  after(async () => {
    try {
      await runEntityEnrichers(context, kind, stage, queuedRows);
    } catch (error) {
      context.log.error(`[plugins] background ${kind}/${stage} enrichment failed`, error);
    }
  });
}

async function getProviders<T>(key: keyof NonNullable<MarketPlugin["providers"]>): Promise<T[]> {
  const installedMarketPlugins = await getInstalledMarketPlugins();
  return installedMarketPlugins.flatMap((plugin) => (plugin.providers?.[key] ?? []) as T[]);
}

async function runFirstProvider<I, R>(
  key: keyof NonNullable<MarketPlugin["providers"]>,
  context: PluginContext,
  input: I
): Promise<R | null> {
  const providers = await getProviders<{ run(ctx: PluginContext, providerInput: I): Promise<R | null> }>(key);

  for (const provider of providers) {
    const result = await provider.run(context, input);
    if (result) return result;
  }

  return null;
}

export async function runLogoProviders(
  context: PluginContext,
  input: LogoProviderInput
): Promise<LogoProviderResult | null> {
  return runFirstProvider<LogoProviderInput, LogoProviderResult>("logo", context, input);
}

export async function runMarketHoursProviders(
  context: PluginContext,
  input: MarketHoursProviderInput
): Promise<MarketHoursProviderResult | null> {
  return runFirstProvider<MarketHoursProviderInput, MarketHoursProviderResult>(
    "marketHours",
    context,
    input
  );
}

export async function runExchangeDetailProviders(
  context: PluginContext,
  input: ExchangeDetailProviderInput
): Promise<ExchangeDetailProviderResult | null> {
  return runFirstProvider<ExchangeDetailProviderInput, ExchangeDetailProviderResult>(
    "exchangeDetail",
    context,
    input
  );
}
