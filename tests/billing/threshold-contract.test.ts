import type { MarketTransaction } from "@tradinggoose/db";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  enabled: true,
  threshold: "1",
  stripe: null as unknown as Stripe,
}));

vi.mock("@/lib/environment", () => ({
  getMarketRuntimeConfig: () => ({
    billing: {
      enabled: state.enabled,
      invoiceThresholdUsd: state.threshold,
    },
  }),
}));

vi.mock("@/lib/billing/stripe-client", () => ({
  requireEnabledStripeClient: () => state.stripe,
}));

import { checkAndBillMarketThreshold } from "../../lib/billing/threshold-billing";

beforeEach(() => {
  state.enabled = true;
  state.threshold = "1";
});

describe("Studio-parity PAYG threshold settlement", () => {
  it("nearest-cent settles the exact unbilled amount and advances the literal accumulator", async () => {
    const stripe = stripeFixture();
    state.stripe = stripe.client;
    const transaction = transactionFixture({
      currentPeriodCost: "1.005",
      billedOverageThisPeriod: "0",
    });

    await checkAndBillMarketThreshold(transaction.client, "user_1");

    expect(stripe.invoiceItemsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 101, currency: "usd" }),
      expect.objectContaining({
        idempotencyKey:
          "threshold-overage:user:user_1:cus_1:sub_provider:2026-08:101:101",
      }),
    );
    expect(stripe.invoiceCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_1", auto_advance: false }),
      expect.objectContaining({
        idempotencyKey:
          "threshold-overage:user:user_1:cus_1:sub_provider:2026-08:101:101-invoice",
      }),
    );
    expect(stripe.finalizeInvoice).toHaveBeenCalledWith(
      "in_draft",
      {},
      expect.objectContaining({ idempotencyKey: expect.stringContaining(":finalize") }),
    );
    expect(stripe.payInvoice).toHaveBeenCalledWith(
      "in_draft",
      { payment_method: "pm_subscription" },
      expect.objectContaining({ idempotencyKey: expect.stringContaining(":pay") }),
    );
    expect(transaction.updates).toEqual([
      expect.objectContaining({ billedOverageThisPeriod: "1.005" }),
    ]);
  });

  it("does nothing below threshold and waives a threshold-reaching sub-cent amount", async () => {
    const stripe = stripeFixture();
    state.stripe = stripe.client;
    const below = transactionFixture({
      currentPeriodCost: "0.0009",
      billedOverageThisPeriod: "0",
    });
    state.threshold = "0.001";
    await checkAndBillMarketThreshold(below.client, "user_1");
    expect(stripe.invoiceCreate).not.toHaveBeenCalled();
    expect(below.updates).toEqual([]);

    const waiver = transactionFixture({
      currentPeriodCost: "0.001",
      billedOverageThisPeriod: "0",
    });
    await checkAndBillMarketThreshold(waiver.client, "user_1");
    expect(stripe.invoiceCreate).not.toHaveBeenCalled();
    expect(waiver.updates).toEqual([
      expect.objectContaining({ billedOverageThisPeriod: "0.001" }),
    ]);
  });

  it("performs no database or Stripe work while billing is disabled", async () => {
    state.enabled = false;
    const stripe = stripeFixture();
    state.stripe = stripe.client;
    const transaction = transactionFixture({
      currentPeriodCost: "100",
      billedOverageThisPeriod: "0",
    });

    await checkAndBillMarketThreshold(transaction.client, "user_1");

    expect(transaction.selectCount()).toBe(0);
    expect(transaction.updates).toEqual([]);
    expect(stripe.invoiceCreate).not.toHaveBeenCalled();
  });

  it.each([
    "subscription",
    "invoice",
    "item",
    "finalize",
    "pay",
  ] as const)(
    "keeps the threshold accumulator retryable after a %s failure",
    async (failurePoint) => {
      const stripe = stripeFixture();
      state.stripe = stripe.client;
      const failure = new Error(`${failurePoint} unavailable`);
      const failingOperation = {
        subscription: stripe.subscriptionRetrieve,
        invoice: stripe.invoiceCreate,
        item: stripe.invoiceItemsCreate,
        finalize: stripe.finalizeInvoice,
        pay: stripe.payInvoice,
      }[failurePoint];
      failingOperation.mockRejectedValueOnce(failure);
      const failedAttempt = transactionFixture({
        currentPeriodCost: "1.25",
        billedOverageThisPeriod: "0.25",
      });

      await expect(
        checkAndBillMarketThreshold(failedAttempt.client, "user_1"),
      ).rejects.toBe(failure);
      expect(failedAttempt.updates).toEqual([]);

      const retry = transactionFixture({
        currentPeriodCost: "1.25",
        billedOverageThisPeriod: "0.25",
      });
      await expect(
        checkAndBillMarketThreshold(retry.client, "user_1"),
      ).resolves.toBeUndefined();
      expect(retry.updates).toEqual([
        expect.objectContaining({ billedOverageThisPeriod: "1.25" }),
      ]);
    },
  );
});

function transactionFixture(costs: {
  currentPeriodCost: string;
  billedOverageThisPeriod: string;
}) {
  let selects = 0;
  const updates: Array<Record<string, unknown>> = [];
  const localSubscription = {
    id: "sub_default_user_1",
    referenceType: "user",
    referenceId: "user_1",
    plan: "payg",
    status: "active",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_provider",
    periodEnd: new Date("2026-08-31T00:00:00.000Z"),
  };
  const stats = {
    id: "stats_1",
    currentPeriodCost: costs.currentPeriodCost,
    billedOverageThisPeriod: costs.billedOverageThisPeriod,
  };
  const client = {
    select: () => {
      selects += 1;
      const rows = selects === 1 ? [localSubscription] : [stats];
      return {
        from: () => ({
          where: () => ({
            for: () => ({ limit: async () => rows }),
          }),
        }),
      };
    },
    update: () => ({
      set: (value: Record<string, unknown>) => ({
        where: async () => {
          updates.push(value);
        },
      }),
    }),
  } as unknown as MarketTransaction;
  return { client, updates, selectCount: () => selects };
}

function stripeFixture() {
  const subscriptionRetrieve = vi.fn(async () => ({
    id: "sub_provider",
    customer: "cus_1",
    default_payment_method: "pm_subscription",
  }));
  const invoiceCreate = vi.fn(async () => ({ id: "in_draft", status: "draft" }));
  const invoiceItemsCreate = vi.fn(async () => ({ id: "ii_1" }));
  let finalized = false;
  const invoiceRetrieve = vi.fn(async () => ({
    id: "in_draft",
    status: finalized ? "open" : "draft",
  }));
  const finalizeInvoice = vi.fn(async () => {
    finalized = true;
    return { id: "in_draft", status: "open" };
  });
  const payInvoice = vi.fn(async () => ({ id: "in_draft", status: "paid" }));
  const client = {
    subscriptions: {
      retrieve: subscriptionRetrieve,
    },
    customers: {
      retrieve: vi.fn(async () => ({
        id: "cus_1",
        invoice_settings: { default_payment_method: null },
      })),
    },
    invoices: {
      create: invoiceCreate,
      retrieve: invoiceRetrieve,
      finalizeInvoice,
      pay: payInvoice,
    },
    invoiceItems: { create: invoiceItemsCreate },
  } as unknown as Stripe;
  return {
    client,
    subscriptionRetrieve,
    invoiceCreate,
    invoiceItemsCreate,
    finalizeInvoice,
    payInvoice,
  };
}
