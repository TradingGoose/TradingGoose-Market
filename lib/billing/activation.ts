import { subscription, user } from "@tradinggoose/db/schema";
import type { MarketTransaction } from "@tradinggoose/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { withBillingSubjectLock } from "@/lib/db/locks";
import { databaseNow } from "@/lib/db/clock";
import { getMarketRuntimeConfig } from "@/lib/environment";
import {
  ensureMarketCustomerState,
  ensureStripeUserCustomer,
} from "./customer-state";
import {
  requireEnabledStripeClient,
  validateMarketStripePrice,
} from "./stripe-client";
import {
  getPaygActivationAttemptId,
  getPaygActivationCandidateId,
  getPaygActivationPriceId,
  getPaygActivationStartedAt,
  normalizeSubscriptionMetadata,
  PAYG_ACTIVATION_ATTEMPT_METADATA_KEY,
  withPaygActivationAttemptId,
  withoutPaygActivationAttemptId,
} from "./subscription";

export class PaygActivationError extends Error {
  override readonly name = "PaygActivationError";
  constructor(
    message: string,
    readonly status = 409,
    readonly code = "PAYG_ACTIVATION_FAILED",
  ) {
    super(message);
  }
}

export async function activateMarketPayg(userId: string) {
  const config = getMarketRuntimeConfig();
  if (!config.billing.enabled) {
    throw new PaygActivationError("Billing is disabled", 409, "BILLING_DISABLED");
  }
  const priceId = config.billing.stripePriceId!;
  const state = await ensureMarketCustomerState(userId);
  assertUnbound(state.subscription, priceId);
  const stripe = requireEnabledStripeClient();
  await validateMarketStripePrice(stripe);
  await ensureStripeUserCustomer(userId);

  const prepared = await withBillingSubjectLock(userId, async (tx) => {
    const { subscription: local, stripeCustomerId } = await readActivation(tx, state.subscription.id);
    assertUnbound(local, priceId);
    const existing = getPaygActivationAttemptId(local.metadata);
    if (existing) return { attemptId: existing, candidateId: getPaygActivationCandidateId(local.metadata) };
    const customer = await liveCustomer(stripe, stripeCustomerId);
    const shape = { customerId: customer.id, localSubscriptionId: local.id, priceId, userId };
    const candidate = await inspectInventory(stripe, shape, null);
    if (!candidate && !customer.invoice_settings.default_payment_method) throw missingCard();

    const attemptId = getPaygActivationAttemptId(candidate?.metadata) ?? crypto.randomUUID();
    const candidateId = candidate?.id ?? null;
    const initialized = await tx.update(subscription).set({
      metadata: withPaygActivationAttemptId(local.metadata, attemptId, priceId, await databaseNow(tx), candidateId),
    }).where(and(
      eq(subscription.id, local.id),
      isNull(subscription.stripeSubscriptionId),
      sql`${subscription.metadata} ->> ${PAYG_ACTIVATION_ATTEMPT_METADATA_KEY} is null`,
    )).returning({ id: subscription.id });
    if (!initialized.length) throw retryRequired();
    return { attemptId, candidateId };
  });

  const execute = ({ attemptId, candidateId }: typeof prepared) => withBillingSubjectLock(userId, async (tx) => {
    const { subscription: local, stripeCustomerId } = await readActivation(tx, state.subscription.id);
    if (!stripeCustomerId) throw retryRequired();
    const expected = { customerId: stripeCustomerId, localSubscriptionId: local.id, priceId, userId };
    if (local.stripeSubscriptionId) {
      const bound = await stripe.subscriptions.retrieve(local.stripeSubscriptionId);
      if (bound.id !== local.stripeSubscriptionId || local.stripeCustomerId !== stripeCustomerId ||
        bound.status !== "active" || !isUsableMarketSubscription(bound, expected) ||
        (bound.id !== candidateId && getPaygActivationAttemptId(bound.metadata) !== attemptId)) {
        throw retryRequired();
      }
      return { subscriptionId: bound.id };
    }
    if (getPaygActivationAttemptId(local.metadata) !== attemptId ||
      getPaygActivationPriceId(local.metadata) !== priceId) throw retryRequired();

    const customer = await liveCustomer(stripe, stripeCustomerId);
    let candidate = await inspectInventory(stripe, expected, attemptId, candidateId);
    if (!candidate) {
      if (candidateId) throw retryRequired();
      // Stripe may prune an idempotency key after 24h. Use wall time after
      // lock and provider waits; now() is frozen at transaction start.
      const startedAt = getPaygActivationStartedAt(local.metadata);
      const [clock] = await tx.execute<{ replayable: boolean }>(sql`
        select clock_timestamp() < ${startedAt}::timestamptz + interval '24 hours' as replayable
      `);
      const metadata = normalizeSubscriptionMetadata(local.metadata);
      if (typeof clock?.replayable !== "boolean") throw retryRequired();
      if (!clock.replayable && metadata.paygActivationPostPossible !== false) throw retryRequired();
      if (!customer.invoice_settings.default_payment_method) throw missingCard();
      if (metadata.paygActivationPostPossible === false) {
        // Empty inventory can replace an expired generation only if no executor could have sent its POST.
        const nextId = clock.replayable ? attemptId : crypto.randomUUID();
        const nextMetadata = clock.replayable ? metadata : withPaygActivationAttemptId(
          withoutPaygActivationAttemptId(metadata), nextId, priceId, await databaseNow(tx),
        );
        await updateLockedActivationAttempt(tx, local, attemptId, { ...nextMetadata, paygActivationPostPossible: true });
        return { dispatch: { attemptId: nextId, candidateId: null } };
      }
      if (metadata.paygActivationPostPossible !== true) throw retryRequired();
      try {
        candidate = await stripe.subscriptions.create({
          customer: customer.id,
          items: [{ price: priceId, quantity: 1 }],
          metadata: { userId, subscriptionId: local.id, referenceId: userId, [PAYG_ACTIVATION_ATTEMPT_METADATA_KEY]: attemptId },
          off_session: true,
          payment_behavior: "error_if_incomplete",
        }, { idempotencyKey: `payg-activate:${local.id}:${attemptId}:${customer.id}` });
      } catch (error) {
        if (!isAuthoritativeActivationRejection(error)) throw error;
        if (await inspectInventory(stripe, expected, attemptId)) throw retryRequired();
        await updateLockedActivationAttempt(tx, local, attemptId, withoutPaygActivationAttemptId(local.metadata));
        return { error: new PaygActivationError(
          "The payment method could not activate PAYG. Review billing details and try again.",
          error.statusCode === 402 ? 402 : 409, "PAYG_PROVIDER_REJECTED",
        ) };
      }
    }

    const providerSubscription = await stripe.subscriptions.retrieve(candidate.id);
    if (providerSubscription.id !== candidate.id || !isUsableMarketSubscription(providerSubscription, expected)) {
      throw ambiguousInventory();
    }
    // Pre-cutover subscriptions missing an attempt UUID must be reconciled before deployment (README).
    const sameAttempt = getPaygActivationAttemptId(providerSubscription.metadata) === attemptId;
    if (providerSubscription.status === "canceled" && (sameAttempt || providerSubscription.id === candidateId)) {
      await updateLockedActivationAttempt(tx, local, attemptId, withoutPaygActivationAttemptId(local.metadata));
      return { error: retryRequired("The canceled PAYG activation was retired. Try activating again.") };
    }
    if (providerSubscription.status !== "active" || (!sameAttempt && providerSubscription.id !== candidateId)) {
      throw retryRequired();
    }
    const item = providerSubscription.items.data[0];
    const values = {
      stripeCustomerId: customer.id,
      stripeSubscriptionId: providerSubscription.id,
      status: providerSubscription.status,
      periodStart: new Date(item.current_period_start * 1_000),
      periodEnd: new Date(item.current_period_end * 1_000),
      cancelAtPeriodEnd: providerSubscription.cancel_at_period_end,
      seats: 1,
      trialStart: providerSubscription.trial_start
        ? new Date(providerSubscription.trial_start * 1_000)
        : null,
      trialEnd: providerSubscription.trial_end
        ? new Date(providerSubscription.trial_end * 1_000)
        : null,
      metadata: withoutPaygActivationAttemptId(local.metadata),
    };
    const bound = await tx
      .update(subscription)
      .set(values)
      .where(
        and(
          eq(subscription.id, local.id),
          isNull(subscription.stripeSubscriptionId),
          sql`${subscription.metadata} ->> ${PAYG_ACTIVATION_ATTEMPT_METADATA_KEY} = ${attemptId}`,
        ),
      )
      .returning();
    if (bound.length !== 1) {
      throw new PaygActivationError("PAYG activation state changed", 409);
    }
    return { subscriptionId: bound[0].stripeSubscriptionId };
  });
  let result = await execute(prepared);
  while (result.dispatch) result = await execute(result.dispatch);
  if (result.error) throw result.error;
  return { success: true, status: "activated", stripeSubscriptionId: result.subscriptionId };
}

