import {
  createMarketDatabase,
  type MarketDatabase,
  type MarketReservedConnection,
} from "@tradinggoose/db";
import { AsyncLocalStorage } from "node:async_hooks";
import { getMarketRuntimeConfig } from "@/lib/environment";

let database: MarketDatabase | undefined;
const databaseContext = new AsyncLocalStorage<MarketDatabase>();

function requirePoolDatabase(): MarketDatabase {
  database ??= createMarketDatabase(getMarketRuntimeConfig().databaseUrl);
  return database;
}

export function requireDatabase(): MarketDatabase {
  return databaseContext.getStore() ?? requirePoolDatabase();
}

export function withDatabaseContext<T>(
  scopedDatabase: MarketDatabase,
  callback: () => Promise<T>,
): Promise<T> {
  return databaseContext.run(scopedDatabase, callback);
}

export function getDatabaseClientOptions(): MarketDatabase["$client"]["options"] {
  return requirePoolDatabase().$client.options;
}

export async function reserveDatabaseConnection(): Promise<MarketReservedConnection> {
  return requirePoolDatabase().$client.reserve();
}
