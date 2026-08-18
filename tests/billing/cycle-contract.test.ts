import type { MarketTransaction } from "@tradinggoose/db";
import { subscription, userStats } from "@tradinggoose/db/schema";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
  locked: null as Record<string, unknown> | null,
  stats: null as Record<string, unknown> | null,
  subscriptionUpdates: [] as Array<Record<string, unknown>>,
  statsUpdates: [] as Array<Record<string, unknown>>,
  advanceRows: [{ id: "sub_default_user_1" }] as Array<{ id: string }>,
  stripeRetrieve: vi.fn(),
  classify: vi.fn(),
  exact: vi.fn(),
  retainedBridge: vi.fn(),
  liveUsers: [{ id: "user_1", stripeCustomerId: "cus_1" }] as Array<{
    id: string;
    stripeCustomerId: string | null;
  }>,
  retained: vi.fn(async () => ({ id: "stats_1" })),
  settle: vi.fn(async () => "in_1"),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db/locks", () => ({
  acquireBillingSubjectLock: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db/runtime", () => ({
  requireDatabase: () => ({ transaction: state.transaction }),
}));

vi.mock("@/lib/environment", () => ({
  getMarketRuntimeConfig: () => ({ billing: { stripePriceId: "price_market" } }),
}));

vi.mock("@/lib/billing/subscription", () => ({
  getPaygSubscriptionByStripeId: vi.fn(async () => state.current),
}));

vi.mock("@/lib/billing/threshold-billing", () => ({
  createAndSettleUsageInvoice: state.settle,
}));

vi.mock("@/lib/billing/user-stats", () => ({
  resolveRetainedUserStatsForSubscription: state.retained,
}));

vi.mock("@/lib/billing/webhooks/subscription", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../lib/billing/webhooks/subscription")
  >();
  return {
    ...original,
    classifyUnboundMarketSubscription: state.classify,
    providerCustomerId: () => "cus_1",
    requireExactCurrentProviderSubscription: state.exact,
    requireRetainedSubscriptionCustomerBridge: state.retainedBridge,
  };
});

import { handleMarketCycleInvoiceFinalized } from "../../lib/billing/webhooks/invoices";
import { handleMarketSubscriptionProjection } from "../../lib/billing/webhooks/subscription";

beforeEach(() => {
  state.current = localSubscription();
  state.locked = null;
  state.stats = usageStats();
  state.subscriptionUpdates.length = 0;
  state.statsUpdates.length = 0;
  state.advanceRows = [{ id: "sub_default_user_1" }];
  state.stripeRetrieve.mockReset().mockResolvedValue(providerSubscription());
  state.classify.mockReset();
  state.exact.mockReset();
  state.retainedBridge.mockReset();
  state.liveUsers = [{ id: "user_1", stripeCustomerId: "cus_1" }];
  state.retained.mockClear();
  state.settle.mockReset().mockResolvedValue("in_1");
  state.transaction.mockReset().mockImplementation(async (callback) =>
    callback(transactionFixture()),
  );
});