function assertUnbound(local: typeof subscription.$inferSelect, priceId: string) {
  if (local.stripeSubscriptionId) {
    throw new PaygActivationError("Manage the existing subscription through Billing", 409, "SUBSCRIPTION_ALREADY_BOUND");
  }
  if (getPaygActivationAttemptId(local.metadata) && getPaygActivationPriceId(local.metadata) !== priceId) {
    throw retryRequired("The pending PAYG activation requires its original configured Price");
  }
}

async function readActivation(tx: MarketTransaction, subscriptionId: string) {
  const [local] = await tx.select({ subscription, stripeCustomerId: user.stripeCustomerId })
    .from(subscription).innerJoin(user, eq(user.id, subscription.referenceId))
    .where(eq(subscription.id, subscriptionId)).for("update").limit(1);
  if (!local) throw new PaygActivationError("PAYG subscription is missing", 500);
  return local;
}

async function liveCustomer(stripe: Stripe, customerId: string | null) {
  if (!customerId) throw retryRequired();
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted || customer.id !== customerId) throw retryRequired();
  return customer;
}

function retryRequired(message = "PAYG activation is pending provider recovery") {
  return new PaygActivationError(message, 409, "PAYG_ACTIVATION_RETRY_REQUIRED");
}

function missingCard() {
  return new PaygActivationError("Add a default payment method before activating PAYG", 409, "PAYMENT_METHOD_REQUIRED");
}

