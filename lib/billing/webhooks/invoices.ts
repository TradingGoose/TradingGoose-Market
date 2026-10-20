import { subscription, userStats } from "@tradinggoose/db/schema";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { acquireBillingSubjectLock } from "@/lib/db/locks";
import { requireDatabase } from "@/lib/db/runtime";
import { getPaygSubscriptionByStripeId } from "../subscription";
import { isUsageInvoiceType } from "../threshold-billing";
import { resolveRetainedUserStatsForSubscription } from "../user-stats";
import {
  requireInvoicePeriodBoundary,
  requireStoredPeriodBoundary,
  settleClosedMarketUsagePeriods,
} from "./closed-period-settlement";
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
    await settleClosedMarketUsagePeriods(tx, stripe, local, fresh, invoiceCustomerId, stats, invoice);
  });
}
