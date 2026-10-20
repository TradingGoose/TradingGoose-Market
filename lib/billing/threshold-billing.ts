import { subscription, userStats } from "@tradinggoose/db/schema";
import type { MarketTransaction } from "@tradinggoose/db";
import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";
import { createHash } from "node:crypto";
import { getMarketRuntimeConfig } from "@/lib/environment";
import { databaseNow } from "@/lib/db/clock";
import {
  decimalUsdToNanoUsd,
  nanoUsdToDecimalUsd,
  nanoUsdMeetsDecimalThreshold,
  nanoUsdToCentsHalfUp,
} from "./money";
import { requireEnabledStripeClient } from "./stripe-client";

type BillingTransaction = MarketTransaction;

export interface UsageInvoiceSnapshot {
  fromUsd: string;
  throughUsd: string;
  requestQuantity: string;
}

const usageInvoiceTypes = ["overage_threshold_billing", "overage_billing", "final_overage_billing"];

/** The existing Stripe invoice owns the frozen inputs for its retries. */
export async function listUsageInvoices(
  stripe: Stripe,
  input: {
    customerId: string;
    stripeSubscriptionId: string;
    periodEnd: string;
    types: readonly string[];
  },
) {
  const matches: Stripe.Invoice[] = [];
  // Use the list endpoint, not Stripe Search's eventually consistent index.
  for await (const invoice of stripe.invoices.list({ customer: input.customerId, limit: 100 })) {
    const metadata = invoice.metadata;
    if (
      metadata && input.types.includes(metadata.type) &&
      metadata.subscriptionId === input.stripeSubscriptionId &&
      metadata.usagePeriodEnd === input.periodEnd
    ) {
      const customerId = typeof invoice.customer === "string"
        ? invoice.customer : invoice.customer?.id;
      if (customerId !== input.customerId) throw new Error("Stripe usage invoice Customer changed");
      matches.push(invoice);
    }
  }
  return matches;
}

export function usageInvoiceSnapshot(invoice: Stripe.Invoice): UsageInvoiceSnapshot {
  const metadata = invoice.metadata;
  const fromUsd = metadata?.usageFromUsd;
  const throughUsd = metadata?.usageThroughUsd;
  const requestQuantity = metadata?.usageRequestQuantity;
  if (!fromUsd || !throughUsd || !requestQuantity ||
    !/^(?:0|[1-9]\d*)$/.test(requestQuantity)) {
    throw new Error("Stripe usage invoice is missing its immutable usage snapshot");
  }
  const amount = decimalUsdToNanoUsd(throughUsd) - decimalUsdToNanoUsd(fromUsd);
  if (amount <= 0n || nanoUsdToCentsHalfUp(amount) <= 0) {
    throw new Error("Stripe usage invoice has an invalid immutable usage range");
  }
  return { fromUsd, throughUsd, requestQuantity };
}

async function usagePaymentMethod(
  stripe: Stripe,
  customerId: string,
  stripeSubscriptionId: string,
  deletedSubscriptionSnapshot?: Stripe.Subscription,
) {
  if (deletedSubscriptionSnapshot && deletedSubscriptionSnapshot.status !== "canceled") {
    throw new Error("Final usage settlement requires a canceled subscription snapshot");
  }
  const providerSubscription = deletedSubscriptionSnapshot ??
    await stripe.subscriptions.retrieve(stripeSubscriptionId);
  const providerCustomerId = typeof providerSubscription.customer === "string"
    ? providerSubscription.customer : providerSubscription.customer.id;
  if (providerSubscription.id !== stripeSubscriptionId || providerCustomerId !== customerId) {
    throw new Error("Stripe usage invoice subscription binding changed");
  }
  const method = providerSubscription.default_payment_method;
  const subscriptionMethod = typeof method === "string" ? method : method?.id;
  if (subscriptionMethod) return subscriptionMethod;
  const customer = await stripe.customers.retrieve(customerId);
  if (!("deleted" in customer && customer.deleted)) {
    const candidate = customer.invoice_settings.default_payment_method;
    return typeof candidate === "string" ? candidate : candidate?.id;
  }
}

