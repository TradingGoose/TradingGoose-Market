import { subscription, userStats } from "@tradinggoose/db/schema";
import type { MarketTransaction } from "@tradinggoose/db";
import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";
import { decimalUsdToNanoUsd, nanoUsdToCentsHalfUp, nanoUsdToDecimalUsd } from "../money";
import { createAndSettleUsageInvoice, reconcileUsageInvoices } from "../threshold-billing";
import { getClosedPeriodUsage } from "../user-stats";

/** Cycle delivery and cancellation must recover the same historical slices. */
export async function settleClosedMarketUsagePeriods(
  tx: MarketTransaction,
  stripe: Stripe,
  local: typeof subscription.$inferSelect,
  provider: Stripe.Subscription,
  customerId: string,
  initialStats: typeof userStats.$inferSelect,
  eventInvoice?: Stripe.Invoice,
) {
  const periods = await settlementPeriods(stripe, local, provider, customerId, eventInvoice);
  let stats = initialStats;
  let periodEnd = local.periodEnd!;
  const deletedSubscriptionSnapshot = provider.status === "canceled" ? provider : undefined;
  for (const period of periods) {
    const closedUsage = await getClosedPeriodUsage(tx, stats, new Date(period.end));
    const currentNano = decimalUsdToNanoUsd(closedUsage.costUsd);
    const accumulatorNano = decimalUsdToNanoUsd(stats.currentPeriodCost);
    const nextQuantity = BigInt(stats.currentPeriodRequestQuantity) - BigInt(closedUsage.requestQuantity);
    if (currentNano > accumulatorNano || nextQuantity < 0n) {
      throw new Error("Closed-period PAYG usage exceeds its accumulator");
    }
    const billedUsd = await reconcileUsageInvoices(stripe, {
      customerId,
      stripeSubscriptionId: provider.id,
      periodEnd: new Date(period.end).toISOString(),
      billedUsd: stats.billedOverageThisPeriod,
      currentUsd: closedUsage.costUsd,
      deletedSubscriptionSnapshot,
    });
    const billedNano = decimalUsdToNanoUsd(billedUsd);
    if (billedNano > currentNano) throw new Error("Billed overage exceeds current usage");
    const amountCents = nanoUsdToCentsHalfUp(currentNano - billedNano);
    const billingPeriod = new Date(period.end).toISOString().slice(0, 7);
    if (amountCents > 0) {
      const covered = await createAndSettleUsageInvoice(stripe, {
        customerId,
        stripeSubscriptionId: provider.id,
        amountCents,
        description: `Market usage – ${billingPeriod}`,
        itemDescription: `Market data API usage – ${billingPeriod}`,
        metadata: {
          type: "overage_billing",
          subscriptionId: provider.id,
          billingPeriod,
          usagePeriodEnd: new Date(period.end).toISOString(),
        },
        snapshot: { fromUsd: billedUsd, throughUsd: closedUsage.costUsd, requestQuantity: closedUsage.requestQuantity },
        deletedSubscriptionSnapshot,
      });
      if (decimalUsdToNanoUsd(covered.fromUsd) !== billedNano ||
        decimalUsdToNanoUsd(covered.throughUsd) !== currentNano ||
        BigInt(covered.requestQuantity) !== BigInt(closedUsage.requestQuantity)) {
        throw new Error("Stripe cycle invoice snapshot differs from immutable closed-period usage");
      }
    }
    const advanced = await tx
      .update(subscription)
      .set({ periodStart: new Date(period.end), periodEnd: new Date(period.nextEnd) })
      .where(and(
        eq(subscription.id, local.id),
        eq(subscription.stripeSubscriptionId, provider.id),
        eq(subscription.periodEnd, new Date(period.end)),
      ))
      .returning({ id: subscription.id });
    if (advanced.length !== 1) {
      throw new Error("PAYG settlement watermark changed before it could advance");
    }
    const nextStats = {
      lastPeriodRequestQuantity: closedUsage.requestQuantity,
      lastPeriodCost: closedUsage.costUsd,
      currentPeriodRequestQuantity: nextQuantity.toString(),
      currentPeriodCost: nanoUsdToDecimalUsd(accumulatorNano - currentNano),
      billedOverageThisPeriod: "0",
      updatedAt: new Date(),
    };
    await tx.update(userStats).set(nextStats).where(eq(userStats.id, stats.id));
    stats = { ...stats, ...nextStats };
    periodEnd = new Date(period.nextEnd);
  }
  return { stats, periodEnd };
}

