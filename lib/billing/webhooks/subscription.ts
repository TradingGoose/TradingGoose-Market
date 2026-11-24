import { subscription, user, userStats } from "@tradinggoose/db/schema";
import type { MarketTransaction } from "@tradinggoose/db";
import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";
import { acquireBillingSubjectLock } from "@/lib/db/locks";
import { requireDatabase } from "@/lib/db/runtime";
import { getMarketRuntimeConfig } from "@/lib/environment";
import { decimalUsdToNanoUsd, nanoUsdToCentsHalfUp } from "../money";
import {
  getPaygActivationAttemptId,
  getPaygSubscriptionByStripeId,
  withoutPaygActivationAttemptId,
} from "../subscription";
import { createAndSettleUsageInvoice, reconcileUsageInvoices } from "../threshold-billing";
import { resolveRetainedUserStatsForSubscription } from "../user-stats";
import { isExactMarketSubscription } from "../activation";
import { settleClosedMarketUsagePeriods } from "./closed-period-settlement";

export async function handleMarketSubscriptionProjection(
  stripe: Stripe,
  providerSubscriptionId: string,
) {
  const database = requireDatabase();
  const current = await getPaygSubscriptionByStripeId(providerSubscriptionId);
  if (current) {
    await database.transaction(async (tx) => {
      await acquireBillingSubjectLock(tx, current.referenceId);
      const rows = await tx
        .select()
        .from(subscription)
        .where(eq(subscription.id, current.id))
        .for("update")
        .limit(1);
      const locked = rows[0];
      if (!locked || locked.stripeSubscriptionId !== providerSubscriptionId) return;
      const fresh = await stripe.subscriptions.retrieve(providerSubscriptionId);
      requireExactCurrentProviderSubscription(fresh, locked);
      await requireRetainedSubscriptionCustomerBridge(
        tx,
        locked,
        providerCustomerId(fresh),
      );
      const item = fresh.items.data[0];
      const projectedPeriodStart = new Date(item.current_period_start * 1_000);
      const projectedPeriodEnd = new Date(item.current_period_end * 1_000);
      const periodProjection = classifyProviderPeriodProjection(
        locked.periodStart,
        locked.periodEnd,
        projectedPeriodStart,
        projectedPeriodEnd,
      );
      await tx
        .update(subscription)
        .set({
          status: fresh.status,
          stripeCustomerId: providerCustomerId(fresh),
          ...(periodProjection === "same"
            ? {
                periodStart: projectedPeriodStart,
                periodEnd: projectedPeriodEnd,
              }
            : {}),
          cancelAtPeriodEnd: fresh.cancel_at_period_end,
          seats: 1,
          trialStart: fresh.trial_start ? new Date(fresh.trial_start * 1_000) : null,
          trialEnd: fresh.trial_end ? new Date(fresh.trial_end * 1_000) : null,
        })
        .where(eq(subscription.id, locked.id));
    });
    return;
  }

  const fresh = await stripe.subscriptions.retrieve(providerSubscriptionId);
  await classifyUnboundMarketSubscription(stripe, fresh);
}

function classifyProviderPeriodProjection(
  storedStart: Date | null,
  storedEnd: Date | null,
  projectedStart: Date,
  projectedEnd: Date,
): "same" | "next-pending" {
  const storedStartMs = storedStart?.getTime();
  const storedEndMs = storedEnd?.getTime();
  const projectedStartMs = projectedStart.getTime();
  const projectedEndMs = projectedEnd.getTime();
  if (
    !storedStartMs ||
    !storedEndMs ||
    !Number.isSafeInteger(storedStartMs) ||
    !Number.isSafeInteger(storedEndMs) ||
    storedStartMs <= 0 ||
    storedEndMs <= storedStartMs
  ) {
    throw new Error("Current PAYG subscription has an invalid stored period");
  }
  if (
    projectedStartMs === storedStartMs &&
    projectedEndMs === storedEndMs
  ) {
    return "same";
  }
  if (projectedStartMs >= storedEndMs && projectedEndMs > projectedStartMs) {
    // invoice.finalized owns crossing every unsettled boundary, including
    // historical renewal periods missed while webhook sync was disabled.
    return "next-pending";
  }
  throw new Error("Current PAYG provider period is misaligned with its settlement watermark");
}

