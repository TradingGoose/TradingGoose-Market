import { sql } from "drizzle-orm";

import { db } from "@tradinggoose/db";

export type DbStatus = {
  ok: boolean;
  message: string;
  durationMs?: number;
};

export async function getDbStatus(): Promise<DbStatus> {
  if (!db) {
    return {
      ok: false,
      message: "DATABASE_POOL_URL or DATABASE_URL is not set; update TradingGoose-Market/.env",
    };
  }

  const started = performance.now();
  try {
    await db.execute(sql`select 1 as ok`);
    const durationMs = performance.now() - started;
    return { ok: true, message: "Connected to Postgres", durationMs };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error";
    return { ok: false, message };
  }
}
