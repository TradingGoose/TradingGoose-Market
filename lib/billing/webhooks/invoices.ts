import { subscription, userStats } from "@tradinggoose/db/schema";
import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";
import { acquireBillingSubjectLock } from "@/lib/db/locks";
import { requireDatabase } from "@/lib/db/runtime";
import { decimalUsdToNanoUsd, nanoUsdToCentsHalfUp, nanoUsdToDecimalUsd } from "../money";
import { getPaygSubscriptionByStripeId } from "../subscription";
import { createAndSettleUsageInvoice, isUsageInvoiceType, reconcileUsageInvoices } from "../threshold-billing";
import { getClosedPeriodUsage, resolveRetainedUserStatsForSubscription } from "../user-stats";
import {
  classifyUnboundMarketSubscription,
  handleMarketSubscriptionDeleted,
  providerCustomerId,
  requireExactCurrentProviderSubscription,
  requireRetainedSubscriptionCustomerBridge,
} from "./subscription";

/** Payment through Portal can outlive retries of the original deletion event. */
export async function handleMarketUsageInvoicePaid(stripe: Stripe, invoice: Stripe.Invoice) {
  if (!isUsageInvoiceType(invoice.metadata?.type)) return;
  const stripeSubscriptionId = invoice.metadata?.subscriptionId;
  if (!stripeSubscriptionId) return;
  const current = await getPaygSubscriptionByStripeId(stripeSubscriptionId);
  // Old invoices cannot project or settle a later activation. Active bindings
  // retain their existing threshold/cycle owners and active-only entitlement.
  if (!current || current.status !== "canceled") return;
  const invoiceCustomerId = typeof invoice.customer === "string"
    ? invoice.customer : invoice.customer?.id;
  if (!invoiceCustomerId || invoiceCustomerId !== current.stripeCustomerId) {
    throw new Error("Current PAYG usage invoice Customer does not match its binding");
  }
  const fresh = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  requireExactCurrentProviderSubscription(fresh, current);
  // The deletion owner rechecks the binding under its existing billing lock,
  // reconciles the frozen paid ranges, then clears it only after final settlement.
  await handleMarketSubscriptionDeleted(stripe, fresh);
}

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

    // The generic subscription period is the settlement watermark. Deliveries
    // behind it are settled; a newer event can recover the complete historical
    // chain without requiring expired deliveries to arrive in chronological order.
    if (invoicePeriodEnd < storedPeriodEnd) return;
    if (invoicePeriodEnd === storedPeriodEnd && invoicePeriodStart !== storedPeriodStart) {
      throw new Error("PAYG cycle invoice is misaligned with the stored period");
    }

    const fresh = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    requireExactCurrentProviderSubscription(fresh, local);
    const invoiceCustomerId =
      typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
    if (!invoiceCustomerId || invoiceCustomerId !== providerCustomerId(fresh)) {
      throw new Error("Current PAYG cycle invoice Customer does not match its binding");
    }
    const periods = await settlementPeriods(stripe, invoice, fresh, storedPeriodStart, storedPeriodEnd);
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
    let stats = statsRows[0];
    if (!stats || stats.usageOwnerId === "") {
      throw new Error("Retained PAYG usage accumulator is missing");
    }
    for (const period of periods) {
      const closedUsage = await getClosedPeriodUsage(tx, stats, new Date(period.end));
      const currentNano = decimalUsdToNanoUsd(closedUsage.costUsd);
      const accumulatorNano = decimalUsdToNanoUsd(stats.currentPeriodCost);
      const nextQuantity = BigInt(stats.currentPeriodRequestQuantity) - BigInt(closedUsage.requestQuantity);
      if (currentNano > accumulatorNano || nextQuantity < 0n) {
        throw new Error("Closed-period PAYG usage exceeds its accumulator");
      }
      const billedUsd = await reconcileUsageInvoices(stripe, {
        customerId: invoiceCustomerId,
        stripeSubscriptionId,
        periodEnd: new Date(period.end).toISOString(),
        billedUsd: stats.billedOverageThisPeriod,
        currentUsd: closedUsage.costUsd,
      });
      const billedNano = decimalUsdToNanoUsd(billedUsd);
      if (billedNano > currentNano) throw new Error("Billed overage exceeds current usage");
      const remainderNano = currentNano - billedNano;
      const amountCents = nanoUsdToCentsHalfUp(remainderNano);
      const billingPeriod = new Date(period.end).toISOString().slice(0, 7);
      if (amountCents > 0) {
        const covered = await createAndSettleUsageInvoice(stripe, {
          customerId: invoiceCustomerId,
          stripeSubscriptionId,
          amountCents,
          description: `Market usage – ${billingPeriod}`,
          itemDescription: `Market data API usage – ${billingPeriod}`,
          metadata: {
            type: "overage_billing",
            subscriptionId: stripeSubscriptionId,
            billingPeriod,
            usagePeriodEnd: new Date(period.end).toISOString(),
          },
          snapshot: { fromUsd: billedUsd, throughUsd: closedUsage.costUsd, requestQuantity: closedUsage.requestQuantity },
        });
        if (decimalUsdToNanoUsd(covered.fromUsd) !== billedNano ||
          decimalUsdToNanoUsd(covered.throughUsd) !== currentNano ||
          BigInt(covered.requestQuantity) !== BigInt(closedUsage.requestQuantity)) {
          throw new Error("Stripe cycle invoice snapshot differs from immutable closed-period usage");
        }
      }
      const advanced = await tx
        .update(subscription)
        .set({
          periodStart: new Date(period.end),
          periodEnd: new Date(period.nextEnd),
        })
        .where(
          and(
            eq(subscription.id, local.id),
            eq(subscription.stripeSubscriptionId, stripeSubscriptionId),
            eq(subscription.periodEnd, new Date(period.end)),
          ),
        )
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
      await tx
        .update(userStats)
        .set(nextStats)
        .where(eq(userStats.id, stats.id));
      stats = { ...stats, ...nextStats };
    }
  });
}

interface SettlementPeriod {
  end: number;
  nextEnd: number;
}

async function settlementPeriods(
  stripe: Stripe,
  eventInvoice: Stripe.Invoice,
  provider: Stripe.Subscription,
  storedStart: number,
  storedEnd: number,
): Promise<SettlementPeriod[]> {
  const item = provider.items.data[0];
  const providerStart = item.current_period_start * 1_000;
  const providerEnd = item.current_period_end * 1_000;
  if (providerStart < storedEnd) {
    throw new Error("Current PAYG provider period is not the next settlement period");
  }
  if (providerStart === storedEnd) {
    if (eventInvoice.period_end * 1_000 !== storedEnd) {
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
    const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
    if (customerId !== providerCustomerId(provider)) {
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
  addInvoice(eventInvoice);
  for await (const invoice of stripe.invoices.list({
    customer: providerCustomerId(provider), subscription: provider.id, limit: 100,
  })) {
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