async function settleUsageInvoice(
  stripe: Stripe,
  invoice: Stripe.Invoice,
  deletedSubscriptionSnapshot?: Stripe.Subscription,
) {
  const snapshot = usageInvoiceSnapshot(invoice);
  const amountCents = nanoUsdToCentsHalfUp(
    decimalUsdToNanoUsd(snapshot.throughUsd) - decimalUsdToNanoUsd(snapshot.fromUsd),
  );
  const invoiceKey = invoice.metadata?.usageInvoiceKey;
  const itemKey = invoice.metadata?.usageItemKey;
  if (!invoiceKey || !itemKey) throw new Error("Stripe usage invoice retry keys are missing");
  let current = await stripe.invoices.retrieve(invoice.id);
  // A paid/finalized invoice must never receive another item, even if the local
  // transaction rolled back or Stripe's original response was lost.
  if (current.status === "draft") {
    const items: Stripe.InvoiceItem[] = [];
    for await (const item of stripe.invoiceItems.list({ invoice: invoice.id, limit: 100 })) {
      items.push(item);
    }
    if (items.length > 1 || (items.length === 1 && (
      items[0].amount !== amountCents || items[0].currency !== "usd" ||
      items[0].metadata?.usageInvoiceKey !== invoiceKey
    ))) {
      throw new Error("Stripe usage invoice items do not match its frozen amount");
    }
    if (items.length === 0) {
      await stripe.invoiceItems.create({
        customer: typeof invoice.customer === "string" ? invoice.customer : invoice.customer!.id,
        invoice: invoice.id,
        amount: amountCents,
        currency: "usd",
        description: invoice.metadata?.usageItemDescription,
        metadata: invoice.metadata ?? {},
      }, { idempotencyKey: itemKey });
    }
    await stripe.invoices.finalizeInvoice(current.id, {}, {
      idempotencyKey: `${invoiceKey}:finalize`,
    });
    current = await stripe.invoices.retrieve(current.id);
  }
  if (current.total !== amountCents || current.currency !== "usd") {
    throw new Error("Stripe usage invoice total does not match its frozen amount");
  }
  if (current.status === "open") {
    // Invoice identity owns payment: a fresh paid read skips this call, while an
    // open invoice can retry a newly repaired default payment method. A fixed
    // key would cache an earlier card failure indefinitely.
    const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer!.id;
    const method = await usagePaymentMethod(stripe, customerId,
      invoice.metadata!.subscriptionId, deletedSubscriptionSnapshot);
    const paid = await stripe.invoices.pay(current.id,
      method ? { payment_method: method } : {});
    if (paid.status !== "paid") throw new Error("Stripe usage invoice payment did not complete");
    current = paid;
  }
  if (current.status !== "paid") {
    throw new Error(`Stripe usage invoice did not settle: ${current.status ?? "unknown"}`);
  }
  return snapshot;
}

export async function reconcileUsageInvoices(
  stripe: Stripe,
  input: {
    customerId: string;
    stripeSubscriptionId: string;
    periodEnd: string;
    billedUsd: string;
    currentUsd: string;
    deletedSubscriptionSnapshot?: Stripe.Subscription;
  },
) {
  const invoices = await listUsageInvoices(stripe, {
    ...input,
    types: usageInvoiceTypes,
  });
  let billed = decimalUsdToNanoUsd(input.billedUsd);
  const current = decimalUsdToNanoUsd(input.currentUsd);
  const ranges = invoices.map(invoice => ({ invoice, snapshot: usageInvoiceSnapshot(invoice) }))
    .sort((a, b) => {
      const difference = decimalUsdToNanoUsd(a.snapshot.fromUsd) - decimalUsdToNanoUsd(b.snapshot.fromUsd);
      return difference < 0n ? -1 : difference > 0n ? 1 : 0;
    });
  for (const { invoice, snapshot } of ranges) {
    const from = decimalUsdToNanoUsd(snapshot.fromUsd);
    const through = decimalUsdToNanoUsd(snapshot.throughUsd);
    if (through <= billed) continue;
    if (from !== billed || through > current) {
      throw new Error("Stripe usage invoices overlap or exceed local usage");
    }
    await settleUsageInvoice(stripe, invoice, input.deletedSubscriptionSnapshot);
    billed = through;
  }
  return nanoUsdToDecimalUsd(billed);
}

export async function createAndSettleUsageInvoice(
  stripe: Stripe,
  input: {
    customerId: string;
    stripeSubscriptionId: string;
    amountCents: number;
    description: string;
    itemDescription: string;
    metadata: Record<string, string>;
    snapshot: UsageInvoiceSnapshot;
    deletedSubscriptionSnapshot?: Stripe.Subscription;
  },
) {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new RangeError("Stripe usage invoice amount must be positive integer cents");
  }
  if (nanoUsdToCentsHalfUp(decimalUsdToNanoUsd(input.snapshot.throughUsd) -
    decimalUsdToNanoUsd(input.snapshot.fromUsd)) !== input.amountCents) {
    throw new Error("Stripe usage invoice amount does not match its usage snapshot");
  }
  const defaultPaymentMethod = await usagePaymentMethod(stripe, input.customerId,
    input.stripeSubscriptionId, input.deletedSubscriptionSnapshot);

  const existing = await listUsageInvoices(stripe, {
    customerId: input.customerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    periodEnd: input.metadata.usagePeriodEnd,
    types: usageInvoiceTypes,
  });
  const matches = existing.filter(invoice =>
    decimalUsdToNanoUsd(usageInvoiceSnapshot(invoice).fromUsd) ===
      decimalUsdToNanoUsd(input.snapshot.fromUsd));
  if (matches.length > 1) throw new Error("Multiple Stripe usage invoices cover the same settlement");
  if (matches.length === 1) {
    return settleUsageInvoice(stripe, matches[0], input.deletedSubscriptionSnapshot);
  }
  const identity = createHash("sha256").update(JSON.stringify([
    input.customerId,
    input.stripeSubscriptionId,
    input.metadata.usagePeriodEnd,
    decimalUsdToNanoUsd(input.snapshot.fromUsd).toString(),
  ])).digest("hex");
  // All owners share one first-create identity while their covered start is
  // unchanged. Even an invoice still in flight therefore cannot be replaced by
  // a threshold/cycle/final caller with a changed type or amount.
  const invoiceKey = `usage-overage:${identity}:invoice`;
  const itemKey = `usage-overage:${identity}:item`;
  const metadata = {
    ...input.metadata,
    usageFromUsd: input.snapshot.fromUsd,
    usageThroughUsd: input.snapshot.throughUsd,
    usageRequestQuantity: input.snapshot.requestQuantity,
    usageInvoiceKey: invoiceKey,
    usageItemKey: itemKey,
    usageItemDescription: input.itemDescription,
  };
  const invoice = await stripe.invoices.create(
    {
      customer: input.customerId,
      collection_method: "charge_automatically",
      auto_advance: false,
      description: input.description,
      metadata,
      ...(defaultPaymentMethod
        ? { default_payment_method: defaultPaymentMethod }
        : {}),
    },
    { idempotencyKey: invoiceKey },
  );
  return settleUsageInvoice(stripe, invoice, input.deletedSubscriptionSnapshot);
}