export async function classifyUnboundMarketSubscription(
  stripe: Stripe,
  fresh: Stripe.Subscription,
) {
  const database = requireDatabase();
  const localId = fresh.metadata.subscriptionId;
  const metadataUserId = fresh.metadata.userId;
  const referenceId = fresh.metadata.referenceId;
  if (!localId || !metadataUserId || referenceId !== metadataUserId) return;
  await database.transaction(async tx => {
    // Activation binds under this same lock. A webhook that observed no binding
    // must wait for that decision before acknowledging its provider ID as stale.
    await acquireBillingSubjectLock(tx, metadataUserId);
    const localRows = await tx
      .select()
      .from(subscription)
      .where(and(
        eq(subscription.id, localId),
        eq(subscription.referenceType, "user"),
        eq(subscription.referenceId, metadataUserId),
        eq(subscription.plan, "payg"),
      ))
      .limit(2);
    if (localRows.length !== 1) return;
    const local = localRows[0];
    if (local.stripeSubscriptionId === fresh.id) {
      throw new Error("PAYG binding changed during webhook classification; retry its current owner");
    }
    if (local.stripeSubscriptionId) return;
    if (!getPaygActivationAttemptId(local.metadata)) return;
    if (fresh.status !== "active") return;

    const liveUsers = await selectLiveUserCustomerBridge(tx, metadataUserId);
    const customerId = providerCustomerId(fresh);
    if (
      liveUsers.length !== 1 ||
      liveUsers[0].stripeCustomerId !== customerId ||
      !isExactMarketSubscription(fresh, {
        customerId,
        localSubscriptionId: local.id,
        priceId: getMarketRuntimeConfig().billing.stripePriceId!,
        userId: local.referenceId,
      })
    ) {
      return;
    }
    const validIds: string[] = [];
    for await (const candidate of stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 100,
    })) {
      const candidateFresh = await stripe.subscriptions.retrieve(candidate.id);
      if (
        candidateFresh.status === "active" &&
        isExactMarketSubscription(candidateFresh, {
          customerId,
          localSubscriptionId: local.id,
          priceId: getMarketRuntimeConfig().billing.stripePriceId!,
          userId: local.referenceId,
        })
      ) {
        validIds.push(candidateFresh.id);
      }
    }
    if (validIds.length > 1) {
      throw new Error("Multiple active PAYG recovery candidates are ambiguous");
    }
    if (validIds.length === 1 && validIds[0] === fresh.id) {
      throw new Error("PAYG activation must bind the unique active recovery candidate");
    }
  });
}

