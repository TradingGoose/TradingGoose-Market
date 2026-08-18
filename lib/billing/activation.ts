import { subscription, user } from "@tradinggoose/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { acquireBillingSubjectLock } from "@/lib/db/locks";
import { requireDatabase } from "@/lib/db/runtime";
import { getMarketRuntimeConfig } from "@/lib/environment";
import {
  ensureMarketCustomerState,
  ensureStripeUserCustomer,
  getStripeCustomerDefaultPaymentMethodId,
} from "./customer-state";
import {
  requireEnabledStripeClient,
  validateMarketStripePrice,
} from "./stripe-client";
import {
  getPaygActivationAttemptId,
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
  const stripe = requireEnabledStripeClient();
  await validateMarketStripePrice(stripe);
  const database = requireDatabase();
  await ensureMarketCustomerState(userId);

  const activationState = await database.transaction(async (tx) => {
    await acquireBillingSubjectLock(tx, userId);
    const rows = await tx
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
    const current = rows[0];
    if (!current) throw new PaygActivationError("PAYG subscription is missing", 500);
    if (current.stripeSubscriptionId) {
      throw new PaygActivationError(
        "Manage the existing subscription through Billing",
        409,
        "SUBSCRIPTION_ALREADY_BOUND",
      );
    }
    const existingAttempt = getPaygActivationAttemptId(current.metadata);
    const attemptId = existingAttempt ?? crypto.randomUUID();
    if (!existingAttempt) {
      const initialized = await tx
        .update(subscription)
        .set({ metadata: withPaygActivationAttemptId(current.metadata, attemptId) })
        .where(
          and(
            eq(subscription.id, current.id),
            isNull(subscription.stripeSubscriptionId),
            sql`${subscription.metadata} ->> ${PAYG_ACTIVATION_ATTEMPT_METADATA_KEY} is null`,
          ),
        )
        .returning({ id: subscription.id });
      if (initialized.length !== 1) {
        throw new PaygActivationError("PAYG activation state changed", 409);
      }
    }
    return { current, attemptId };
  });

  const customer = await ensureStripeUserCustomer(userId);
  const expectedProviderShape = {
    customerId: customer.id,
    localSubscriptionId: activationState.current.id,
    priceId,
    userId,
  };
  const inventory = await inspectActiveMarketSubscriptions(
    stripe,
    expectedProviderShape,
  );
  assertUnambiguousActivationInventory(inventory);

  let providerSubscription: Stripe.Subscription;
  if (inventory.valid.length === 1) {
    providerSubscription = inventory.valid[0];
  } else {
    const paymentMethodId = getStripeCustomerDefaultPaymentMethodId(customer);
    if (!paymentMethodId) {
      const cleared = await clearActivationAttempt(
        userId,
        activationState.current.id,
        activationState.attemptId,
      );
      if (!cleared) {
        throw new PaygActivationError(
          "PAYG activation state changed while checking the payment method",
          409,
          "PAYG_ACTIVATION_RETRY_REQUIRED",
        );
      }
      throw new PaygActivationError(
        "Add a default payment method before activating PAYG",
        409,
        "PAYMENT_METHOD_REQUIRED",
      );
    }
    try {
      providerSubscription = await stripe.subscriptions.create(
        {
          customer: customer.id,
          default_payment_method: paymentMethodId,
          items: [{ price: priceId, quantity: 1 }],
          metadata: {
            userId,
            subscriptionId: activationState.current.id,
            referenceId: userId,
          },
          off_session: true,
          payment_behavior: "error_if_incomplete",
        },
        {
          idempotencyKey: `payg-activate:${activationState.current.id}:${activationState.attemptId}`,
        },
      );
    } catch (error) {
      if (isAuthoritativeActivationRejection(error)) {
        // A provider error alone is not proof that no subscription exists. The
        // attempt remains reusable unless a second complete inventory read proves
        // that the Customer has no active subscription after the rejected create.
        const rejectionInventory = await inspectActiveMarketSubscriptions(
          stripe,
          expectedProviderShape,
        );
        assertUnambiguousActivationInventory(rejectionInventory);
        if (rejectionInventory.valid.length !== 0) {
          throw new PaygActivationError(
            "PAYG activation is pending provider recovery",
            409,
            "PAYG_ACTIVATION_RETRY_REQUIRED",
          );
        }
        const cleared = await clearActivationAttempt(
          userId,
          activationState.current.id,
          activationState.attemptId,
        );
        if (!cleared) {
          throw new PaygActivationError(
            "PAYG activation state changed after provider rejection",
            409,
            "PAYG_ACTIVATION_RETRY_REQUIRED",
          );
        }
        throw new PaygActivationError(
          "The payment method could not activate PAYG. Review billing details and try again.",
          getStripeStatus(error) === 402 ? 402 : 409,
          "PAYG_PROVIDER_REJECTED",
        );
      }
      throw error;
    }
  }

  if (providerSubscription.status !== "active") {
    throw new PaygActivationError(
      "Stripe returned a PAYG activation result that requires recovery",
      409,
      "PAYG_ACTIVATION_RETRY_REQUIRED",
    );
  }
  if (!isUsableMarketSubscription(providerSubscription, expectedProviderShape)) {
    throw new PaygActivationError(
      "Stripe returned an active PAYG subscription that requires reconciliation",
      409,
      "PAYG_AMBIGUOUS",
    );
  }
  const item = providerSubscription.items.data[0];
  if (!item) throw new Error("Stripe PAYG subscription has no item");

  const persisted = await database.transaction(async (tx) => {
    await acquireBillingSubjectLock(tx, userId);
    const rows = await tx
      .select({ subscription, stripeCustomerId: user.stripeCustomerId })
      .from(subscription)
      .innerJoin(user, eq(user.id, subscription.referenceId))
      .where(eq(subscription.id, activationState.current.id))
      .for("update")
      .limit(1);
    const current = rows[0];
    if (!current) throw new Error("PAYG subscription disappeared during activation");
    if (current.subscription.stripeSubscriptionId) {
      if (current.subscription.stripeSubscriptionId === providerSubscription.id) {
        if (current.subscription.stripeCustomerId !== customer.id) {
          throw new PaygActivationError(
            "The concurrent PAYG binding has a different Customer",
            409,
          );
        }
        return current.subscription;
      }
      throw new PaygActivationError("PAYG subscription was concurrently rebound", 409);
    }
    if (
      current.stripeCustomerId !== customer.id ||
      getPaygActivationAttemptId(current.subscription.metadata) !==
        activationState.attemptId
    ) {
      throw new PaygActivationError("PAYG activation state changed", 409);
    }
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
      metadata: withoutPaygActivationAttemptId(current.subscription.metadata),
    };
    const bound = await tx
      .update(subscription)
      .set(values)
      .where(
        and(
          eq(subscription.id, current.subscription.id),
          isNull(subscription.stripeSubscriptionId),
          sql`${subscription.metadata} ->> ${PAYG_ACTIVATION_ATTEMPT_METADATA_KEY} = ${activationState.attemptId}`,
        ),
      )
      .returning();
    if (bound.length !== 1) {
      throw new PaygActivationError("PAYG activation state changed", 409);
    }
    return bound[0];
  });

  return {
    success: true,
    status: "activated",
    stripeSubscriptionId: persisted.stripeSubscriptionId,
  };
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
  const rawCustomer = candidate.customer as unknown;
  const customerId =
    typeof rawCustomer === "string"
      ? rawCustomer
      : rawCustomer &&
          typeof rawCustomer === "object" &&
          "id" in rawCustomer &&
          typeof rawCustomer.id === "string"
        ? rawCustomer.id
        : null;
  const items = Array.isArray(candidate.items?.data) ? candidate.items.data : [];
  const item = items[0];
  const metadata =
    candidate.metadata && typeof candidate.metadata === "object"
      ? candidate.metadata
      : {};
  return (
    customerId === expected.customerId &&
    items.length === 1 &&
    item?.price?.id === expected.priceId &&
    item.quantity === 1 &&
    metadata.userId === expected.userId &&
    metadata.subscriptionId === expected.localSubscriptionId &&
    metadata.referenceId === expected.userId
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

interface ActivationInventory {
  valid: Stripe.Subscription[];
  malformedActive: boolean;
}

async function inspectActiveMarketSubscriptions(
  stripe: Stripe,
  expected: Parameters<typeof isExactMarketSubscription>[1],
): Promise<ActivationInventory> {
  const validById = new Map<string, Stripe.Subscription>();
  let malformedActive = false;
  for await (const candidate of stripe.subscriptions.list({
    customer: expected.customerId,
    status: "active",
    limit: 100,
  })) {
    const fresh = await stripe.subscriptions.retrieve(candidate.id);
    if (fresh.status !== "active") continue;
    if (isUsableMarketSubscription(fresh, expected)) {
      validById.set(fresh.id, fresh);
    } else {
      malformedActive = true;
    }
  }
  return { valid: [...validById.values()], malformedActive };
}

function assertUnambiguousActivationInventory(inventory: ActivationInventory) {
  if (inventory.malformedActive || inventory.valid.length > 1) {
    throw new PaygActivationError(
      "Active PAYG subscription inventory requires operator reconciliation",
      409,
      "PAYG_AMBIGUOUS",
    );
  }
}

async function clearActivationAttempt(
  userId: string,
  subscriptionId: string,
  expectedAttemptId: string,
) {
  const database = requireDatabase();
  return database.transaction(async (tx) => {
    await acquireBillingSubjectLock(tx, userId);
    const rows = await tx
      .select()
      .from(subscription)
      .where(eq(subscription.id, subscriptionId))
      .for("update")
      .limit(1);
    const current = rows[0];
    if (
      current &&
      !current.stripeSubscriptionId &&
      getPaygActivationAttemptId(current.metadata) === expectedAttemptId
    ) {
      const cleared = await tx
        .update(subscription)
        .set({ metadata: withoutPaygActivationAttemptId(current.metadata) })
        .where(
          and(
            eq(subscription.id, subscriptionId),
            isNull(subscription.stripeSubscriptionId),
            sql`${subscription.metadata} ->> ${PAYG_ACTIVATION_ATTEMPT_METADATA_KEY} = ${expectedAttemptId}`,
          ),
        )
        .returning({ id: subscription.id });
      return cleared.length === 1;
    }
    return false;
  });
}

function isAuthoritativeActivationRejection(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { type?: unknown; statusCode?: unknown };
  return (
    value.type === "StripeCardError" ||
    (value.type === "StripeInvalidRequestError" &&
      typeof value.statusCode === "number" &&
      value.statusCode < 500)
  );
}

function getStripeStatus(error: unknown) {
  return error && typeof error === "object" && "statusCode" in error
    ? Number((error as { statusCode?: unknown }).statusCode)
    : 0;
}
