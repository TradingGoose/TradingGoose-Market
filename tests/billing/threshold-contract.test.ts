import type { MarketTransaction } from "@tradinggoose/db";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usageStripeFixture } from "./stripe-usage-fixture";
import { nanoUsdToDecimalUsd } from "../../lib/billing/money";

const state = vi.hoisted(() => ({
  enabled: true,
  threshold: "1",
  stripe: null as unknown as Stripe,
  stripeClient: vi.fn(),
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
  requireEnabledStripeClient: () => {
    state.stripeClient();
    return state.stripe;
  },
}));

import { checkAndBillMarketThreshold } from "../../lib/billing/threshold-billing";

beforeEach(() => {
  state.enabled = true;
  state.threshold = "1";
  state.now = new Date("2026-08-15T00:00:00.000Z");
  state.stripeClient.mockReset();
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

  it("keeps threshold-reaching sub-cent balances pending without provider work", async () => {
    const stripe = usageStripeFixture();
    state.stripe = stripe.client;
    const below = transactionFixture({
      currentPeriodCost: "0.0009",
      billedOverageThisPeriod: "0",
    });
    state.threshold = "0.001";
    await checkAndBillMarketThreshold(below.client, "user_1");
    expect(state.stripeClient).not.toHaveBeenCalled();
    expect(stripe.invoiceList).not.toHaveBeenCalled();
    expect(stripe.invoiceCreate).not.toHaveBeenCalled();
    expect(below.updates).toEqual([]);

    for (const currentPeriodCost of ["0.001", "0.004", "0.005", "0.009999999"]) {
      const pending = transactionFixture({ currentPeriodCost, billedOverageThisPeriod: "0" });
      await checkAndBillMarketThreshold(pending.client, "user_1");
      expect(pending.updates).toEqual([]);
    }
    expect(state.stripeClient).not.toHaveBeenCalled();
    expect(stripe.invoiceList).not.toHaveBeenCalled();
    expect(stripe.invoiceCreate).not.toHaveBeenCalled();
  });

  it("collects exactly one dollar for a thousand milli-dollar reads with a sub-cent threshold", async () => {
    const stripe = usageStripeFixture();
    state.stripe = stripe.client;
    state.threshold = "0.001";
    let billedOverageThisPeriod = "0";
    for (let quantity = 1; quantity <= 1000; quantity += 1) {
      const currentPeriodCost = nanoUsdToDecimalUsd(BigInt(quantity) * 1_000_000n);
      const transaction = transactionFixture({ currentPeriodCost, billedOverageThisPeriod });
      await checkAndBillMarketThreshold(transaction.client, "user_1");
      if (quantity % 10 === 0) {
        expect(transaction.updates).toEqual([
          expect.objectContaining({ billedOverageThisPeriod: currentPeriodCost }),
        ]);
        billedOverageThisPeriod = String(transaction.updates[0].billedOverageThisPeriod);
      } else {
        expect(transaction.updates).toEqual([]);
      }
    }
    expect(billedOverageThisPeriod).toBe("1");
    expect(stripe.charges).toHaveLength(100);
    expect(stripe.charges.every(amount => amount === 1)).toBe(true);
    expect(stripe.charges.reduce((sum, cents) => sum + cents, 0)).toBe(100);
  });

  it("retains a new sub-cent remainder after reconciling a paid invoice", async () => {
    const stripe = usageStripeFixture();
    state.stripe = stripe.client;
    state.threshold = "0.001";
    stripe.state.lostResponse = "pay";
    await expect(checkAndBillMarketThreshold(transactionFixture({
      currentPeriodCost: "0.01", billedOverageThisPeriod: "0",
    }).client, "user_1")).rejects.toThrow("pay response lost");

    const retry = transactionFixture({ currentPeriodCost: "0.015", billedOverageThisPeriod: "0" });
    await checkAndBillMarketThreshold(retry.client, "user_1");
    expect(stripe.charges).toEqual([1]);
    expect(stripe.invoiceCreate).toHaveBeenCalledOnce();
    expect(retry.updates).toEqual([
      expect.objectContaining({ billedOverageThisPeriod: "0.01" }),
    ]);
  });

  it("keeps repeated below-threshold reads local even when Stripe is unavailable", async () => {
    const stripe = usageStripeFixture();
    state.stripe = stripe.client;
    state.stripeClient.mockImplementation(() => {
      throw new Error("Stripe is unavailable");
    });
    // Total accrued cost is above the threshold, but the unsettled remainder
    // after the existing billed coverage is not.
    for (const currentPeriodCost of ["1.1", "1.2", "1.9"]) {
      const transaction = transactionFixture({ currentPeriodCost, billedOverageThisPeriod: "1" });
      await checkAndBillMarketThreshold(transaction.client, "user_1");
      expect(transaction.updates).toEqual([]);
    }
    expect(state.stripeClient).not.toHaveBeenCalled();
    expect(stripe.invoiceList).not.toHaveBeenCalled();
  });

  it("rejects invalid billed coverage locally before any provider call", async () => {
    const stripe = usageStripeFixture();
    state.stripe = stripe.client;
    const transaction = transactionFixture({ currentPeriodCost: "0.5", billedOverageThisPeriod: "1" });
    await expect(checkAndBillMarketThreshold(transaction.client, "user_1"))
      .rejects.toThrow("Billed overage exceeds current-period usage");
    expect(state.stripeClient).not.toHaveBeenCalled();
    expect(transaction.updates).toEqual([]);
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
    const retry = transactionFixture({ currentPeriodCost: "1.01", billedOverageThisPeriod: "0" });
    await checkAndBillMarketThreshold(retry.client, "user_1");
    expect(stripe.invoiceCreate).toHaveBeenCalledOnce();
    expect(stripe.invoiceItemsCreate).toHaveBeenCalledOnce();
    expect(stripe.charges).toEqual([100]);
    expect(retry.updates).toEqual([expect.objectContaining({ billedOverageThisPeriod: "1" })]);
  });

  it("defers recovery below a raised threshold, then recovers the original invoice when due", async () => {
    const stripe = usageStripeFixture();
    state.stripe = stripe.client;
    stripe.state.lostResponse = "pay";
    await expect(checkAndBillMarketThreshold(transactionFixture({
      currentPeriodCost: "1", billedOverageThisPeriod: "0",
    }).client, "user_1")).rejects.toThrow("pay response lost");

    state.threshold = "5";
    state.stripeClient.mockClear();
    stripe.invoiceList.mockClear();
    const below = transactionFixture({ currentPeriodCost: "1.01", billedOverageThisPeriod: "0" });
    await checkAndBillMarketThreshold(below.client, "user_1");
    expect(state.stripeClient).not.toHaveBeenCalled();
    expect(stripe.invoiceList).not.toHaveBeenCalled();
    expect(below.updates).toEqual([]);

    const due = transactionFixture({ currentPeriodCost: "5.01", billedOverageThisPeriod: "0" });
    await checkAndBillMarketThreshold(due.client, "user_1");
    expect(stripe.invoiceCreate).toHaveBeenCalledOnce();
    expect(stripe.charges).toEqual([100]);
    expect(due.updates).toEqual([expect.objectContaining({ billedOverageThisPeriod: "1" })]);
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
    expect(state.stripeClient).not.toHaveBeenCalled();
    expect(stripe.invoiceList).not.toHaveBeenCalled();
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