describe("PAYG cycle webhook settlement", () => {
  it("classifies provider ownership before entering a local transaction", async () => {
    state.current = null;
    await handleMarketCycleInvoiceFinalized(stripeFixture(), cycleInvoice());

    expect(state.stripeRetrieve).toHaveBeenCalledWith("sub_provider");
    expect(state.classify).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "sub_provider" }),
    );
    expect(state.transaction).not.toHaveBeenCalled();
  });

  it("treats an old or duplicate boundary as a no-op", async () => {
    state.current = localSubscription({
      periodStart: new Date("2026-08-31T00:00:00.000Z"),
      periodEnd: new Date("2026-09-30T00:00:00.000Z"),
    });

    await handleMarketCycleInvoiceFinalized(stripeFixture(), cycleInvoice());

    expect(state.stripeRetrieve).not.toHaveBeenCalled();
    expect(state.settle).not.toHaveBeenCalled();
    expect(state.subscriptionUpdates).toEqual([]);
    expect(state.statsUpdates).toEqual([]);
  });

  it("rejects a future boundary until the missing boundary settles", async () => {
    await expect(
      handleMarketCycleInvoiceFinalized(
        stripeFixture(),
        cycleInvoice({
          period_start: epoch("2026-08-31T00:00:00.000Z"),
          period_end: epoch("2026-09-30T00:00:00.000Z"),
        }),
      ),
    ).rejects.toThrow("ahead of the stored settlement boundary");

    expect(state.stripeRetrieve).not.toHaveBeenCalled();
    expect(state.settle).not.toHaveBeenCalled();
    expect(state.subscriptionUpdates).toEqual([]);
    expect(state.statsUpdates).toEqual([]);
  });

  it("rejects an invoice whose start is misaligned with the exact boundary", async () => {
    await expect(
      handleMarketCycleInvoiceFinalized(
        stripeFixture(),
        cycleInvoice({ period_start: epoch("2026-08-01T00:00:00.000Z") }),
      ),
    ).rejects.toThrow("misaligned with the stored period");

    expect(state.stripeRetrieve).not.toHaveBeenCalled();
    expect(state.settle).not.toHaveBeenCalled();
  });

  it("rejects a provider period that has not advanced to the exact next period", async () => {
    state.stripeRetrieve.mockResolvedValueOnce(
      providerSubscription({
        current_period_start: epoch("2026-07-31T00:00:00.000Z"),
        current_period_end: epoch("2026-08-31T00:00:00.000Z"),
      }),
    );

    await expect(
      handleMarketCycleInvoiceFinalized(stripeFixture(), cycleInvoice()),
    ).rejects.toThrow("not the next settlement period");

    expect(state.settle).not.toHaveBeenCalled();
    expect(state.subscriptionUpdates).toEqual([]);
    expect(state.statsUpdates).toEqual([]);
  });

  it("keeps the cycle watermark retryable when exact subscription retrieval fails", async () => {
    const unavailable = new Error("subscription retrieval unavailable");
    state.stripeRetrieve.mockRejectedValueOnce(unavailable);

    await expect(
      handleMarketCycleInvoiceFinalized(stripeFixture(), cycleInvoice()),
    ).rejects.toBe(unavailable);
    expect(state.settle).not.toHaveBeenCalled();
    expect(state.subscriptionUpdates).toEqual([]);
    expect(state.statsUpdates).toEqual([]);

    await expect(
      handleMarketCycleInvoiceFinalized(stripeFixture(), cycleInvoice()),
    ).resolves.toBeUndefined();
    expect(state.subscriptionUpdates).toHaveLength(1);
    expect(state.statsUpdates).toHaveLength(1);
  });

  it("rejects a provider period gap without consuming the accumulator", async () => {
    state.stripeRetrieve.mockResolvedValueOnce(
      providerSubscription({
        current_period_start: epoch("2026-09-30T00:00:00.000Z"),
        current_period_end: epoch("2026-10-31T00:00:00.000Z"),
      }),
    );

    await expect(
      handleMarketCycleInvoiceFinalized(stripeFixture(), cycleInvoice()),
    ).rejects.toThrow("not the next settlement period");

    expect(state.settle).not.toHaveBeenCalled();
    expect(state.subscriptionUpdates).toEqual([]);
    expect(state.statsUpdates).toEqual([]);
  });

  it("validates the binding and atomically advances a zero cycle", async () => {
    state.stats = usageStats({
      currentPeriodRequestQuantity: "0",
      currentPeriodCost: "0",
      billedOverageThisPeriod: "0",
      lastPeriodRequestQuantity: "44",
      lastPeriodCost: "2.5",
    });
    await handleMarketCycleInvoiceFinalized(stripeFixture(), cycleInvoice());

    expect(state.exact).toHaveBeenCalledOnce();
    expect(state.retainedBridge).toHaveBeenCalledOnce();
    expect(state.settle).not.toHaveBeenCalled();
    expect(state.subscriptionUpdates).toEqual([
      expect.objectContaining({
        periodStart: new Date("2026-08-31T00:00:00.000Z"),
        periodEnd: new Date("2026-09-30T00:00:00.000Z"),
      }),
    ]);
    expect(state.statsUpdates).toEqual([
      expect.objectContaining({
        lastPeriodRequestQuantity: "0",
        lastPeriodCost: "0",
        currentPeriodRequestQuantity: "0",
        currentPeriodCost: "0",
        billedOverageThisPeriod: "0",
      }),
    ]);
  });

  it("waives a rounded-zero remainder but advances the watermark and snapshots exact totals", async () => {
    state.stats = usageStats({
      currentPeriodRequestQuantity: "3",
      currentPeriodCost: "0.004",
      billedOverageThisPeriod: "0.003",
    });

    await handleMarketCycleInvoiceFinalized(stripeFixture(), cycleInvoice());

    expect(state.settle).not.toHaveBeenCalled();
    expect(state.subscriptionUpdates).toHaveLength(1);
    expect(state.statsUpdates).toEqual([
      expect.objectContaining({
        lastPeriodRequestQuantity: "3",
        lastPeriodCost: "0.004",
        currentPeriodRequestQuantity: "0",
        currentPeriodCost: "0",
        billedOverageThisPeriod: "0",
      }),
    ]);
  });

  it("preserves every accumulator and the watermark when provider settlement fails", async () => {
    state.stats = usageStats({
      currentPeriodRequestQuantity: "1000",
      currentPeriodCost: "1",
      billedOverageThisPeriod: "0",
    });
    state.settle.mockRejectedValueOnce(new Error("provider unavailable"));

    await expect(
      handleMarketCycleInvoiceFinalized(stripeFixture(), cycleInvoice()),
    ).rejects.toThrow("provider unavailable");

    expect(state.subscriptionUpdates).toEqual([]);
    expect(state.statsUpdates).toEqual([]);
  });

  it("settles the exact remainder then advances the guarded watermark and accumulator", async () => {
    state.stats = usageStats({
      currentPeriodRequestQuantity: "1005",
      currentPeriodCost: "1.005",
      billedOverageThisPeriod: "0.005",
    });
    await handleMarketCycleInvoiceFinalized(stripeFixture(), cycleInvoice());

    expect(state.settle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        customerId: "cus_1",
        stripeSubscriptionId: "sub_provider",
        amountCents: 100,
        itemIdempotencyKey: "overage-item:cus_1:sub_provider:2026-08",
        invoiceIdempotencyKey: "overage-invoice:cus_1:sub_provider:2026-08",
      }),
    );
    expect(state.subscriptionUpdates).toHaveLength(1);
    expect(state.statsUpdates).toEqual([
      expect.objectContaining({
        lastPeriodRequestQuantity: "1005",
        lastPeriodCost: "1.005",
        currentPeriodRequestQuantity: "0",
        currentPeriodCost: "0",
        billedOverageThisPeriod: "0",
      }),
    ]);
  });

  it("rolls the accumulator back when the guarded watermark cannot advance", async () => {
    state.advanceRows = [];

    await expect(
      handleMarketCycleInvoiceFinalized(stripeFixture(), cycleInvoice()),
    ).rejects.toThrow("watermark changed before it could advance");

    expect(state.statsUpdates).toEqual([]);
  });

  it("ignores an old provider after the local row has been reactivated", async () => {
    state.locked = localSubscription({ stripeSubscriptionId: "sub_reactivated" });

    await handleMarketCycleInvoiceFinalized(stripeFixture(), cycleInvoice());

    expect(state.stripeRetrieve).not.toHaveBeenCalled();
    expect(state.settle).not.toHaveBeenCalled();
    expect(state.subscriptionUpdates).toEqual([]);
    expect(state.statsUpdates).toEqual([]);
  });
});

