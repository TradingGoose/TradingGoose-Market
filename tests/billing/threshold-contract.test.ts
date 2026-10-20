import type { MarketTransaction } from "@tradinggoose/db";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usageStripeFixture } from "./stripe-usage-fixture";

const state = vi.hoisted(() => ({
  enabled: true,
  threshold: "1",
  stripe: null as unknown as Stripe,
  now: new Date("2026-08-15T00:00:00.000Z"),
}));

vi.mock("@/lib/db/clock", () => ({ databaseNow: async () => state.now }));

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
  state.now = new Date("2026-08-15T00:00:00.000Z");
});

describe("Studio-parity PAYG threshold settlement", () => {
  it("nearest-cent settles the exact unbilled amount and advances the literal accumulator", async () => {
    const stripe = usageStripeFixture();
    state.stripe = stripe.client;
    const transaction = transactionFixture({
      currentPeriodCost: "1.005",
      billedOverageThisPeriod: "0",
    });

    await checkAndBillMarketThreshold(transaction.client, "user_1");

    expect(stripe.invoiceItemsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 101, currency: "usd" }),
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(/^usage-overage:[a-f0-9]{64}:item$/),
      }),
    );
    expect(stripe.invoiceCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_1", auto_advance: false }),
      expect.objectContaining({
        idempotencyKey: stripe.invoiceItemsCreate.mock.calls[0][1].idempotencyKey!.replace(/:item$/, ":invoice"),
      }),
    );
    expect(stripe.finalizeInvoice).toHaveBeenCalledWith(
      "in_1",
      {},
      expect.objectContaining({ idempotencyKey: expect.stringContaining(":finalize") }),
    );
    expect(stripe.payInvoice).toHaveBeenCalledWith("in_1", { payment_method: "pm_subscription" });
    expect(transaction.updates).toEqual([
      expect.objectContaining({ billedOverageThisPeriod: "1.005" }),
    ]);
  });

  it("does nothing below threshold and waives a threshold-reaching sub-cent amount", async () => {
    const stripe = usageStripeFixture();
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
    const stripe = usageStripeFixture();
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
      const stripe = usageStripeFixture();
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

  it.each(["invoice", "item", "finalize", "pay"] as const)("reconciles lost %s responses after further usage without double charging", async point => {
    const stripe = usageStripeFixture();
    state.stripe = stripe.client;
    stripe.state.lostResponse = point;
    await expect(checkAndBillMarketThreshold(transactionFixture({ currentPeriodCost: "1", billedOverageThisPeriod: "0" }).client, "user_1")).rejects.toThrow(`${point} response lost`);
    // An operator may also raise the threshold before the retry; the existing
    // invoice still has to be reconciled rather than skipped below the threshold.
    state.threshold = "5";
    const retry = transactionFixture({ currentPeriodCost: "1.01", billedOverageThisPeriod: "0" });
    await checkAndBillMarketThreshold(retry.client, "user_1");
    expect(stripe.invoiceCreate).toHaveBeenCalledOnce();
    expect(stripe.invoiceItemsCreate).toHaveBeenCalledOnce();
    expect(stripe.charges).toEqual([100]);
    expect(retry.updates).toEqual([expect.objectContaining({ billedOverageThisPeriod: "1" })]);
  });

  it("recovers provider payment after a local commit rollback and leaves newer usage unbilled", async () => {
    const stripe = usageStripeFixture();
    state.stripe = stripe.client;
    const failedCommit = transactionFixture({ currentPeriodCost: "1", billedOverageThisPeriod: "0" });
    await checkAndBillMarketThreshold(failedCommit.client, "user_1");
    // Reconstruct the unchanged database state after the enclosing commit fails.
    const retry = transactionFixture({ currentPeriodCost: "1.01", billedOverageThisPeriod: "0" });
    await checkAndBillMarketThreshold(retry.client, "user_1");
    expect(stripe.charges).toEqual([100]);
    expect(retry.updates).toEqual([expect.objectContaining({ billedOverageThisPeriod: "1" })]);
  });

  it("keeps one creation key while an ambiguous invoice is not yet visible and usage changes", async () => {
    const stripe = usageStripeFixture();
    state.stripe = stripe.client;
    stripe.state.lostResponse = "invoice";
    await expect(checkAndBillMarketThreshold(transactionFixture({ currentPeriodCost: "1", billedOverageThisPeriod: "0" }).client, "user_1")).rejects.toThrow("invoice response lost");
    stripe.hiddenInvoiceIds.add("in_1");
    const retry = transactionFixture({ currentPeriodCost: "1.01", billedOverageThisPeriod: "0" });
    await expect(checkAndBillMarketThreshold(retry.client, "user_1")).rejects.toThrow("idempotency parameter mismatch");
    expect(stripe.invoiceCreate.mock.calls[0][1].idempotencyKey)
      .toBe(stripe.invoiceCreate.mock.calls[1][1].idempotencyKey);
    expect(stripe.invoices.size).toBe(1);
    expect(retry.updates).toEqual([]);
    stripe.hiddenInvoiceIds.clear();
    const recovered = transactionFixture({ currentPeriodCost: "1.01", billedOverageThisPeriod: "0" });
    await checkAndBillMarketThreshold(recovered.client, "user_1");
    expect(stripe.charges).toEqual([100]);
    expect(recovered.updates).toEqual([expect.objectContaining({ billedOverageThisPeriod: "1" })]);
  });

  it("defers new threshold invoices once the database period has ended", async () => {
    const stripe = usageStripeFixture();
    state.stripe = stripe.client;
    state.now = new Date("2026-08-31T00:00:00.000Z");
    const transaction = transactionFixture({ currentPeriodCost: "2", billedOverageThisPeriod: "0" });
    await checkAndBillMarketThreshold(transaction.client, "user_1");
    expect(stripe.invoiceCreate).not.toHaveBeenCalled();
    expect(transaction.updates).toEqual([]);
  });
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
    currentPeriodRequestQuantity: "1000",
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