interface SettlementPeriod {
  end: number;
  nextEnd: number;
}

async function settlementPeriods(
  stripe: Stripe,
  local: typeof subscription.$inferSelect,
  provider: Stripe.Subscription,
  customerId: string,
  eventInvoice?: Stripe.Invoice,
): Promise<SettlementPeriod[]> {
  const storedStart = requireStoredPeriodBoundary(local.periodStart, "start");
  const storedEnd = requireStoredPeriodBoundary(local.periodEnd, "end");
  if (storedEnd <= storedStart) {
    throw new Error("Current PAYG subscription has an invalid stored period");
  }
  const item = provider.items.data[0];
  const providerStart = item.current_period_start * 1_000;
  const providerEnd = item.current_period_end * 1_000;
  if (!eventInvoice && providerStart === storedStart && providerEnd === storedEnd) return [];
  if (providerStart < storedEnd) {
    throw new Error("Current PAYG provider period is not the next settlement period");
  }
  if (providerStart === storedEnd) {
    if (eventInvoice && eventInvoice.period_end * 1_000 !== storedEnd) {
      throw new Error("PAYG cycle invoice is ahead of the stored settlement boundary");
    }
    return [{ end: storedEnd, nextEnd: providerEnd }];
  }

  // Stripe, not calendar arithmetic, establishes every missed period. Validate
  // the complete contiguous chain before creating or paying any usage invoice.
  const endsByStart = new Map<number, number>();
  const addInvoice = (invoice: Stripe.Invoice) => {
    if (invoice.billing_reason !== "subscription_cycle") return;
    const parent = invoice.parent?.subscription_details?.subscription;
    const subscriptionId = typeof parent === "string" ? parent : parent?.id;
    if (subscriptionId !== provider.id) return;
    const invoiceCustomerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
    if (invoiceCustomerId !== customerId) {
      throw new Error("Historical PAYG cycle invoice Customer does not match its binding");
    }
    const start = requireInvoicePeriodBoundary(invoice.period_start, "start");
    const end = requireInvoicePeriodBoundary(invoice.period_end, "end");
    if (end < storedEnd) return;
    if (start < storedStart || end <= start || end > providerStart) {
      throw new Error("Historical PAYG cycle invoice has a misaligned settlement period");
    }
    const previousEnd = endsByStart.get(start);
    if (previousEnd !== undefined && previousEnd !== end) {
      throw new Error("Historical PAYG cycle invoices have conflicting periods");
    }
    endsByStart.set(start, end);
  };
  if (eventInvoice) addInvoice(eventInvoice);
  for await (const invoice of stripe.invoices.list({ customer: customerId, subscription: provider.id, limit: 100 })) {
    if (invoice.status && invoice.status !== "draft") addInvoice(invoice);
  }
  if (endsByStart.get(storedStart) !== storedEnd) {
    throw new Error("Historical PAYG cycle invoices are missing the stored settlement period");
  }
  const periods: SettlementPeriod[] = [];
  let end = storedEnd;
  while (end < providerStart) {
    const nextEnd = endsByStart.get(end);
    if (!nextEnd) throw new Error("Historical PAYG cycle invoices have a settlement gap");
    periods.push({ end, nextEnd });
    end = nextEnd;
  }
  periods.push({ end, nextEnd: providerEnd });
  if (periods.length !== endsByStart.size) {
    throw new Error("Historical PAYG cycle invoices have overlapping periods");
  }
  return periods;
}

export function requireStoredPeriodBoundary(value: Date | null, boundary: "start" | "end") {
  const milliseconds = value?.getTime();
  if (!milliseconds || !Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    throw new Error(`Current PAYG subscription has an invalid stored period ${boundary}`);
  }
  return milliseconds;
}

export function requireInvoicePeriodBoundary(value: number, boundary: "start" | "end") {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Current PAYG cycle invoice has an invalid period ${boundary}`);
  }
  return value * 1_000;
}