function ambiguousInventory() {
  return new PaygActivationError("PAYG subscription inventory requires operator reconciliation", 409, "PAYG_AMBIGUOUS");
}

export function isExactMarketSubscription(
  candidate: Stripe.Subscription,
  expected: {
    customerId: string;
    localSubscriptionId: string;
    priceId: string;
    userId: string;
  },
) {
  const customerId = typeof candidate.customer === "string"
    ? candidate.customer
    : candidate.customer?.id;
  const items = Array.isArray(candidate.items?.data) ? candidate.items.data : [];
  const item = items[0];
  const metadata = candidate.metadata;
  return (
    customerId === expected.customerId &&
    items.length === 1 &&
    item?.price?.id === expected.priceId &&
    item.quantity === 1 &&
    metadata?.userId === expected.userId &&
    metadata?.subscriptionId === expected.localSubscriptionId &&
    metadata?.referenceId === expected.userId
  );
}

function isUsableMarketSubscription(
  candidate: Stripe.Subscription,
  expected: Parameters<typeof isExactMarketSubscription>[1],
) {
  if (!isExactMarketSubscription(candidate, expected)) return false;
  const item = candidate.items.data[0];
  return (
    Number.isSafeInteger(item.current_period_start) &&
    item.current_period_start > 0 &&
    Number.isSafeInteger(item.current_period_end) &&
    item.current_period_end > item.current_period_start
  );
}

async function inspectInventory(
  stripe: Stripe,
  expected: Parameters<typeof isExactMarketSubscription>[1],
  attemptId: string | null,
  candidateId: string | null = null,
) {
  function unrelatedHistory(entry: Stripe.Subscription) {
    return (entry.status === "canceled" || entry.status === "incomplete_expired") &&
      entry.id !== candidateId && (!attemptId || getPaygActivationAttemptId(entry.metadata) !== attemptId);
  }
  let match: Stripe.Subscription | null = null;
  for await (const listed of stripe.subscriptions.list({ customer: expected.customerId, status: "all", limit: 100 })) {
    if (unrelatedHistory(listed)) continue;
    const fresh = await stripe.subscriptions.retrieve(listed.id);
    if (fresh.id !== listed.id) throw ambiguousInventory();
    const sameAttempt = !!attemptId && getPaygActivationAttemptId(fresh.metadata) === attemptId;
    if (unrelatedHistory(fresh)) continue;
    if (!isUsableMarketSubscription(fresh, expected) || (match && match.id !== fresh.id)) throw ambiguousInventory();
    if (attemptId && !sameAttempt && fresh.id !== candidateId) throw retryRequired();
    if (fresh.status !== "active" && fresh.status !== "canceled") throw retryRequired();
    match = fresh;
  }
  return match;
}

async function updateLockedActivationAttempt(
  tx: MarketTransaction,
  current: typeof subscription.$inferSelect,
  expectedAttemptId: string,
  metadata: Record<string, unknown> | null,
) {
  if (current.stripeSubscriptionId ||
    getPaygActivationAttemptId(current.metadata) !== expectedAttemptId) throw retryRequired();
  const changed = await tx.update(subscription)
    .set({ metadata })
    .where(and(
      eq(subscription.id, current.id),
      isNull(subscription.stripeSubscriptionId),
      sql`${subscription.metadata} ->> ${PAYG_ACTIVATION_ATTEMPT_METADATA_KEY} = ${expectedAttemptId}`,
    ))
    .returning({ id: subscription.id });
  if (changed.length !== 1) throw retryRequired();
}

function isAuthoritativeActivationRejection(
  error: unknown,
): error is { type: string; statusCode?: number } {
  if (!error || typeof error !== "object") return false;
  const value = error as { type?: unknown; statusCode?: unknown; code?: unknown };
  // A conflicting idempotent create may still be running after its owner lost
  // the connection. Empty inventory cannot prove that attempt is safe to retire.
  if (value.statusCode === 409 || value.code === "idempotency_key_in_use") return false;
  return (
    value.type === "StripeCardError" ||
    (value.type === "StripeInvalidRequestError" &&
      typeof value.statusCode === "number" &&
      value.statusCode < 500)
  );
}