export async function handleMarketSubscriptionDeleted(
  stripe: Stripe,
  snapshot: Stripe.Subscription,
) {
  const database = requireDatabase();
  const current = await getPaygSubscriptionByStripeId(snapshot.id);
  if (!current) {
    await classifyUnboundMarketSubscription(stripe, snapshot);
    return;
  }

  const retainedBinding = await database.transaction(async (tx) => {
    await acquireBillingSubjectLock(tx, current.referenceId);
    const rows = await tx
      .select()
      .from(subscription)
      .where(eq(subscription.id, current.id))
      .for("update")
      .limit(1);
    const locked = rows[0];
    if (!locked || locked.stripeSubscriptionId !== snapshot.id) return;
    if (snapshot.status !== "canceled") {
      throw new Error("Deleted PAYG event does not contain a canceled subscription");
    }
    requireExactCurrentProviderSubscription(snapshot, locked);
    const customerId = providerCustomerId(snapshot);
    await requireRetainedSubscriptionCustomerBridge(tx, locked, customerId);

    // Cancellation is its own durable phase. Keep the provider binding and all
    // settlement inputs until the final usage charge has either succeeded or
    // been authoritatively waived after rounding to cents. A failed provider
    // call therefore leaves entitlement denied without losing retry state.
    const canceled = await tx
      .update(subscription)
      .set({ status: "canceled" })
      .where(
        and(
          eq(subscription.id, locked.id),
          eq(subscription.stripeSubscriptionId, snapshot.id),
        ),
      )
      .returning({ id: subscription.id });
    if (canceled.length !== 1) {
      throw new Error("Current PAYG binding changed while cancellation was recorded");
    }
    return { id: locked.id, referenceId: locked.referenceId };
  });
  if (!retainedBinding) return;

  await database.transaction(async (tx) => {
    await acquireBillingSubjectLock(tx, retainedBinding.referenceId);
    const rows = await tx
      .select()
      .from(subscription)
      .where(eq(subscription.id, retainedBinding.id))
      .for("update")
      .limit(1);
    const locked = rows[0];
    if (
      !locked ||
      locked.stripeSubscriptionId !== snapshot.id ||
      locked.status !== "canceled"
    ) {
      return;
    }
    requireExactCurrentProviderSubscription(snapshot, locked);
    const customerId = providerCustomerId(snapshot);
    await requireRetainedSubscriptionCustomerBridge(tx, locked, customerId);
    const retainedStats = await resolveRetainedUserStatsForSubscription(locked, tx);
    const statsRows = await tx
      .select()
      .from(userStats)
      .where(eq(userStats.id, retainedStats.id))
      .for("update")
      .limit(1);
    const initialStats = statsRows[0];
    if (!initialStats) throw new Error("Retained PAYG usage accumulator is missing");
    // A catch-up transaction can roll back after paying more than one historical
    // period. Recover every such slice through the cycle owner before the final
    // remainder; reconciling only the oldest period would charge later slices twice.
    const { stats, periodEnd } = await settleClosedMarketUsagePeriods(
      tx, stripe, locked, snapshot, customerId, initialStats,
    );
    const currentNano = decimalUsdToNanoUsd(stats.currentPeriodCost);
    const billedUsd = await reconcileUsageInvoices(stripe, {
      customerId,
      stripeSubscriptionId: snapshot.id,
      periodEnd: periodEnd.toISOString(),
      billedUsd: stats.billedOverageThisPeriod,
      currentUsd: stats.currentPeriodCost,
      deletedSubscriptionSnapshot: snapshot,
    });
    const billedNano = decimalUsdToNanoUsd(billedUsd);
    if (billedNano > currentNano) throw new Error("Billed overage exceeds current usage");
    const hasCurrentUsage =
      BigInt(stats.currentPeriodRequestQuantity) !== 0n ||
      currentNano !== 0n ||
      billedNano !== 0n;
    const remainderNano = currentNano - billedNano;
    const amountCents = nanoUsdToCentsHalfUp(remainderNano);
    const periodTime = snapshot.ended_at ?? snapshot.canceled_at ??
      snapshot.items.data[0]?.current_period_end;
    if (!Number.isSafeInteger(periodTime) || !periodTime || periodTime <= 0) {
      throw new Error("Deleted PAYG subscription has no stable settlement period");
    }
    const billingPeriod = new Date(periodTime * 1_000).toISOString().slice(0, 7);
    if (amountCents > 0) {
      const covered = await createAndSettleUsageInvoice(stripe, {
        customerId,
        stripeSubscriptionId: snapshot.id,
        amountCents,
        description: `Final Market usage – ${billingPeriod}`,
        itemDescription: `Final Market data API usage – ${billingPeriod}`,
        metadata: {
          type: "final_overage_billing",
          subscriptionId: snapshot.id,
          billingPeriod,
          usagePeriodEnd: periodEnd.toISOString(),
        },
        snapshot: { fromUsd: billedUsd, throughUsd: stats.currentPeriodCost, requestQuantity: stats.currentPeriodRequestQuantity },
        deletedSubscriptionSnapshot: snapshot,
      });
      if (decimalUsdToNanoUsd(covered.fromUsd) !== billedNano ||
        decimalUsdToNanoUsd(covered.throughUsd) !== currentNano) {
        throw new Error("Stripe final invoice snapshot differs from canceled usage");
      }
    }
    if (hasCurrentUsage) {
      await tx
        .update(userStats)
        .set({
          lastPeriodRequestQuantity: stats.currentPeriodRequestQuantity,
          lastPeriodCost: stats.currentPeriodCost,
          currentPeriodRequestQuantity: "0",
          currentPeriodCost: "0",
          billedOverageThisPeriod: "0",
          updatedAt: new Date(),
        })
        .where(eq(userStats.id, stats.id));
    }
    // This binding can be removed only after every retained usage slice has
    // settled, so its payment block must not leak into a later activation.
    if (stats.billingBlocked) {
      await tx.update(userStats).set({ billingBlocked: false, updatedAt: new Date() })
        .where(eq(userStats.id, stats.id));
    }
    const cleared = await tx
      .update(subscription)
      .set({
        status: "canceled",
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        periodStart: null,
        periodEnd: null,
        cancelAtPeriodEnd: null,
        seats: null,
        trialStart: null,
        trialEnd: null,
        metadata: withoutPaygActivationAttemptId(locked.metadata),
      })
      .where(
        and(
          eq(subscription.id, locked.id),
          eq(subscription.stripeSubscriptionId, snapshot.id),
          eq(subscription.status, "canceled"),
        ),
      )
      .returning({ id: subscription.id });
    if (cleared.length !== 1) {
      throw new Error("Canceled PAYG binding changed before final settlement cleanup");
    }
  });
}

