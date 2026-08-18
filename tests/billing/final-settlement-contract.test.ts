import type { MarketTransaction } from "@tradinggoose/db";
import { subscription, user, userStats } from "@tradinggoose/db/schema";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface SubscriptionState {
  id: string;
  plan: string;
  referenceType: string;
  referenceId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  status: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean | null;
  seats: number | null;
  trialStart: Date | null;
  trialEnd: Date | null;
  metadata: Record<string, unknown> | null;
}

interface StatsState {
  id: string;
  currentPeriodRequestQuantity: string;
  currentPeriodCost: string;
  billedOverageThisPeriod: string;
  lastPeriodRequestQuantity: string;
  lastPeriodCost: string;
  updatedAt?: Date;
}

interface UpdateRecord {
  transaction: number;
  table: "subscription" | "userStats";
  values: Record<string, unknown>;
}

const state = vi.hoisted(() => ({
  current: null as SubscriptionState | null,
  stats: null as StatsState | null,
  liveUsers: [] as Array<{ id: string; stripeCustomerId: string | null }>,
  updates: [] as UpdateRecord[],
  activeTransaction: 0,
  clearCasMiss: false,
  settle: vi.fn<
    (stripe: unknown, input: Record<string, unknown>) => Promise<string>
  >(async () => "in_final"),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db/locks", () => ({
  acquireBillingSubjectLock: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db/runtime", () => ({
  requireDatabase: () => ({ transaction: state.transaction }),
}));

vi.mock("@/lib/environment", () => ({
  getMarketRuntimeConfig: () => ({
    billing: { stripePriceId: "price_market_payg" },
  }),
}));

vi.mock("@/lib/billing/activation", () => ({
  isExactMarketSubscription: vi.fn(() => true),
}));

vi.mock("@/lib/billing/subscription", () => ({
  getPaygSubscriptionByStripeId: vi.fn(async (providerId: string) =>
    state.current?.stripeSubscriptionId === providerId ? state.current : null,
  ),
  getPaygActivationAttemptId: vi.fn(() => null),
  withoutPaygActivationAttemptId: vi.fn((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const metadata = { ...(value as Record<string, unknown>) };
    delete metadata.paygActivationAttemptId;
    return Object.keys(metadata).length ? metadata : null;
  }),
}));

vi.mock("@/lib/billing/threshold-billing", () => ({
  createAndSettleUsageInvoice: state.settle,
}));

vi.mock("@/lib/billing/user-stats", () => ({
  resolveRetainedUserStatsForSubscription: vi.fn(async () => ({ id: "stats_1" })),
}));

import { handleMarketSubscriptionDeleted } from "../../lib/billing/webhooks/subscription";

beforeEach(() => {
  state.current = localSubscription();
  state.stats = usageStats();
  state.liveUsers = [];
  state.updates.length = 0;
  state.activeTransaction = 0;
  state.clearCasMiss = false;
  state.settle.mockReset().mockResolvedValue("in_final");
  state.transaction.mockReset().mockImplementation(
    async (callback: (tx: MarketTransaction) => Promise<unknown>) => {
      state.activeTransaction += 1;
      const transactionNumber = state.activeTransaction;
      const subscriptionBefore = cloneSubscription(state.current);
      const statsBefore = cloneStats(state.stats);
      const updateCountBefore = state.updates.length;
      try {
        return await callback(transactionFixture(transactionNumber));
      } catch (error) {
        state.current = subscriptionBefore;
        state.stats = statsBefore;
        state.updates.splice(updateCountBefore);
        throw error;
      }
    },
  );
});

