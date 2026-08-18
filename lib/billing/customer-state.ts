import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  schema,
  type MarketDatabase
} from "@tradinggoose/db";
import { withBillingSubjectLock } from "@/lib/db/locks";
import { requireDatabase } from "@/lib/db/runtime";
import type Stripe from "stripe";
import { getOptionalStripeClient } from "@/lib/billing/stripe-client";

export type MarketCustomerState = {
  usageOwner: typeof schema.marketUsageOwner.$inferSelect;
  userStats: typeof schema.userStats.$inferSelect;
  subscription: typeof schema.subscription.$inferSelect;
};

export async function ensureMarketCustomerState(
  userId: string,
  database: MarketDatabase = requireDatabase()
): Promise<MarketCustomerState> {
  if (!userId || !userId.trim()) {
    throw new Error("Market customer user ID must not be empty.");
  }

  return withBillingSubjectLock(
    userId,
    async (transaction) => {
      const [customer] = await transaction
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.id, userId))
        .limit(1)
        .for("update");
      if (!customer) {
        throw new Error("Market customer does not exist.");
      }

      await transaction
        .insert(schema.marketUsageOwner)
        .values({ userId })
        .onConflictDoNothing({ target: schema.marketUsageOwner.userId });

      const [usageOwner] = await transaction
        .select()
        .from(schema.marketUsageOwner)
        .where(eq(schema.marketUsageOwner.userId, userId))
        .limit(1);
      if (!usageOwner || usageOwner.userId !== userId) {
        throw new Error("Market customer usage-owner initialization failed.");
      }

      await transaction
        .insert(schema.userStats)
        .values({
          userId,
          usageOwnerId: usageOwner.id,
          billingReferenceId: userId
        })
        .onConflictDoNothing({ target: schema.userStats.userId });

      const [stats] = await transaction
        .select()
        .from(schema.userStats)
        .where(eq(schema.userStats.userId, userId))
        .limit(1);
      if (
        !stats ||
        stats.userId !== userId ||
        stats.usageOwnerId !== usageOwner.id ||
        stats.billingReferenceId !== userId
      ) {
        throw new Error("Market customer userStats identity bridge is invalid.");
      }

      const subscriptionId = `sub_default_${userId}`;
      await transaction
        .insert(schema.subscription)
        .values({
          id: subscriptionId,
          plan: "payg",
          referenceType: "user",
          referenceId: userId
        })
        .onConflictDoNothing({
          target: [
            schema.subscription.referenceType,
            schema.subscription.referenceId,
            schema.subscription.plan
          ]
        });

      const [personalSubscription] = await transaction
        .select()
        .from(schema.subscription)
        .where(
          and(
            eq(schema.subscription.referenceType, "user"),
            eq(schema.subscription.referenceId, userId),
            eq(schema.subscription.plan, "payg")
          )
        )
        .limit(1);
      if (
        !personalSubscription ||
        personalSubscription.id !== subscriptionId ||
        personalSubscription.referenceId !== stats.billingReferenceId
      ) {
        throw new Error("Market customer default PAYG subscription bridge is invalid.");
      }

      return {
        usageOwner,
        userStats: stats,
        subscription: personalSubscription
      };
    },
    database
  );
}

export class StripeCustomerSettlementPendingError extends Error {
  override readonly name = "StripeCustomerSettlementPendingError";
  constructor() {
    super("The prior Stripe Customer must be retained until subscription settlement completes.");
  }
}

export function getStripeCustomerCreateIdempotencyKey(userId: string) {
  return `auth-signup:user-customer:${createHash("sha256").update(userId).digest("hex")}`;
}

export function getStripeCustomerReplacementIdempotencyKey(
  userId: string,
  staleCustomerId: string
) {
  const digest = createHash("sha256")
    .update(`${userId}:${staleCustomerId}`)
    .digest("hex");
  return `billing-portal:user-customer-replacement:${digest}`;
}

export function getStripeCustomerDefaultPaymentMethodId(
  customer: Stripe.Customer | null | undefined
) {
  const candidate = customer?.invoice_settings?.default_payment_method;
  return typeof candidate === "string" ? candidate : candidate?.id ?? null;
}

export async function ensureStripeUserCustomer(
  userId: string,
  database: MarketDatabase = requireDatabase()
): Promise<Stripe.Customer> {
  const stripe = getOptionalStripeClient();
  if (!stripe) throw new Error("Stripe Customer provisioning is not configured.");

  return withBillingSubjectLock(
    userId,
    async (transaction) => {
      const [record] = await transaction
        .select({
          user: schema.user,
          subscription: schema.subscription,
          usageOwner: schema.marketUsageOwner,
        })
        .from(schema.user)
        .innerJoin(
          schema.marketUsageOwner,
          eq(schema.marketUsageOwner.userId, schema.user.id),
        )
        .innerJoin(
          schema.subscription,
          and(
            eq(schema.subscription.referenceType, "user"),
            eq(schema.subscription.referenceId, schema.user.id),
            eq(schema.subscription.plan, "payg")
          )
        )
        .where(eq(schema.user.id, userId))
        .limit(1)
        .for("update");
      if (!record) throw new Error("Market customer does not exist.");

      const storedCustomerId = record.user.stripeCustomerId;
      if (
        record.subscription.stripeSubscriptionId &&
        (!storedCustomerId || record.subscription.stripeCustomerId !== storedCustomerId)
      ) {
        throw new StripeCustomerSettlementPendingError();
      }

      let staleCustomerId: string | null = null;
      if (storedCustomerId) {
        try {
          const existing = await stripe.customers.retrieve(storedCustomerId);
          if (!("deleted" in existing && existing.deleted)) return existing;
          staleCustomerId = storedCustomerId;
        } catch (error) {
          if (!isMissingStripeCustomerError(error)) throw error;
          staleCustomerId = storedCustomerId;
        }
      }

      if (record.subscription.stripeSubscriptionId) {
        throw new StripeCustomerSettlementPendingError();
      }

      const customer = await stripe.customers.create(
        {
          email: record.user.email,
          name: record.user.name,
          metadata: {
            userId,
            usageOwnerId: record.usageOwner.id,
            customerType: "user",
          }
        },
        {
          idempotencyKey: staleCustomerId
            ? getStripeCustomerReplacementIdempotencyKey(userId, staleCustomerId)
            : getStripeCustomerCreateIdempotencyKey(userId)
        }
      );

      await transaction
        .update(schema.user)
        .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
        .where(eq(schema.user.id, userId));
      return customer;
    },
    database
  );
}

function isMissingStripeCustomerError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const stripeError = error as {
    code?: unknown;
    type?: unknown;
    statusCode?: unknown;
    param?: unknown;
    message?: unknown;
  };
  return (
    stripeError.code === "resource_missing" ||
    (stripeError.type === "StripeInvalidRequestError" &&
      stripeError.statusCode === 404 &&
      stripeError.param === "customer" &&
      /no such customer/i.test(String(stripeError.message ?? "")))
  );
}