describe("PAYG subscription period projection", () => {
  it("projects exact-current state when the retained Customer has no live user", async () => {
    state.liveUsers = [];

    await handleMarketSubscriptionProjection(stripeFixture(), "sub_provider");

    expect(state.subscriptionUpdates).toEqual([
      expect.objectContaining({
        status: "active",
        stripeCustomerId: "cus_1",
        cancelAtPeriodEnd: false,
        seats: 1,
      }),
    ]);
  });

  it("projects exact-current state when the surviving user Customer matches", async () => {
    await handleMarketSubscriptionProjection(stripeFixture(), "sub_provider");

    expect(state.subscriptionUpdates).toHaveLength(1);
  });

  it("rejects retained Customer drift without projecting", async () => {
    state.locked = localSubscription({ stripeCustomerId: "cus_other" });

    await expect(
      handleMarketSubscriptionProjection(stripeFixture(), "sub_provider"),
    ).rejects.toThrow("Current PAYG provider subscription drifted from its Market binding");

    expect(state.subscriptionUpdates).toEqual([]);
  });

  it.each([
    [
      "a null surviving-user Customer",
      [{ id: "user_1", stripeCustomerId: null }],
      "Live Market user Customer mapping drifted from the retained PAYG binding",
    ],
    [
      "a different surviving-user Customer",
      [{ id: "user_1", stripeCustomerId: "cus_other" }],
      "Live Market user Customer mapping drifted from the retained PAYG binding",
    ],
    [
      "multiple surviving users",
      [
        { id: "user_1", stripeCustomerId: "cus_1" },
        { id: "user_1_duplicate", stripeCustomerId: "cus_1" },
      ],
      "Retained PAYG subscription resolves multiple Market users",
    ],
  ])("rejects %s without projecting", async (_label, liveUsers, message) => {
    state.liveUsers = liveUsers;

    await expect(
      handleMarketSubscriptionProjection(stripeFixture(), "sub_provider"),
    ).rejects.toThrow(message);

    expect(state.subscriptionUpdates).toEqual([]);
  });

  it("does not project across a boundary that invoice settlement still owns", async () => {
    await handleMarketSubscriptionProjection(stripeFixture(), "sub_provider");

    expect(state.subscriptionUpdates).toEqual([
      expect.not.objectContaining({
        periodStart: expect.anything(),
        periodEnd: expect.anything(),
      }),
    ]);
  });

  it("projects an unchanged provider period normally", async () => {
    state.stripeRetrieve.mockResolvedValueOnce(
      providerSubscription({
        current_period_start: epoch("2026-07-31T00:00:00.000Z"),
        current_period_end: epoch("2026-08-31T00:00:00.000Z"),
      }),
    );

    await handleMarketSubscriptionProjection(stripeFixture(), "sub_provider");

    expect(state.subscriptionUpdates).toEqual([
      expect.objectContaining({
        periodStart: new Date("2026-07-31T00:00:00.000Z"),
        periodEnd: new Date("2026-08-31T00:00:00.000Z"),
      }),
    ]);
  });

  it("rejects a projection that skips an unsettled boundary", async () => {
    state.stripeRetrieve.mockResolvedValueOnce(
      providerSubscription({
        current_period_start: epoch("2026-09-30T00:00:00.000Z"),
        current_period_end: epoch("2026-10-31T00:00:00.000Z"),
      }),
    );

    await expect(
      handleMarketSubscriptionProjection(stripeFixture(), "sub_provider"),
    ).rejects.toThrow("misaligned with its settlement watermark");
    expect(state.subscriptionUpdates).toEqual([]);
  });
});

