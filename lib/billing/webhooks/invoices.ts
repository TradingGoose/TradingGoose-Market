import { subscription, userStats } from "@tradinggoose/db/schema";
import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";
import { acquireBillingSubjectLock } from "@/lib/db/locks";
import { requireDatabase } from "@/lib/db/runtime";
import { decimalUsdToNanoUsd, nanoUsdToCentsHalfUp } from "../money";
import { getPaygSubscriptionByStripeId } from "../subscription";
import { createAndSettleUsageInvoice } from "../threshold-billing";
import { resolveRetainedUserStatsForSubscription } from "../user-stats";
import {
  classifyUnboundMarketSubscription,
  providerCustomerId,
  requireExactCurrentProviderSubscription,
  requireRetainedSubscriptionCustomerBridge,
} from "./subscription";

export async function handleMarketCycleInvoiceFinalized(
  stripe: Stripe,
  invoice: Stripe.Invoice,
) {
  if (invoice.billing_reason !== "subscription_cycle") return;
  const parentSubscription = invoice.parent?.subscription_details?.subscription;
  const stripeSubscriptionId =
    typeof parentSubscription === "string"
      ? parentSubscription
      : parentSubscription?.id;
  if (!stripeSubscriptionId) return;

  // Provider-subscription ID ownership is classified before Customer/Price metadata.
  const current = await getPaygSubscriptionByStripeId(stripeSubscriptionId);
  if (!current) {
    const fresh = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    await classifyUnboundMarketSubscription(stripe, fresh);
    return;
  }

  const database = requireDatabase();
  await database.transaction(async (tx) => {
    await acquireBillingSubjectLock(tx, current.referenceId);
    const localRows = await tx
      .select()
      .from(subscription)
      .where(eq(subscription.id, current.id))
      .for("update")
      .limit(1);
    const local = localRows[0];
    if (!local || local.stripeSubscriptionId !== stripeSubscriptionId) return;

    const storedPeriodStart = requireStoredPeriodBoundary(
      local.periodStart,
      "start",
    );
    const storedPeriodEnd = requireStoredPeriodBoundary(local.periodEnd, "end");
    if (storedPeriodEnd <= storedPeriodStart) {
      throw new Error("Current PAYG subscription has an invalid stored period");
    }
    const invoicePeriodStart = requireInvoicePeriodBoundary(
      invoice.period_start,
      "start",
    );
    const invoicePeriodEnd = requireInvoicePeriodBoundary(invoice.period_end, "end");

    // The generic subscription period is the settlement watermark. A delivery
    // behind that watermark has already been settled, while a delivery beyond it
    // must retry after the missing boundary is processed.
    if (invoicePeriodEnd < storedPeriodEnd) return;
    if (invoicePeriodEnd > storedPeriodEnd) {
      throw new Error("PAYG cycle invoice is ahead of the stored settlement boundary");
    }
    if (invoicePeriodStart !== storedPeriodStart) {
      throw new Error("PAYG cycle invoice is misaligned with the stored period");
    }

    const fresh = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    requireExactCurrentProviderSubscription(fresh, local);
    const invoiceCustomerId =
      typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
    if (!invoiceCustomerId || invoiceCustomerId !== providerCustomerId(fresh)) {
      throw new Error("Current PAYG cycle invoice Customer does not match its binding");
    }
    const providerItem = fresh.items.data[0];
    if (providerItem.current_period_start * 1_000 !== storedPeriodEnd) {
      throw new Error("Current PAYG provider period is not the next settlement period");
    }
    const nextPeriodStart = new Date(providerItem.current_period_start * 1_000);
    const nextPeriodEnd = new Date(providerItem.current_period_end * 1_000);
    await requireRetainedSubscriptionCustomerBridge(
      tx,
      local,
      invoiceCustomerId,
    );
    const retainedStats = await resolveRetainedUserStatsForSubscription(local, tx);
    const statsRows = await tx
      .select()
      .from(userStats)
      .where(eq(userStats.id, retainedStats.id))
      .for("update")
      .limit(1);
    const stats = statsRows[0];
    if (!stats || stats.usageOwnerId === "") {
      throw new Error("Retained PAYG usage accumulator is missing");
    }
    const currentNano = decimalUsdToNanoUsd(stats.currentPeriodCost);
    const billedNano = decimalUsdToNanoUsd(stats.billedOverageThisPeriod);
    if (billedNano > currentNano) throw new Error("Billed overage exceeds current usage");
    const remainderNano = currentNano - billedNano;
    const amountCents = nanoUsdToCentsHalfUp(remainderNano);
    const billingPeriod = new Date(invoicePeriodEnd).toISOString().slice(0, 7);
    if (amountCents > 0) {
      await createAndSettleUsageInvoice(stripe, {
        customerId: invoiceCustomerId,
        stripeSubscriptionId,
        amountCents,
        itemIdempotencyKey: `overage-item:${invoiceCustomerId}:${stripeSubscriptionId}:${billingPeriod}`,
        invoiceIdempotencyKey: `overage-invoice:${invoiceCustomerId}:${stripeSubscriptionId}:${billingPeriod}`,
        description: `Market usage – ${billingPeriod}`,
        itemDescription: `Market data API usage – ${billingPeriod}`,
        metadata: {
          type: "overage_billing",
          subscriptionId: stripeSubscriptionId,
          billingPeriod,
        },
      });
    }
    const advanced = await tx
      .update(subscription)
      .set({
        periodStart: nextPeriodStart,
        periodEnd: nextPeriodEnd,
      })
      .where(
        and(
          eq(subscription.id, local.id),
          eq(subscription.stripeSubscriptionId, stripeSubscriptionId),
          eq(subscription.periodEnd, new Date(storedPeriodEnd)),
        ),
      )
      .returning({ id: subscription.id });
    if (advanced.length !== 1) {
      throw new Error("PAYG settlement watermark changed before it could advance");
    }
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
  });
}

function requireStoredPeriodBoundary(value: Date | null, boundary: "start" | "end") {
  const milliseconds = value?.getTime();
  if (!milliseconds || !Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    throw new Error(`Current PAYG subscription has an invalid stored period ${boundary}`);
  }
  return milliseconds;
}

function requireInvoicePeriodBoundary(value: number, boundary: "start" | "end") {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Current PAYG cycle invoice has an invalid period ${boundary}`);
  }
  return value * 1_000;
}
