import { sql } from "drizzle-orm";
import { requireDatabase } from "@/lib/db/runtime";
import { getMarketRuntimeConfig, type MarketRuntimeConfig } from "@/lib/environment";

let startupPromise: Promise<MarketRuntimeConfig> | undefined;

async function initialize(): Promise<MarketRuntimeConfig> {
  const config = getMarketRuntimeConfig();
  const database = requireDatabase();
  await database.execute(sql`
    select 1
    from "user", "system_admin", "market_usage_owner", "subscription",
      "user_stats", "market_api_keys", "market_api_usage_events"
    where false
  `);

  return config;
}

export function initializeMarketRuntime(): Promise<MarketRuntimeConfig> {
  startupPromise ??= initialize();
  return startupPromise;
}

export function clearMarketStartupCacheForTests(): void {
  startupPromise = undefined;
}
