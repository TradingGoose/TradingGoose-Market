import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_POOL_URL ?? process.env.DATABASE_URL;

function parsePoolSize(envValue: string | undefined, fallback: number) {
  if (!envValue) return fallback;
  const n = Number.parseInt(envValue, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

let queryClient: ReturnType<typeof postgres> | null = null;

if (connectionString) {
  try {
    queryClient = postgres(connectionString, {
      max: parsePoolSize(process.env.DATABASE_POOL_MAX, 20),
      idle_timeout: 20,
      connect_timeout: 10
    });
  } catch {
    queryClient = null;
  }
}

export const db = queryClient ? drizzle(queryClient, { schema }) : null;
export { schema };
export * from "./schema";
