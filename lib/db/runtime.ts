import { createMarketDatabase, type MarketDatabase } from "@tradinggoose/db";
import { getMarketRuntimeConfig } from "@/lib/environment";

let database: MarketDatabase | undefined;

export function requireDatabase(): MarketDatabase {
  database ??= createMarketDatabase(getMarketRuntimeConfig().databaseUrl);
  return database;
}
