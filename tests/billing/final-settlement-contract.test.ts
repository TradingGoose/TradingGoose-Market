import type { MarketTransaction } from "@tradinggoose/db";
import { subscription, user, userStats } from "@tradinggoose/db/schema";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usageStripeFixture } from "./stripe-usage-fixture";
import { acquireBillingSubjectLock } from "../../lib/db/locks";

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
  usageOwnerId: string;
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
  settle: vi.fn(async (_stripe: unknown, input: { snapshot: { fromUsd: string; throughUsd: string; requestQuantity: string } }) => input.snapshot),
  reconciledBilledUsd: null as string | null,
  realProvider: false,
  failCommitOnce: false,
  events: null as Array<{ admittedAt: Date; billableQuantity: number; billableCostUsd: string }> | null,
  closedUsageCutoff: new Date(0),
  beforeTransaction: null as (() => void) | null,
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
    state.current?.stripeSubscriptionId === providerId ? cloneSubscription(state.current) : null,
  ),
  getPaygActivationAttemptId: vi.fn(() => null),
  withoutPaygActivationAttemptId: vi.fn((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const metadata = { ...(value as Record<string, unknown>) };
    delete metadata.paygActivationAttemptId;
    return Object.keys(metadata).length ? metadata : null;
  }),
}));

vi.mock("@/lib/billing/threshold-billing", async importOriginal => {
  const original = await importOriginal<typeof import("../../lib/billing/threshold-billing")>();
  return {
    ...original,
    createAndSettleUsageInvoice: (...args: Parameters<typeof original.createAndSettleUsageInvoice>) =>
      state.realProvider ? original.createAndSettleUsageInvoice(...args) : state.settle(...args),
    reconcileUsageInvoices: (...args: Parameters<typeof original.reconcileUsageInvoices>) =>
      state.realProvider ? original.reconcileUsageInvoices(...args) : Promise.resolve(state.reconciledBilledUsd ?? args[1].billedUsd),
  };
});

vi.mock("@/lib/billing/user-stats", async importOriginal => {
  const original = await importOriginal<typeof import("../../lib/billing/user-stats")>();
  return {
    ...original,
    resolveRetainedUserStatsForSubscription: vi.fn(async () => ({ id: "stats_1" })),
    getClosedPeriodUsage: (...args: Parameters<typeof original.getClosedPeriodUsage>) => {
      if (!state.events) return Promise.resolve({
        requestQuantity: state.stats!.currentPeriodRequestQuantity, costUsd: state.stats!.currentPeriodCost,
      });
      state.closedUsageCutoff = args[2];
      return original.getClosedPeriodUsage(...args);
    },
  };
});

import { classifyUnboundMarketSubscription, handleMarketSubscriptionDeleted } from "../../lib/billing/webhooks/subscription";
import { handleMarketCycleInvoiceFinalized, handleMarketUsageInvoicePaid } from "../../lib/billing/webhooks/invoices";

beforeEach(() => {
  state.current = localSubscription();
  state.stats = usageStats();
  state.liveUsers = [];
  state.updates.length = 0;
  state.activeTransaction = 0;
  state.clearCasMiss = false;
  state.settle.mockReset().mockImplementation(async (_stripe, input) => input.snapshot);
  state.reconciledBilledUsd = null;
  state.realProvider = false;
  state.failCommitOnce = false;
  state.events = null;
  state.beforeTransaction = null;
  state.transaction.mockReset().mockImplementation(
    async (callback: (tx: MarketTransaction) => Promise<unknown>) => {
      state.beforeTransaction?.();
      state.activeTransaction += 1;
      const transactionNumber = state.activeTransaction;
      const subscriptionBefore = cloneSubscription(state.current);
      const statsBefore = cloneStats(state.stats);
      const updateCountBefore = state.updates.length;
      try {
        const result = await callback(transactionFixture(transactionNumber));
        if (state.failCommitOnce) {
          state.failCommitOnce = false;
          throw new Error("Database commit failed");
        }
        return result;
      } catch (error) {
        state.current = subscriptionBefore;
        state.stats = statsBefore;
        state.updates.splice(updateCountBefore);
        throw error;
      }
    },
  );
});

