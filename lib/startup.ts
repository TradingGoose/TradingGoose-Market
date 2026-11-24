import { requireDatabase } from "@/lib/db/runtime";
import { getMarketRuntimeConfig, type MarketRuntimeConfig } from "@/lib/environment";

export function initializeMarketRuntime(): MarketRuntimeConfig {
  const config = getMarketRuntimeConfig();
  requireDatabase();
  return config;
}
