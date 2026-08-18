import { subscription, userStats } from "@tradinggoose/db/schema";
import type { MarketTransaction } from "@tradinggoose/db";
import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";
import { getMarketRuntimeConfig } from "@/lib/environment";
import {
  decimalUsdToNanoUsd,
  nanoUsdMeetsDecimalThreshold,
  nanoUsdToCentsHalfUp,
} from "./money";
import { requireEnabledStripeClient } from "./stripe-client";

type BillingTransaction = MarketTransaction;

export async function createAndSettleUsageInvoice(
  stripe: Stripe,
  input: {
    customerId: string;
    stripeSubscriptionId: string;
    amountCents: number;
    itemIdempotencyKey: string;
    invoiceIdempotencyKey: string;
    description: string;
    itemDescription: string;
    metadata: Record<string, string>;
    deletedSubscriptionSnapshot?: Stripe.Subscription;
  },
) {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new RangeError("Stripe usage invoice amount must be positive integer cents");
  }
  let defaultPaymentMethod: string | undefined;
  if (
    input.deletedSubscriptionSnapshot &&
    input.deletedSubscriptionSnapshot.status !== "canceled"
  ) {
    throw new Error("Final usage settlement requires a canceled subscription snapshot");
  }
  const providerSubscription = input.deletedSubscriptionSnapshot ??
    await stripe.subscriptions.retrieve(input.stripeSubscriptionId);
  const providerCustomerId =
    typeof providerSubscription.customer === "string"
      ? providerSubscription.customer
      : providerSubscription.customer.id;
  if (
    providerSubscription.id !== input.stripeSubscriptionId ||
    providerCustomerId !== input.customerId
  ) {
    throw new Error("Stripe usage invoice subscription binding changed");
  }
  const subscriptionPaymentMethod = providerSubscription.default_payment_method;
  defaultPaymentMethod =
    typeof subscriptionPaymentMethod === "string"
      ? subscriptionPaymentMethod
      : subscriptionPaymentMethod?.id;
  if (!defaultPaymentMethod) {
    const customer = await stripe.customers.retrieve(input.customerId);
    if (!("deleted" in customer && customer.deleted)) {
      const candidate = customer.invoice_settings.default_payment_method;
      defaultPaymentMethod = typeof candidate === "string" ? candidate : candidate?.id;
    }
  }

  const invoice = await stripe.invoices.create(
    {
      customer: input.customerId,
      collection_method: "charge_automatically",
      auto_advance: false,
      description: input.description,
      metadata: input.metadata,
      ...(defaultPaymentMethod
        ? { default_payment_method: defaultPaymentMethod }
        : {}),
    },
    { idempotencyKey: input.invoiceIdempotencyKey },
  );
  await stripe.invoiceItems.create(
    {
      customer: input.customerId,
      invoice: invoice.id,
      amount: input.amountCents,
      currency: "usd",
      description: input.itemDescription,
      metadata: input.metadata,
    },
    { idempotencyKey: input.itemIdempotencyKey },
  );
  let current = await stripe.invoices.retrieve(invoice.id);
  if (current.status === "draft") {
    await stripe.invoices.finalizeInvoice(
      current.id,
      {},
      { idempotencyKey: `${input.invoiceIdempotencyKey}:finalize` },
    );
    current = await stripe.invoices.retrieve(current.id);
  }
  if (current.status === "open") {
    const paid = await stripe.invoices.pay(
      current.id,
      {
        ...(defaultPaymentMethod ? { payment_method: defaultPaymentMethod } : {}),
      },
      { idempotencyKey: `${input.invoiceIdempotencyKey}:pay` },
    );
    if (paid.status !== "paid") {
      throw new Error("Stripe usage invoice payment did not complete");
    }
    current = paid;
  }
  if (current.status !== "paid") {
    throw new Error(`Stripe usage invoice did not settle: ${current.status ?? "unknown"}`);
  }
  return current.id;
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
  const billedNano = decimalUsdToNanoUsd(stats.billedOverageThisPeriod);
  if (billedNano > currentNano) {
    throw new Error("Billed overage exceeds current-period usage");
  }
  const unbilledNano = currentNano - billedNano;
  if (!nanoUsdMeetsDecimalThreshold(unbilledNano, config.billing.invoiceThresholdUsd)) {
    return;
  }

  const amountCents = nanoUsdToCentsHalfUp(unbilledNano);
  if (amountCents > 0) {
    const totalOverageCents = nanoUsdToCentsHalfUp(currentNano);
    const billingPeriod = (localSubscription.periodEnd ?? new Date())
      .toISOString()
      .slice(0, 7);
    const base = `threshold-overage:user:${userId}:${localSubscription.stripeCustomerId}:${localSubscription.stripeSubscriptionId}:${billingPeriod}:${totalOverageCents}:${amountCents}`;
    const stripe = requireEnabledStripeClient();
    await createAndSettleUsageInvoice(stripe, {
      customerId: localSubscription.stripeCustomerId,
      stripeSubscriptionId: localSubscription.stripeSubscriptionId,
      amountCents,
      itemIdempotencyKey: base,
      invoiceIdempotencyKey: `${base}-invoice`,
      description: `Market usage threshold – ${billingPeriod}`,
      itemDescription: `Market data API usage – ${billingPeriod}`,
      metadata: {
        type: "overage_threshold_billing",
        userId,
        subscriptionId: localSubscription.stripeSubscriptionId,
        billingPeriod,
      },
    });
  }

  await tx
    .update(userStats)
    .set({
      billedOverageThisPeriod: stats.currentPeriodCost,
      updatedAt: new Date(),
    })
    .where(eq(userStats.id, stats.id));
}