export function requireExactCurrentProviderSubscription(
  provider: Stripe.Subscription,
  local: typeof subscription.$inferSelect,
) {
  const config = getMarketRuntimeConfig();
  if (
    provider.id !== local.stripeSubscriptionId ||
    !local.stripeCustomerId ||
    !config.billing.stripePriceId ||
    !isExactMarketSubscription(provider, {
      customerId: local.stripeCustomerId,
      localSubscriptionId: local.id,
      priceId: config.billing.stripePriceId,
      userId: local.referenceId,
    })
  ) {
    throw new Error("Current PAYG provider subscription drifted from its Market binding");
  }
  const item = provider.items.data[0];
  if (
    !item ||
    !Number.isSafeInteger(item.current_period_start) ||
    !Number.isSafeInteger(item.current_period_end) ||
    item.current_period_start <= 0 ||
    item.current_period_end <= item.current_period_start
  ) {
    throw new Error("Current PAYG provider subscription has an invalid period");
  }
}

export function providerCustomerId(provider: Stripe.Subscription) {
  return typeof provider.customer === "string" ? provider.customer : provider.customer.id;
}

export async function requireRetainedSubscriptionCustomerBridge(
  tx: MarketTransaction,
  local: typeof subscription.$inferSelect,
  customerId: string,
) {
  if (
    local.referenceType !== "user" ||
    local.plan !== "payg" ||
    !local.stripeCustomerId ||
    local.stripeCustomerId !== customerId
  ) {
    throw new Error(
      "Retained PAYG subscription Customer mapping drifted from its binding",
    );
  }
  const rows = await selectLiveUserCustomerBridge(tx, local.referenceId);
  if (rows.length > 1) {
    throw new Error("Retained PAYG subscription resolves multiple Market users");
  }
  if (
    rows.length === 1 &&
    (!rows[0].stripeCustomerId || rows[0].stripeCustomerId !== customerId)
  ) {
    throw new Error(
      "Live Market user Customer mapping drifted from the retained PAYG binding",
    );
  }
}

function selectLiveUserCustomerBridge(
  tx: MarketTransaction,
  referenceId: string,
) {
  return tx
    .select({ id: user.id, stripeCustomerId: user.stripeCustomerId })
    .from(user)
    .where(eq(user.id, referenceId))
    .limit(2);
}