describe("PAYG final cancellation settlement", () => {
  it("does not cancel a binding from a non-canceled provider snapshot", async () => {
    const snapshot = deletedSnapshot();
    Object.assign(snapshot, { status: "active" });

    await expect(
      handleMarketSubscriptionDeleted({} as Stripe, snapshot),
    ).rejects.toThrow("does not contain a canceled subscription");

    expect(state.current?.status).toBe("active");
    expect(state.current?.stripeSubscriptionId).toBe("sub_provider");
    expect(state.updates).toEqual([]);
    expect(state.settle).not.toHaveBeenCalled();
  });

  it("durably cancels first, then waives an empty cycle without replacing prior history", async () => {
    state.stats = usageStats({
      currentPeriodRequestQuantity: "0",
      currentPeriodCost: "0",
      billedOverageThisPeriod: "0",
      lastPeriodRequestQuantity: "44",
      lastPeriodCost: "2.5",
    });

    await handleMarketSubscriptionDeleted({} as Stripe, deletedSnapshot());

    expect(state.settle).not.toHaveBeenCalled();
    expect(state.stats).toEqual(
      expect.objectContaining({
        lastPeriodRequestQuantity: "44",
        lastPeriodCost: "2.5",
      }),
    );
    expect(state.updates).toEqual([
      {
        transaction: 1,
        table: "subscription",
        values: { status: "canceled" },
      },
      expect.objectContaining({
        transaction: 2,
        table: "subscription",
        values: expect.objectContaining({
          status: "canceled",
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          periodStart: null,
          periodEnd: null,
          metadata: { retained: "value" },
        }),
      }),
    ]);
    expect(state.current?.stripeSubscriptionId).toBeNull();
  });

  it("treats a nonzero remainder that rounds below one cent as a waiver", async () => {
    state.stats = usageStats({
      currentPeriodRequestQuantity: "3",
      currentPeriodCost: "0.004",
      billedOverageThisPeriod: "0.003",
    });

    await handleMarketSubscriptionDeleted({} as Stripe, deletedSnapshot());

    expect(state.settle).not.toHaveBeenCalled();
    expect(state.stats).toEqual(
      expect.objectContaining({
        lastPeriodRequestQuantity: "3",
        lastPeriodCost: "0.004",
        currentPeriodRequestQuantity: "0",
        currentPeriodCost: "0",
        billedOverageThisPeriod: "0",
      }),
    );
    expect(state.current?.stripeSubscriptionId).toBeNull();
  });

  it("leaves cancellation durable and every settlement input bound on provider failure", async () => {
    state.stats = usageStats({
      currentPeriodRequestQuantity: "1500",
      currentPeriodCost: "1.5",
      billedOverageThisPeriod: "0.5",
    });
    const statsBefore = cloneStats(state.stats);
    state.settle.mockRejectedValueOnce(new Error("provider unavailable"));

    await expect(
      handleMarketSubscriptionDeleted({} as Stripe, deletedSnapshot()),
    ).rejects.toThrow("provider unavailable");

    expect(state.current).toEqual(
      expect.objectContaining({
        status: "canceled",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_provider",
        periodStart: new Date("2026-08-01T00:00:00.000Z"),
        periodEnd: new Date("2026-09-01T00:00:00.000Z"),
        metadata: {
          retained: "value",
          paygActivationAttemptId: "attempt_1",
        },
      }),
    );
    expect(state.stats).toEqual(statsBefore);
    expect(state.updates).toEqual([
      {
        transaction: 1,
        table: "subscription",
        values: { status: "canceled" },
      },
    ]);
  });

  it("retries a failed retained settlement with stable provider idempotency keys", async () => {
    state.stats = usageStats({
      currentPeriodRequestQuantity: "1500",
      currentPeriodCost: "1.5",
      billedOverageThisPeriod: "0.5",
    });
    state.settle.mockRejectedValueOnce(new Error("provider unavailable"));

    await expect(
      handleMarketSubscriptionDeleted({} as Stripe, deletedSnapshot()),
    ).rejects.toThrow("provider unavailable");
    await handleMarketSubscriptionDeleted({} as Stripe, deletedSnapshot());

    expect(state.settle).toHaveBeenCalledTimes(2);
    for (const invocation of state.settle.mock.calls) {
      expect(invocation[1]).toEqual(
        expect.objectContaining({
          customerId: "cus_1",
          stripeSubscriptionId: "sub_provider",
          amountCents: 100,
          itemIdempotencyKey:
            "final-overage-item:cus_1:sub_provider:2026-08",
          invoiceIdempotencyKey:
            "final-overage-invoice:cus_1:sub_provider:2026-08",
          deletedSubscriptionSnapshot: expect.objectContaining({
            id: "sub_provider",
            status: "canceled",
          }),
        }),
      );
    }
    expect(state.stats).toEqual(
      expect.objectContaining({
        lastPeriodRequestQuantity: "1500",
        lastPeriodCost: "1.5",
        currentPeriodRequestQuantity: "0",
        currentPeriodCost: "0",
        billedOverageThisPeriod: "0",
      }),
    );
    expect(state.current).toEqual(
      expect.objectContaining({
        status: "canceled",
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        periodStart: null,
        periodEnd: null,
        metadata: { retained: "value" },
      }),
    );
  });

  it("settles retained usage after the live user has been deleted", async () => {
    state.liveUsers = [];
    state.stats = usageStats({
      currentPeriodRequestQuantity: "1000",
      currentPeriodCost: "1",
    });

    await handleMarketSubscriptionDeleted({} as Stripe, deletedSnapshot());

    expect(state.settle).toHaveBeenCalledOnce();
    expect(state.current?.stripeSubscriptionId).toBeNull();
  });

  it("rolls back accumulator cleanup when the exact canceled binding CAS misses", async () => {
    state.stats = usageStats({
      currentPeriodRequestQuantity: "1000",
      currentPeriodCost: "1",
    });
    const statsBefore = cloneStats(state.stats);
    state.clearCasMiss = true;

    await expect(
      handleMarketSubscriptionDeleted({} as Stripe, deletedSnapshot()),
    ).rejects.toThrow("binding changed before final settlement cleanup");

    expect(state.settle).toHaveBeenCalledOnce();
    expect(state.stats).toEqual(statsBefore);
    expect(state.current).toEqual(
      expect.objectContaining({
        status: "canceled",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_provider",
        periodStart: new Date("2026-08-01T00:00:00.000Z"),
        periodEnd: new Date("2026-09-01T00:00:00.000Z"),
      }),
    );
  });

  it("makes a duplicate cleared deletion and a stale old deletion after reactivation no-ops", async () => {
    state.stats = usageStats({
      currentPeriodRequestQuantity: "1000",
      currentPeriodCost: "1",
    });
    const oldSnapshot = deletedSnapshot();

    await handleMarketSubscriptionDeleted({} as Stripe, oldSnapshot);
    const transactionCountAfterClear = state.transaction.mock.calls.length;
    await handleMarketSubscriptionDeleted({} as Stripe, oldSnapshot);

    expect(state.transaction).toHaveBeenCalledTimes(transactionCountAfterClear);
    expect(state.settle).toHaveBeenCalledOnce();

    state.current = {
      ...localSubscription(),
      stripeSubscriptionId: "sub_reactivated",
      status: "active",
      metadata: { retained: "value" },
    };
    await handleMarketSubscriptionDeleted({} as Stripe, oldSnapshot);

    expect(state.transaction).toHaveBeenCalledTimes(transactionCountAfterClear);
    expect(state.current.stripeSubscriptionId).toBe("sub_reactivated");
    expect(state.current.status).toBe("active");
  });
});

