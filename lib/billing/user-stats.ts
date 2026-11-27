import { user, marketApiUsageEvent, marketUsageOwner, subscription, userStats } from "@tradinggoose/db/schema";
import type { MarketDatabase, MarketTransaction } from "@tradinggoose/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { requireDatabase } from "@/lib/db/runtime";
import { decimalUsdToNanoUsd, nanoUsdToDecimalUsd } from "./money";

type Balance = Pick<typeof userStats.$inferSelect,
  "grantedOnboardingAllowanceUsd" | "customUsageLimit" | "currentPeriodCost">;
type Binding = Pick<typeof subscription.$inferSelect, "status" | "stripeCustomerId" | "stripeSubscriptionId">;

const positive = (value: bigint) => value > 0n ? value : 0n;

export function effectiveLimitNano(stats: Balance) {
  const grant = decimalUsdToNanoUsd(stats.grantedOnboardingAllowanceUsd);
  const custom = decimalUsdToNanoUsd(stats.customUsageLimit ?? "0");
  return custom > grant ? custom : grant;
}

export function isPaidBinding(local: Binding) {
  return local.status === "active" && !!local.stripeCustomerId?.trim() && !!local.stripeSubscriptionId?.trim();
}

export function isFreeBinding(local: Binding) {
  return local.stripeSubscriptionId === null && local.stripeCustomerId === null &&
    (local.status === null || local.status === "canceled");
}

// Free reentry restores historical usage to the accumulator. Debit only usage since that checkpoint.
function newFreeUsageNano(stats: Balance) {
  const settled = positive(decimalUsdToNanoUsd(stats.customUsageLimit ?? "0") - decimalUsdToNanoUsd(stats.grantedOnboardingAllowanceUsd));
  return positive(decimalUsdToNanoUsd(stats.currentPeriodCost) - settled);
}

export function remainingFreeAllowance(stats: Balance) {
  return nanoUsdToDecimalUsd(positive(decimalUsdToNanoUsd(stats.grantedOnboardingAllowanceUsd) - newFreeUsageNano(stats)));
}

export function paidEntryValues(stats: Balance & { currentPeriodRequestQuantity: string }) {
  const consumed = newFreeUsageNano(stats);
  return {
    grantedOnboardingAllowanceUsd: remainingFreeAllowance(stats),
    currentPeriodCost: "0", currentPeriodRequestQuantity: "0", billedOverageThisPeriod: "0",
    ...(consumed > 0n && { lastPeriodCost: nanoUsdToDecimalUsd(consumed), lastPeriodRequestQuantity: stats.currentPeriodRequestQuantity }),
    updatedAt: new Date(),
  };
}

export function freeEntryValues(configuredGrant: string, remainingGrant: string) {
  const now = new Date();
  return {
    customUsageLimit: configuredGrant, customUsageLimitUpdatedAt: now, updatedAt: now,
    currentPeriodCost: nanoUsdToDecimalUsd(positive(decimalUsdToNanoUsd(configuredGrant) - decimalUsdToNanoUsd(remainingGrant))),
    currentPeriodRequestQuantity: "0", billedOverageThisPeriod: "0", billingBlocked: false,
  };
}

export function personalUsageLimit(stats: Balance & { billingBlocked: boolean }, enabled: boolean) {
  const current = decimalUsdToNanoUsd(stats.currentPeriodCost);
  const limit = effectiveLimitNano(stats);
  const isExceeded = enabled && current >= limit;
  const status = !enabled ? "ok" : stats.billingBlocked ? "blocked" : isExceeded ? "exceeded"
    : current * 100n >= limit * 80n ? "warning" : "ok";
  return {
    currentLimitUsd: enabled ? nanoUsdToDecimalUsd(limit) : null, isExceeded,
    percentUsed: enabled && limit > 0n ? Number(current) / Number(limit) * 100 : 0, status,
  } as const;
}

// The caller owns the billing subject lock. Match the retained ledger to its live personal identity.
export async function readPersonalBillingState(tx: MarketTransaction, userId: string) {
  const [row] = await tx.select({ subscription, stats: userStats, customerId: user.stripeCustomerId })
    .from(subscription)
    .innerJoin(userStats, eq(userStats.billingReferenceId, subscription.referenceId))
    .innerJoin(marketUsageOwner, eq(marketUsageOwner.id, userStats.usageOwnerId))
    .innerJoin(user, eq(user.id, subscription.referenceId))
    .where(and(eq(subscription.id, `sub_default_${userId}`), eq(subscription.referenceId, userId),
      eq(subscription.referenceType, "user"), eq(subscription.plan, "payg"),
      eq(userStats.userId, userId), eq(marketUsageOwner.userId, userId)))
    .for("update", { of: userStats }).limit(1);
  if (!row) throw new Error("Personal PAYG billing state is missing");
  return row;
}

export async function getClosedPeriodUsage(
  tx: MarketTransaction,
  stats: Pick<typeof userStats.$inferSelect,
    "usageOwnerId" | "currentPeriodRequestQuantity" | "currentPeriodCost">,
  periodEnd: Date,
  stripeSubscriptionId: string,
) {
  const [usage] = await tx.select({
    requestQuantity: sql<string>`coalesce(sum(${marketApiUsageEvent.billableQuantity}), 0)::text`,
    costUsd: sql<string>`coalesce(sum(${marketApiUsageEvent.billableCostUsd}), 0)::text`,
  }).from(marketApiUsageEvent).where(and(
    eq(marketApiUsageEvent.usageOwnerId, stats.usageOwnerId),
    eq(marketApiUsageEvent.billableQuantity, 1),
    eq(marketApiUsageEvent.stripeSubscriptionId, stripeSubscriptionId),
    gte(marketApiUsageEvent.admittedAt, periodEnd),
  ));
  if (!usage) throw new Error("PAYG closed-period usage is unavailable");
  // The accumulator already excludes every prior settled activation. Replaying
  // a timestamp-bounded prefix could include an old subscription that ended in
  // the same Stripe second as reactivation. Remove only newer unswept events.
  const requestQuantity = BigInt(stats.currentPeriodRequestQuantity) - BigInt(usage.requestQuantity);
  const costNano = decimalUsdToNanoUsd(stats.currentPeriodCost) - decimalUsdToNanoUsd(usage.costUsd);
  if (requestQuantity < 0n || costNano < 0n) {
    throw new Error("Next-period PAYG usage exceeds its accumulator");
  }
  return { requestQuantity: requestQuantity.toString(), costUsd: nanoUsdToDecimalUsd(costNano) };
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