describe("webhook ownership during PAYG activation", () => {
  it.each(["active", "canceled"])(
    "retries a %s event when activation binds its provider ID while classification waits",
    async status => {
      state.current!.stripeSubscriptionId = null;
      const stripe = usageStripeFixture();
      vi.mocked(acquireBillingSubjectLock).mockImplementationOnce(async () => {
        state.current!.stripeSubscriptionId = "sub_provider";
      });
      await expect(classifyUnboundMarketSubscription(stripe.client, {
        ...deletedSnapshot(), status,
      } as Stripe.Subscription)).rejects.toThrow("retry its current owner");
      expect(acquireBillingSubjectLock).toHaveBeenLastCalledWith(expect.anything(), "user_1");
      expect(state.updates).toEqual([]);
      expect(stripe.subscriptionRetrieve).not.toHaveBeenCalled();
    },
  );

  it("still ignores a prior provider ID after a different activation binds", async () => {
    state.current!.stripeSubscriptionId = null;
    vi.mocked(acquireBillingSubjectLock).mockImplementationOnce(async () => {
      state.current!.stripeSubscriptionId = "sub_reactivated";
    });
    await classifyUnboundMarketSubscription({} as Stripe, deletedSnapshot());
    expect(state.current?.stripeSubscriptionId).toBe("sub_reactivated");
    expect(state.updates).toEqual([]);
  });

  it("does not acknowledge a deletion that initially arrived before activation committed its binding", async () => {
    state.current!.stripeSubscriptionId = null;
    vi.mocked(acquireBillingSubjectLock).mockImplementationOnce(async () => {
      state.current!.stripeSubscriptionId = "sub_provider";
    });
    await expect(handleMarketSubscriptionDeleted({} as Stripe, deletedSnapshot())).rejects.toThrow("retry its current owner");
    expect(acquireBillingSubjectLock).toHaveBeenLastCalledWith(expect.anything(), "user_1");
    expect(state.updates).toEqual([]);
    expect(state.settle).not.toHaveBeenCalled();
  });
});

