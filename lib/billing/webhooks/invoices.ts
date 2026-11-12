import { subscription, userStats } from "@tradinggoose/db/schema";
import type { MarketDatabase } from "@tradinggoose/db";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { acquireBillingSubjectLock } from "@/lib/db/locks";
import { requireDatabase } from "@/lib/db/runtime";
import { getPaygSubscriptionByStripeId } from "../subscription";
import { isUsageInvoiceType, listUsageInvoices, usageInvoiceSnapshot, usageInvoiceTypes } from "../threshold-billing";
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

/** Fresh provider truth owns both synchronous declines and signed payment events. */
export async function handleMarketUsageInvoicePayment(
  stripe: Stripe,
  invoice: Stripe.Invoice,
  database: MarketDatabase = requireDatabase(),
) {
  if (!isUsageInvoiceType(invoice.metadata?.type)) return;
  const stripeSubscriptionId = invoice.metadata?.subscriptionId;
  if (!stripeSubscriptionId) return;
  const current = await getPaygSubscriptionByStripeId(stripeSubscriptionId, database);
  // An old provider binding never changes a later activation's payment block.
  if (!current) return;
  const invoiceCustomerId = typeof invoice.customer === "string"
    ? invoice.customer : invoice.customer?.id;
  if (!invoiceCustomerId || invoiceCustomerId !== current.stripeCustomerId) {
    throw new Error("Current PAYG usage invoice Customer does not match its binding");
  }
  const canceled = await database.transaction(async tx => {
    await acquireBillingSubjectLock(tx, current.referenceId);
    const [local] = await tx.select().from(subscription)
      .where(eq(subscription.id, current.id)).for("update").limit(1);
    if (!local || local.stripeSubscriptionId !== invoice.metadata?.subscriptionId) return;
    // Delivery order is not payment truth. In particular a delayed failure
    // must not reinstate a block after Portal payment has already succeeded.
    const fresh = await stripe.invoices.retrieve(invoice.id);
    const customerId = typeof fresh.customer === "string" ? fresh.customer : fresh.customer?.id;
    if (fresh.id !== invoice.id || customerId !== local.stripeCustomerId ||
      fresh.metadata?.subscriptionId !== local.stripeSubscriptionId ||
      !isUsageInvoiceType(fresh.metadata?.type)) {
      throw new Error("Current PAYG usage invoice does not match its billing binding");
    }
    usageInvoiceSnapshot(fresh);
    await requireRetainedSubscriptionCustomerBridge(tx, local, customerId);
    // Portal payment can outlive retries of the original deletion event. The
    // existing final-settlement owner rechecks and clears that retained binding.
    if (fresh.status === "paid" && local.status === "canceled") {
      return stripe.subscriptions.retrieve(stripeSubscriptionId);
    }
    let blocked = fresh.status !== "paid";
    if (!blocked) {
      // Paying one invoice cannot forgive another failed (or in-flight) usage
      // settlement. Only this current subscription's complete paid inventory
      // can clear Studio's existing account-level payment block.
      const invoices = await listUsageInvoices(stripe, {
        customerId: customerId!,
        stripeSubscriptionId: local.stripeSubscriptionId!,
        types: usageInvoiceTypes,
      });
      blocked = invoices.some(candidate => candidate.status !== "paid");
    }
    const stats = await resolveRetainedUserStatsForSubscription(local, tx);
    await tx.update(userStats).set({ billingBlocked: blocked, updatedAt: new Date() })
      .where(eq(userStats.id, stats.id));
  });
  if (canceled) await handleMarketSubscriptionDeleted(stripe, canceled);
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
