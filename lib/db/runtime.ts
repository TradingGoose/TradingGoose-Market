import {
  createMarketDatabase,
  type MarketDatabase,
  type MarketReservedConnection,
} from "@tradinggoose/db";
import { getMarketRuntimeConfig } from "@/lib/environment";

let database: MarketDatabase | undefined;

export function requireDatabase(): MarketDatabase {
  database ??= createMarketDatabase(getMarketRuntimeConfig().databaseUrl);
  return database;
}

export async function reserveDatabaseConnection(): Promise<MarketReservedConnection> {
  return requireDatabase().$client.reserve();
}