function transactionFixture() {
  let selects = 0;
  return {
    select: (selection?: Record<string, unknown>) => {
      if (selection) {
        return {
          from: () => ({
            where: () => ({
              limit: async () => state.liveUsers,
            }),
          }),
        };
      }
      selects += 1;
      const rows = selects === 1 ? [state.locked ?? state.current] : [state.stats];
      return {
        from: () => ({
          where: () => ({
            limit: async () => rows.filter(Boolean),
            for: () => ({ limit: async () => rows.filter(Boolean) }),
          }),
        }),
      };
    },
    update: (table: unknown) => ({
      set: (value: Record<string, unknown>) => ({
        where: () => updateQuery(table, value),
      }),
    }),
  } as unknown as MarketTransaction;
}

function updateQuery(table: unknown, value: Record<string, unknown>) {
  let recorded = false;
  const record = () => {
    if (recorded) return;
    recorded = true;
    if (table === subscription) state.subscriptionUpdates.push(value);
    if (table === userStats) state.statsUpdates.push(value);
  };
  return {
    returning: async () => {
      record();
      return state.advanceRows;
    },
    then: <TResult1 = void, TResult2 = never>(
      onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise.resolve().then(record).then(onfulfilled, onrejected),
  };
}

function stripeFixture() {
  return {
    subscriptions: { retrieve: state.stripeRetrieve },
  } as unknown as Stripe;
}

function cycleInvoice(overrides: Record<string, unknown> = {}) {
  return {
    billing_reason: "subscription_cycle",
    customer: "cus_1",
    period_start: epoch("2026-07-31T00:00:00.000Z"),
    period_end: epoch("2026-08-31T00:00:00.000Z"),
    parent: {
      subscription_details: { subscription: "sub_provider" },
    },
    ...overrides,
  } as unknown as Stripe.Invoice;
}

function localSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_default_user_1",
    referenceId: "user_1",
    referenceType: "user",
    plan: "payg",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_provider",
    periodStart: new Date("2026-07-31T00:00:00.000Z"),
    periodEnd: new Date("2026-08-31T00:00:00.000Z"),
    ...overrides,
  };
}

function providerSubscription(
  itemOverrides: Record<string, unknown> = {},
) {
  return {
    id: "sub_provider",
    status: "active",
    customer: "cus_1",
    cancel_at_period_end: false,
    trial_start: null,
    trial_end: null,
    metadata: {
      userId: "user_1",
      referenceId: "user_1",
      subscriptionId: "sub_default_user_1",
    },
    items: {
      data: [
        {
          price: { id: "price_market" },
          quantity: 1,
          current_period_start: epoch("2026-08-31T00:00:00.000Z"),
          current_period_end: epoch("2026-09-30T00:00:00.000Z"),
          ...itemOverrides,
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

function usageStats(overrides: Record<string, unknown> = {}) {
  return {
    id: "stats_1",
    usageOwnerId: "owner_1",
    currentPeriodRequestQuantity: "1",
    currentPeriodCost: "1",
    billedOverageThisPeriod: "0",
    ...overrides,
  };
}

function epoch(value: string) {
  return Date.parse(value) / 1_000;
}