describe("historical PAYG cycle recovery", () => {
  it.each(["deletion retry", "invoice.paid"])(
    "does not recharge later paid periods after catch-up rollback and cancellation via %s",
    async recovery => {
      const { stripe, fresh, history } = historicalRecoveryFixture();
      let declineThirdPeriod = true;
      const pay = stripe.payInvoice.getMockImplementation()!;
      stripe.payInvoice.mockImplementation(async (id, parameters) => {
        if (declineThirdPeriod && stripe.invoices.get(id)?.metadata?.usagePeriodEnd === "2026-11-01T00:00:00.000Z") {
          throw new Error("Third period card declined");
        }
        return pay(id, parameters);
      });

      await expect(handleMarketCycleInvoiceFinalized(stripe.client, history[0])).rejects.toThrow("Third period card declined");
      expect(stripe.charges).toEqual([100, 100]);
      expect(state.current?.periodEnd?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
      expect(state.stats?.currentPeriodCost).toBe("4");

      const canceled = { ...fresh, status: "canceled", ended_at: Date.parse("2026-11-20Z") / 1000 } as Stripe.Subscription;
      stripe.subscriptionRetrieve.mockResolvedValue(canceled as Awaited<ReturnType<typeof stripe.subscriptionRetrieve>>);
      await expect(handleMarketSubscriptionDeleted(stripe.client, canceled)).rejects.toThrow("Third period card declined");
      // Cancellation must preserve denial and the entire retryable accumulator,
      // not charge the aggregate over already-paid September/October slices.
      expect(stripe.charges).toEqual([100, 100]);
      expect(state.current?.status).toBe("canceled");
      expect(state.current?.stripeSubscriptionId).toBe("sub_provider");
      expect(state.current?.periodEnd?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
      expect(state.stats?.currentPeriodCost).toBe("4");

      declineThirdPeriod = false;
      if (recovery === "invoice.paid") {
        const invoice = [...stripe.invoices.values()].find(candidate =>
          candidate.metadata?.usagePeriodEnd === "2026-11-01T00:00:00.000Z")!;
        await stripe.payInvoice(invoice.id, { payment_method: "pm_customer_repaired" });
        await handleMarketUsageInvoicePaid(stripe.client, structuredClone(invoice));
      } else {
        await handleMarketSubscriptionDeleted(stripe.client, canceled);
      }
      expect(stripe.charges).toEqual([100, 100, 100, 100]);
      expect(stripe.invoiceCreate).toHaveBeenCalledTimes(4);
      expect(stripe.invoiceItemsCreate).toHaveBeenCalledTimes(4);
      expect(state.current?.stripeSubscriptionId).toBeNull();
      expect(state.stats?.currentPeriodCost).toBe("0");
      const finalInvoice = [...stripe.invoices.values()].find(invoice => invoice.metadata?.type === "final_overage_billing")!;
      expect(finalInvoice.metadata).toEqual(expect.objectContaining({
        usagePeriodEnd: "2026-12-01T00:00:00.000Z", usageFromUsd: "0", usageThroughUsd: "1",
      }));
      await handleMarketSubscriptionDeleted(stripe.client, canceled);
      await handleMarketUsageInvoicePaid(stripe.client, finalInvoice);
      expect(stripe.charges).toEqual([100, 100, 100, 100]);
    },
  );

  it("requires a complete cancellation boundary chain before any historical payment", async () => {
    const { stripe, fresh, history } = historicalRecoveryFixture();
    stripe.invoices.delete(history[1].id);
    await expect(handleMarketSubscriptionDeleted(stripe.client, {
      ...fresh, status: "canceled", ended_at: Date.parse("2026-11-20Z") / 1000,
    } as Stripe.Subscription)).rejects.toThrow("settlement gap");
    expect(stripe.invoiceCreate).not.toHaveBeenCalled();
    expect(stripe.payInvoice).not.toHaveBeenCalled();
    expect(state.current?.status).toBe("canceled");
    expect(state.current?.stripeSubscriptionId).toBe("sub_provider");
    expect(state.stats?.currentPeriodCost).toBe("4");
  });

  it.each(["compare-and-set", "commit"])(
    "recovers all paid historical and final invoices after final %s failure",
    async failure => {
      const { stripe, fresh } = historicalRecoveryFixture();
      const canceled = { ...fresh, status: "canceled", ended_at: Date.parse("2026-11-20Z") / 1000 } as Stripe.Subscription;
      stripe.subscriptionRetrieve.mockResolvedValue(canceled as Awaited<ReturnType<typeof stripe.subscriptionRetrieve>>);
      state.clearCasMiss = failure === "compare-and-set";
      if (failure === "commit") {
        state.beforeTransaction = () => {
          if (state.activeTransaction === 1) state.failCommitOnce = true;
        };
      }
      await expect(handleMarketSubscriptionDeleted(stripe.client, canceled)).rejects.toThrow(
        failure === "compare-and-set" ? "binding changed before final settlement cleanup" : "Database commit failed",
      );
      expect(stripe.charges).toEqual([100, 100, 100, 100]);
      expect(state.current?.status).toBe("canceled");
      expect(state.current?.stripeSubscriptionId).toBe("sub_provider");
      expect(state.current?.periodEnd?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
      expect(state.stats?.currentPeriodCost).toBe("4");

      state.clearCasMiss = false;
      state.beforeTransaction = null;
      const finalInvoice = [...stripe.invoices.values()].find(invoice => invoice.metadata?.type === "final_overage_billing")!;
      stripe.payInvoice.mockClear();
      await handleMarketUsageInvoicePaid(stripe.client, finalInvoice);
      expect(stripe.payInvoice).not.toHaveBeenCalled();
      expect(stripe.charges).toEqual([100, 100, 100, 100]);
      expect(stripe.invoiceCreate).toHaveBeenCalledTimes(4);
      expect(state.current?.stripeSubscriptionId).toBeNull();
      expect(state.stats?.currentPeriodCost).toBe("0");
    },
  );

  it("reconciles paid prefixes after a later catch-up charge fails and excludes disabled usage", async () => {
    const { stripe, history } = historicalRecoveryFixture();
    let declineSecondPeriod = true;
    const pay = stripe.payInvoice.getMockImplementation()!;
    stripe.payInvoice.mockImplementation(async (id, parameters) => {
      if (declineSecondPeriod && stripe.invoices.get(id)?.metadata?.usagePeriodEnd === "2026-10-01T00:00:00.000Z") {
        declineSecondPeriod = false;
        throw new Error("Second period card declined");
      }
      return pay(id, parameters);
    });

    await expect(handleMarketCycleInvoiceFinalized(stripe.client, history[0])).rejects.toThrow("Second period card declined");
    expect(state.current?.periodEnd?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(state.stats?.currentPeriodCost).toBe("4");
    expect(stripe.charges).toEqual([100]);
    expect(state.updates).toEqual([]);

    await handleMarketCycleInvoiceFinalized(stripe.client, history[0]);
    expect(stripe.charges).toEqual([100, 100, 100]);
    expect(stripe.invoiceCreate).toHaveBeenCalledTimes(3);
    expect(stripe.invoiceItemsCreate).toHaveBeenCalledTimes(3);
    expect(state.current?.periodStart?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(state.current?.periodEnd?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(state.stats).toEqual(expect.objectContaining({
      currentPeriodCost: "1", currentPeriodRequestQuantity: "1", billedOverageThisPeriod: "0",
    }));
    stripe.subscriptionRetrieve.mockClear();
    await handleMarketCycleInvoiceFinalized(stripe.client, history[2]);
    expect(stripe.subscriptionRetrieve).not.toHaveBeenCalled();
    expect(stripe.charges).toEqual([100, 100, 100]);
  });
});

function historicalRecoveryFixture() {
  state.realProvider = true;
  state.stats = usageStats({ currentPeriodRequestQuantity: "4", currentPeriodCost: "4" });
  state.events = [
    { admittedAt: new Date("2026-08-15Z"), billableQuantity: 1, billableCostUsd: "1" },
    { admittedAt: new Date("2026-09-15Z"), billableQuantity: 1, billableCostUsd: "1" },
    { admittedAt: new Date("2026-09-20Z"), billableQuantity: 0, billableCostUsd: "0" },
    { admittedAt: new Date("2026-10-15Z"), billableQuantity: 1, billableCostUsd: "1" },
    { admittedAt: new Date("2026-11-15Z"), billableQuantity: 1, billableCostUsd: "1" },
  ];
  const stripe = usageStripeFixture();
  const fresh = { ...deletedSnapshot(), status: "active", default_payment_method: "pm_subscription",
    items: { data: [{ price: { id: "price_market_payg" }, quantity: 1,
      current_period_start: Date.parse("2026-11-01Z") / 1000,
      current_period_end: Date.parse("2026-12-01Z") / 1000 }] },
  } as Stripe.Subscription;
  stripe.subscriptionRetrieve.mockResolvedValue(fresh as Awaited<ReturnType<typeof stripe.subscriptionRetrieve>>);
  const history = [
    historicalInvoice("in_cycle_3", "2026-10-01Z", "2026-11-01Z"),
    historicalInvoice("in_cycle_2", "2026-09-01Z", "2026-10-01Z"),
    historicalInvoice("in_cycle_1", "2026-08-01Z", "2026-09-01Z"),
  ];
  for (const invoice of history) stripe.invoices.set(invoice.id, invoice);
  return { stripe, fresh, history };
}

describe("PAYG final cancellation settlement", () => {
  it.each(["final_overage_billing", "overage_threshold_billing", "overage_billing"])(
    "recovers canceled settlement after a %s invoice is paid outside deletion retries",
    async type => {
      state.realProvider = true;
      state.stats = usageStats({ currentPeriodRequestQuantity: "1000", currentPeriodCost: "1" });
      const stripe = usageStripeFixture();
      const canceled = { ...deletedSnapshot(), default_payment_method: "pm_old" };
      stripe.subscriptionRetrieve.mockResolvedValue(canceled as Awaited<ReturnType<typeof stripe.subscriptionRetrieve>>);
      stripe.state.paymentFailure = true;
      await expect(handleMarketSubscriptionDeleted(stripe.client, canceled)).rejects.toThrow("Card declined");
      expect(state.current?.status).toBe("canceled");
      expect(state.current?.stripeSubscriptionId).toBe("sub_provider");

      const invoice = stripe.invoices.get("in_1")!;
      invoice.metadata!.type = type;
      invoice.status = "paid"; // Portal paid the frozen invoice after deletion retries stopped.
      stripe.payInvoice.mockClear();
      stripe.invoiceCreate.mockClear();
      await handleMarketUsageInvoicePaid(stripe.client, structuredClone(invoice));

      expect(state.current?.stripeSubscriptionId).toBeNull();
      expect(state.stats?.currentPeriodCost).toBe("0");
      expect(stripe.invoiceCreate).not.toHaveBeenCalled();
      expect(stripe.payInvoice).not.toHaveBeenCalled();
    },
  );

  it("does not let a paid invoice from another Customer recover the current canceled binding", async () => {
    state.current!.status = "canceled";
    await expect(handleMarketUsageInvoicePaid({} as Stripe, {
      customer: "cus_wrong", metadata: { type: "final_overage_billing", subscriptionId: "sub_provider" },
    } as unknown as Stripe.Invoice)).rejects.toThrow("Customer does not match its binding");
    expect(state.updates).toEqual([]);
    expect(state.transaction).not.toHaveBeenCalled();
  });

  it.each(["sub_previous", "sub_reactivated"])("ignores paid invoices for non-current binding %s", async providerId => {
    state.current!.status = "canceled";
    await handleMarketUsageInvoicePaid({} as Stripe, {
      customer: "cus_1", metadata: { type: "final_overage_billing", subscriptionId: providerId },
    } as unknown as Stripe.Invoice);
    expect(state.updates).toEqual([]);
    expect(state.transaction).not.toHaveBeenCalled();
  });

  it("does not treat invoice payment as a new entitlement or final owner for an active subscription", async () => {
    await handleMarketUsageInvoicePaid({} as Stripe, {
      customer: "cus_1", metadata: { type: "overage_threshold_billing", subscriptionId: "sub_provider" },
    } as unknown as Stripe.Invoice);
    expect(state.updates).toEqual([]);
    expect(state.transaction).not.toHaveBeenCalled();
  });

  it("rechecks the current binding under the deletion owner's existing lock", async () => {
    state.current!.status = "canceled";
    const stripe = usageStripeFixture();
    stripe.subscriptionRetrieve.mockResolvedValue(deletedSnapshot() as Awaited<ReturnType<typeof stripe.subscriptionRetrieve>>);
    state.beforeTransaction = () => {
      state.current!.stripeSubscriptionId = "sub_reactivated";
      state.current!.status = "active";
    };
    await handleMarketUsageInvoicePaid(stripe.client, {
      customer: "cus_1", metadata: { type: "final_overage_billing", subscriptionId: "sub_provider" },
    } as unknown as Stripe.Invoice);
    expect(state.updates).toEqual([]);
    expect(state.current?.stripeSubscriptionId).toBe("sub_reactivated");
    expect(state.settle).not.toHaveBeenCalled();
  });

  it("does not finalize a canceled local binding from a non-canceled provider response", async () => {
    state.current!.status = "canceled";
    const stripe = usageStripeFixture();
    stripe.subscriptionRetrieve.mockResolvedValue({
      ...deletedSnapshot(), status: "active", default_payment_method: "pm_current",
    } as Awaited<ReturnType<typeof stripe.subscriptionRetrieve>>);
    await expect(handleMarketUsageInvoicePaid(stripe.client, {
      customer: "cus_1", metadata: { type: "final_overage_billing", subscriptionId: "sub_provider" },
    } as unknown as Stripe.Invoice)).rejects.toThrow("does not contain a canceled subscription");
    expect(state.updates).toEqual([]);
    expect(state.settle).not.toHaveBeenCalled();
  });

  it("reconciles a paid cycle after local rollback before deletion settles the new remainder", async () => {
    state.realProvider = true;
    state.stats = usageStats({ currentPeriodRequestQuantity: "1000", currentPeriodCost: "1" });
    state.failCommitOnce = true;
    const stripe = usageStripeFixture();
    const fresh = Object.assign(await stripe.subscriptionRetrieve(), deletedSnapshot(), {
      status: "active", default_payment_method: "pm_subscription",
      items: { data: [{ quantity: 1, price: { id: "price_market_payg" },
        current_period_start: Date.parse("2026-09-01T00:00:00.000Z") / 1000,
        current_period_end: Date.parse("2026-10-01T00:00:00.000Z") / 1000 }] },
    });
    stripe.subscriptionRetrieve.mockResolvedValue(fresh);
    await expect(handleMarketCycleInvoiceFinalized(stripe.client, {
      billing_reason: "subscription_cycle", customer: "cus_1",
      period_start: Date.parse("2026-08-01T00:00:00.000Z") / 1000,
      period_end: Date.parse("2026-09-01T00:00:00.000Z") / 1000,
      parent: { subscription_details: { subscription: "sub_provider" } },
    } as Stripe.Invoice)).rejects.toThrow("Database commit failed");
    expect(state.stats?.currentPeriodCost).toBe("1");
    expect(stripe.charges).toEqual([100]);

    state.stats!.currentPeriodCost = "1.01";
    state.stats!.currentPeriodRequestQuantity = "1010";
    await handleMarketSubscriptionDeleted(stripe.client, { ...fresh, status: "canceled" } as Stripe.Subscription);
    expect(stripe.charges).toEqual([100, 1]);
    expect(stripe.invoiceItemsCreate).toHaveBeenCalledTimes(2);
    expect(state.current?.stripeSubscriptionId).toBeNull();
    expect(state.stats?.currentPeriodCost).toBe("0");
  });
  it("reconciles a pending threshold invoice before charging only final remainder", async () => {
    state.stats = usageStats({ currentPeriodCost: "1.01", billedOverageThisPeriod: "0" });
    state.reconciledBilledUsd = "1";
    await handleMarketSubscriptionDeleted({} as Stripe, deletedSnapshot());
    expect(state.settle).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      amountCents: 1, snapshot: expect.objectContaining({ fromUsd: "1", throughUsd: "1.01" }),
    }));
    expect(state.current?.stripeSubscriptionId).toBeNull();
  });
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
    const updatesAfterClear = [...state.updates];
    await handleMarketSubscriptionDeleted({} as Stripe, oldSnapshot);

    expect(state.transaction).toHaveBeenCalledTimes(transactionCountAfterClear + 1);
    expect(state.updates).toEqual(updatesAfterClear);
    expect(state.settle).toHaveBeenCalledOnce();

    state.current = {
      ...localSubscription(),
      stripeSubscriptionId: "sub_reactivated",
      status: "active",
      metadata: { retained: "value" },
    };
    await handleMarketSubscriptionDeleted({} as Stripe, oldSnapshot);

    expect(state.transaction).toHaveBeenCalledTimes(transactionCountAfterClear + 2);
    expect(state.updates).toEqual(updatesAfterClear);
    expect(state.current.stripeSubscriptionId).toBe("sub_reactivated");
    expect(state.current.status).toBe("active");
  });
});

function transactionFixture(transactionNumber: number) {
  return {
    select: (selection?: Record<string, unknown>) => {
      if (selection?.requestQuantity && selection?.costUsd && state.events) {
        return { from: () => ({ where: async () => {
          const events = state.events!.filter(event => event.billableQuantity === 1 &&
            event.admittedAt.getTime() >= state.closedUsageCutoff.getTime());
          return [{ requestQuantity: events.length.toString(),
            costUsd: events.reduce((sum, event) => sum + BigInt(event.billableCostUsd), 0n).toString() }];
        } }) };
      }
      return {
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
    };
    },
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
    usageOwnerId: "owner_1",
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

function historicalInvoice(id: string, start: string, end: string) {
  return {
    id, status: "paid", billing_reason: "subscription_cycle", customer: "cus_1", metadata: {},
    period_start: Date.parse(start) / 1000, period_end: Date.parse(end) / 1000,
    parent: { subscription_details: { subscription: "sub_provider" } },
  } as Stripe.Invoice;
}
