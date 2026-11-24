import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export function createMarketDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, {
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10
  });
  return drizzle(client, { schema });
}

export type MarketDatabase = ReturnType<typeof createMarketDatabase>;
export type MarketTransaction = Parameters<
  Parameters<MarketDatabase["transaction"]>[0]
>[0];

export { schema };
export * from "./schema";
