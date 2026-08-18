import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  activateMarketPayg,
  isExactMarketSubscription,
  PaygActivationError,
} from "../../lib/billing/activation";
import {
  getPaygActivationAttemptId,
  isPaygActive,
  normalizeSubscriptionMetadata,
  withoutPaygActivationAttemptId,
  withPaygActivationAttemptId,
} from "../../lib/billing/subscription";
import { clearMarketRuntimeConfigCacheForTests } from "../../lib/environment";

const managedEnvironmentNames = [
  "NODE_ENV",
  "DATABASE_URL",
  "NEXT_PUBLIC_APP_URL",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "RESEND_AUDIENCE_ID",
  "REGISTRATION_MODE",
  "BILLING_ENABLED",
  "PAYG_USD_PER_1000_READS",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "PAYG_STRIPE_PRICE_ID",
  "PAYG_INVOICE_THRESHOLD_USD",
  "UNKEY_API_ID",
  "UNKEY_KEY_MANAGEMENT_ROOT_KEY",
  "UNKEY_KEY_VERIFY_ROOT_KEY",
] as const;

const originalEnvironment = new Map(
  managedEnvironmentNames.map((name) => [name, process.env[name]]),
);

beforeEach(() => {
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: "postgres://market:market@localhost:5432/market_test",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    BETTER_AUTH_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "auth-secret",
    RESEND_API_KEY: "re_test",
    RESEND_FROM_EMAIL: "TradingGoose Market <market@example.com>",
    REGISTRATION_MODE: "open",
    BILLING_ENABLED: "false",
    PAYG_USD_PER_1000_READS: "1",
    UNKEY_API_ID: "api_market",
    UNKEY_KEY_MANAGEMENT_ROOT_KEY: "management-key",
    UNKEY_KEY_VERIFY_ROOT_KEY: "verify-key",
  });
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.PAYG_STRIPE_PRICE_ID;
  delete process.env.PAYG_INVOICE_THRESHOLD_USD;
  clearMarketRuntimeConfigCacheForTests();
});

afterEach(() => {
  for (const name of managedEnvironmentNames) {
    const original = originalEnvironment.get(name);
    if (original === undefined) Reflect.deleteProperty(process.env, name);
    else Reflect.set(process.env, name, original);
  }
  clearMarketRuntimeConfigCacheForTests();
});

describe("PAYG activation contract", () => {
  it("short-circuits disabled billing before database or provider work", async () => {
    await expect(activateMarketPayg("user_1")).rejects.toMatchObject({
      name: "PaygActivationError",
      status: 409,
      code: "BILLING_DISABLED",
      message: "Billing is disabled",
    } satisfies Partial<PaygActivationError>);
  });

  it("accepts only the exact Customer, item, Price, quantity, and ownership metadata", () => {
    const expected = {
      customerId: "cus_market",
      localSubscriptionId: "sub_default_user_1",
      priceId: "price_market_payg",
      userId: "user_1",
    };
    const exact = subscriptionCandidate();

    expect(isExactMarketSubscription(exact, expected)).toBe(true);
    expect(
      isExactMarketSubscription(
        subscriptionCandidate({
          customer: { id: "cus_market" } as Stripe.Customer,
        }),
        expected,
      ),
    ).toBe(true);

    const mismatches = [
      subscriptionCandidate({ customer: "cus_other" }),
      subscriptionCandidate({ priceId: "price_other" }),
      subscriptionCandidate({ omitQuantity: true }),
      subscriptionCandidate({ quantity: 2 }),
      subscriptionCandidate({ userId: "user_other" }),
      subscriptionCandidate({ localSubscriptionId: "sub_other" }),
      subscriptionCandidate({ referenceId: "user_other" }),
      subscriptionCandidate({ extraItem: true }),
      subscriptionCandidate({ noItems: true }),
    ];

    for (const candidate of mismatches) {
      expect(isExactMarketSubscription(candidate, expected)).toBe(false);
    }
  });

  it("preserves unrelated generic metadata while owning only the activation-attempt key", () => {
    const original = { retained: "value", nested: { safe: true } };
    const withAttempt = withPaygActivationAttemptId(original, "attempt_1");

    expect(withAttempt).toEqual({
      retained: "value",
      nested: { safe: true },
      paygActivationAttemptId: "attempt_1",
    });
    expect(getPaygActivationAttemptId(withAttempt)).toBe("attempt_1");
    expect(withoutPaygActivationAttemptId(withAttempt)).toEqual(original);
    expect(
      withoutPaygActivationAttemptId({ paygActivationAttemptId: "attempt_1" }),
    ).toBeNull();
    expect(getPaygActivationAttemptId({ paygActivationAttemptId: "" })).toBeNull();
    expect(normalizeSubscriptionMetadata(["not", "metadata"])).toEqual({});
  });

  it("treats only the literal active status as entitled", () => {
    expect(isPaygActive("active")).toBe(true);
    for (const status of [null, undefined, "trialing", "past_due", "canceled"]) {
      expect(isPaygActive(status)).toBe(false);
    }
  });
});

function subscriptionCandidate(
  overrides: {
    customer?: string | Stripe.Customer;
    priceId?: string;
    quantity?: number;
    userId?: string;
    localSubscriptionId?: string;
    referenceId?: string;
    extraItem?: boolean;
    noItems?: boolean;
    omitQuantity?: boolean;
  } = {},
): Stripe.Subscription {
  const item = {
    price: { id: overrides.priceId ?? "price_market_payg" },
    ...(overrides.omitQuantity
      ? {}
      : { quantity: overrides.quantity ?? 1 }),
  };
  const items = overrides.noItems
    ? []
    : overrides.extraItem
      ? [item, { price: { id: "price_market_payg" }, quantity: 1 }]
      : [item];

  return {
    id: "sub_provider",
    customer: overrides.customer ?? "cus_market",
    metadata: {
      userId: overrides.userId ?? "user_1",
      subscriptionId:
        overrides.localSubscriptionId ?? "sub_default_user_1",
      referenceId: overrides.referenceId ?? "user_1",
    },
    items: { data: items },
  } as unknown as Stripe.Subscription;
}