export async function checkAndBillMarketThreshold(
  tx: BillingTransaction,
  userId: string,
) {
  const config = getMarketRuntimeConfig();
  if (!config.billing.enabled) return;
  if (!config.billing.invoiceThresholdUsd) {
    throw new Error("Enabled billing is missing its invoice threshold");
  }

  const subscriptions = await tx
    .select()
    .from(subscription)
    .where(
      and(
        eq(subscription.referenceType, "user"),
        eq(subscription.referenceId, userId),
        eq(subscription.plan, "payg"),
      ),
    )
    .for("update")
    .limit(1);
  const localSubscription = subscriptions[0];
  if (
    !localSubscription ||
    localSubscription.status !== "active" ||
    !localSubscription.stripeCustomerId ||
    !localSubscription.stripeSubscriptionId
  ) {
    throw new Error("Active PAYG binding disappeared during threshold billing");
  }

  const statsRows = await tx
    .select()
    .from(userStats)
    .where(eq(userStats.billingReferenceId, localSubscription.referenceId))
    .for("update")
    .limit(1);
  const stats = statsRows[0];
  if (!stats) throw new Error("PAYG usage accumulator is missing");

  const currentNano = decimalUsdToNanoUsd(stats.currentPeriodCost);
  if (!localSubscription.periodEnd) throw new Error("PAYG subscription period is missing");
  const stripe = requireEnabledStripeClient();
  const reconciledBilledUsd = await reconcileUsageInvoices(stripe, {
    customerId: localSubscription.stripeCustomerId,
    stripeSubscriptionId: localSubscription.stripeSubscriptionId,
    periodEnd: localSubscription.periodEnd.toISOString(),
    billedUsd: stats.billedOverageThisPeriod,
    currentUsd: stats.currentPeriodCost,
  });
  const billedNano = decimalUsdToNanoUsd(reconciledBilledUsd);
  if (billedNano > currentNano) {
    throw new Error("Billed overage exceeds current-period usage");
  }
  const unbilledNano = currentNano - billedNano;
  let settledThroughUsd = reconciledBilledUsd;
  // The cycle owner must first remove the closed period from this accumulator.
  // Reads admitted after its boundary belong to the next period.
  if ((await databaseNow(tx)).getTime() < localSubscription.periodEnd.getTime() &&
    nanoUsdMeetsDecimalThreshold(unbilledNano, config.billing.invoiceThresholdUsd)) {
    const amountCents = nanoUsdToCentsHalfUp(unbilledNano);
    if (amountCents > 0) {
      const billingPeriod = localSubscription.periodEnd.toISOString().slice(0, 7);
      const covered = await createAndSettleUsageInvoice(stripe, {
        customerId: localSubscription.stripeCustomerId,
        stripeSubscriptionId: localSubscription.stripeSubscriptionId,
        amountCents,
        description: `Market usage threshold – ${billingPeriod}`,
        itemDescription: `Market data API usage – ${billingPeriod}`,
        metadata: {
          type: "overage_threshold_billing",
          userId,
          subscriptionId: localSubscription.stripeSubscriptionId,
          billingPeriod,
          usagePeriodEnd: localSubscription.periodEnd.toISOString(),
        },
        snapshot: {
          fromUsd: reconciledBilledUsd,
          throughUsd: stats.currentPeriodCost,
          requestQuantity: stats.currentPeriodRequestQuantity,
        },
      });
      settledThroughUsd = covered.throughUsd;
    } else {
      settledThroughUsd = stats.currentPeriodCost;
    }
  }
  if (settledThroughUsd === stats.billedOverageThisPeriod) return;
  await tx
    .update(userStats)
    .set({
      billedOverageThisPeriod: settledThroughUsd,
      updatedAt: new Date(),
    })
    .where(eq(userStats.id, stats.id));
}
