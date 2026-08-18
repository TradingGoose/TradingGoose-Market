import { marketUsageOwner, subscription, userStats } from "@tradinggoose/db/schema";
import type { MarketDatabase, MarketTransaction } from "@tradinggoose/db";
import { eq } from "drizzle-orm";
import { requireDatabase } from "@/lib/db/runtime";

export async function getActiveUserStats(userId: string, database = requireDatabase()) {
  const rows = await database
    .select()
    .from(userStats)
    .where(eq(userStats.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function resolveRetainedUserStatsForSubscription(
  localSubscription: typeof subscription.$inferSelect,
  database: MarketDatabase | MarketTransaction = requireDatabase(),
) {
  if (
    localSubscription.referenceType !== "user" ||
    localSubscription.plan !== "payg"
  ) {
    throw new Error("PAYG settlement requires a personal subscription reference");
  }
  const rows = await database
    .select({ stats: userStats, owner: marketUsageOwner })
    .from(userStats)
    .innerJoin(marketUsageOwner, eq(marketUsageOwner.id, userStats.usageOwnerId))
    .where(eq(userStats.billingReferenceId, localSubscription.referenceId))
    .limit(2);
  if (rows.length !== 1) {
    throw new Error("PAYG subscription does not resolve exactly one retained usage accumulator");
  }
  if (rows[0].stats.usageOwnerId !== rows[0].owner.id) {
    throw new Error("PAYG subscription usage-owner bridge is invalid");
  }
  if (
    rows[0].stats.userId !== null &&
    (rows[0].stats.userId !== localSubscription.referenceId ||
      rows[0].owner.userId !== localSubscription.referenceId)
  ) {
    throw new Error("Active PAYG usage accumulator identity bridge is invalid");
  }
  if (rows[0].stats.userId === null && rows[0].owner.userId !== null) {
    throw new Error("Retained PAYG usage-owner link is inconsistent");
  }
  return rows[0].stats;
}
