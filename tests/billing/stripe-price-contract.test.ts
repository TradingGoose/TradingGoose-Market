import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  price: {} as Record<string, unknown>,
  retrieve: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: class Stripe {
    prices = { retrieve: state.retrieve };
  },
}));

vi.mock("@/lib/environment", () => ({
  getMarketRuntimeConfig: () => ({
    billing: {
      stripeSecretKey: "sk_test_market",
      stripePriceId: "price_market_payg",
      stripeWebhookSecret: "whsec_market",
    },
  }),
}));

import { validateMarketStripePrice } from "../../lib/billing/stripe-client";
import { dispatchMarketStripeEvent } from "../../lib/billing/webhooks/router";

beforeEach(() => {
  state.price = validPrice();
  state.retrieve.mockReset().mockImplementation(async () => state.price);
});

describe("Market PAYG Stripe Price boundary contract", () => {
  it("accepts only the active zero-base monthly licensed quantity-one shape", async () => {
    await expect(validateMarketStripePrice()).resolves.toMatchObject({
      id: "price_market_payg",
    });

    for (const override of [
      { billing_scheme: "tiered" },
      { recurring: { interval: "month", interval_count: 1, usage_type: "metered" } },
      { unit_amount: 1 },
      { transform_quantity: { divide_by: 1000, round: "up" } },
      { product: { id: "prod_market", active: false, deleted: false } },
    ]) {
      state.price = { ...validPrice(), ...override };
      await expect(validateMarketStripePrice()).rejects.toThrow(
        "Configured Market PAYG Stripe Price is incompatible",
      );
    }
  });

  it("validates the Price at the signed webhook dispatch boundary", async () => {
    await dispatchMarketStripeEvent({ type: "market.unhandled" } as never);

    expect(state.retrieve).toHaveBeenCalledWith("price_market_payg", {
      expand: ["product"],
    });

    state.price = { ...validPrice(), unit_amount: 1 };
    await expect(
      dispatchMarketStripeEvent({ type: "market.unhandled" } as never),
    ).rejects.toThrow("Configured Market PAYG Stripe Price is incompatible");
  });
});

function validPrice() {
  return {
    id: "price_market_payg",
    active: true,
    currency: "usd",
    type: "recurring",
    billing_scheme: "per_unit",
    recurring: {
      interval: "month",
      interval_count: 1,
      usage_type: "licensed",
    },
    transform_quantity: null,
    unit_amount: 0,
    product: { id: "prod_market", active: true, deleted: false },
  };
}
