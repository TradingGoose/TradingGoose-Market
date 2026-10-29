import type { MarketTransaction } from "@tradinggoose/db";
import { sql } from "drizzle-orm";

export async function databaseNow(database: Pick<MarketTransaction, "execute">): Promise<Date> {
  const [clock] = await database.execute<{ now: string }>(sql`select now() as now`);
  if (!clock?.now) throw new Error("Database clock is unavailable");
  // Raw execute bypasses Drizzle's column decoders for timestamp text.
  const now = new Date(clock.now);
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Database clock is unavailable");
  }
  return now;
}