function transactionFixture(transactionNumber: number) {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const rows =
            table === subscription
              ? [state.current].filter(Boolean)
              : table === user
                ? state.liveUsers
                : table === userStats
                  ? [state.stats].filter(Boolean)
                  : [];
          return {
            limit: async () => rows,
            for: () => ({ limit: async () => rows }),
          };
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => makeUpdateOperation(table, values, transactionNumber),
      }),
    }),
  } as unknown as MarketTransaction;
}

function makeUpdateOperation(
  table: unknown,
  values: Record<string, unknown>,
  transactionNumber: number,
) {
  let executed = false;
  let result: Array<{ id: string }> = [];
  const execute = () => {
    if (executed) return result;
    executed = true;

    if (table === subscription) {
      const isFinalClear = values.stripeSubscriptionId === null;
      const current = state.current;
      const bindingMatches =
        current?.id === "sub_default_user_1" &&
        current.stripeSubscriptionId === "sub_provider" &&
        (!isFinalClear || current.status === "canceled");
      if (!bindingMatches || (isFinalClear && state.clearCasMiss)) return result;
      state.updates.push({
        transaction: transactionNumber,
        table: "subscription",
        values,
      });
      Object.assign(current, values);
      result = [{ id: current.id }];
      return result;
    }

    if (table === userStats && state.stats) {
      state.updates.push({
        transaction: transactionNumber,
        table: "userStats",
        values,
      });
      Object.assign(state.stats, values);
      result = [{ id: state.stats.id }];
    }
    return result;
  };

  return {
    returning: async () => execute(),
    then: <TResult1 = Array<{ id: string }>, TResult2 = never>(
      onFulfilled?: ((value: Array<{ id: string }>) => TResult1 | PromiseLike<TResult1>) | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise.resolve(execute()).then(onFulfilled, onRejected),
  };
}

function localSubscription(): SubscriptionState {
  return {
    id: "sub_default_user_1",
    plan: "payg",
    referenceType: "user",
    referenceId: "user_1",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_provider",
    status: "active",
    periodStart: new Date("2026-08-01T00:00:00.000Z"),
    periodEnd: new Date("2026-09-01T00:00:00.000Z"),
    cancelAtPeriodEnd: false,
    seats: 1,
    trialStart: null,
    trialEnd: null,
    metadata: {
      retained: "value",
      paygActivationAttemptId: "attempt_1",
    },
  };
}

function usageStats(overrides: Partial<StatsState> = {}): StatsState {
  return {
    id: "stats_1",
    currentPeriodRequestQuantity: "1",
    currentPeriodCost: "1",
    billedOverageThisPeriod: "0",
    lastPeriodRequestQuantity: "0",
    lastPeriodCost: "0",
    ...overrides,
  };
}

function cloneSubscription(value: SubscriptionState | null) {
  if (!value) return null;
  return {
    ...value,
    periodStart: value.periodStart ? new Date(value.periodStart) : null,
    periodEnd: value.periodEnd ? new Date(value.periodEnd) : null,
    trialStart: value.trialStart ? new Date(value.trialStart) : null,
    trialEnd: value.trialEnd ? new Date(value.trialEnd) : null,
    metadata: value.metadata ? { ...value.metadata } : null,
  };
}

function cloneStats(value: StatsState | null) {
  return value ? { ...value } : null;
}

function deletedSnapshot() {
  return {
    id: "sub_provider",
    status: "canceled",
    customer: "cus_1",
    metadata: {
      subscriptionId: "sub_default_user_1",
      userId: "user_1",
      referenceId: "user_1",
    },
    ended_at: Date.parse("2026-08-31T00:00:00.000Z") / 1_000,
    canceled_at: null,
    items: {
      data: [
        {
          current_period_start: Date.parse("2026-08-01T00:00:00.000Z") / 1_000,
          current_period_end: Date.parse("2026-09-01T00:00:00.000Z") / 1_000,
          price: { id: "price_market_payg" },
          quantity: 1,
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}
