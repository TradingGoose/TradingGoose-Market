import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPersonalPaygAction } from "@/lib/account/billing-presentation";

const summaryState = vi.hoisted(() => ({
  retrieve: vi.fn(),
  snapshotComplete: false,
  billingEnabled: true,
  billingBlocked: false,
  customerMethod: "pm_test" as string | null,
  recovery: "ready" as "ready" | "settlement_pending" | "unavailable",
  stripeSubscriptionId: null as string | null,
}));

vi.mock("@/lib/auth/session", () => ({
  apiRequireCustomerSession: vi.fn(async () => ({
    error: null,
    user: { id: "user_1" },
  })),
}));

vi.mock("@/lib/billing/customer-state", () => {
  class StripeCustomerSettlementPendingError extends Error {}
  return {
    StripeCustomerSettlementPendingError,
    ensureStripeUserCustomer: vi.fn(async () => {
      if (summaryState.recovery === "settlement_pending") {
        throw new StripeCustomerSettlementPendingError();
      }
      if (summaryState.recovery === "unavailable") {
        throw new Error("transport");
      }
      return { id: "cus_1", invoice_settings: { default_payment_method: summaryState.customerMethod } };
    }),
  };
});

vi.mock("@/lib/db/locks", () => ({
  withBillingSubjectLock: async (_id: string, callback: (tx: unknown) => Promise<unknown>) => {
    const result = await callback({});
    summaryState.snapshotComplete = true;
    return result;
  },
}));
vi.mock("@/lib/billing/user-stats", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/billing/user-stats")>(),
  readPersonalBillingState: async () => ({
    customerId: "cus_1",
    subscription: { id: "sub_default_user_1", referenceId: "user_1", status: summaryState.stripeSubscriptionId ? "active" : null, cancelAtPeriodEnd: false,
      stripeSubscriptionId: summaryState.stripeSubscriptionId, stripeCustomerId: summaryState.stripeSubscriptionId ? "cus_1" : null,
      periodEnd: new Date("2026-05-01Z") },
    stats: { grantedOnboardingAllowanceUsd: "25", customUsageLimit: "25", currentPeriodCost: "7", currentPeriodRequestQuantity: "7",
      billingBlocked: summaryState.billingBlocked },
  }),
}));
vi.mock("@/lib/billing/webhooks/subscription", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/billing/webhooks/subscription")>(),
  requireRetainedSubscriptionCustomerBridge: vi.fn(),
}));
vi.mock("@/lib/billing/stripe-client", () => ({
  requireEnabledStripeClient: () => ({ subscriptions: { retrieve: summaryState.retrieve } }),
}));

vi.mock("@/lib/environment", () => ({
  getMarketRuntimeConfig: vi.fn(() => ({
    billing: {
      enabled: summaryState.billingEnabled,
      stripeSecretKey: "stripe-secret",
      stripePriceId: "price_market",
      usdPer1000Reads: "1",
    },
  })),
}));

vi.mock("@/lib/market-api/core/browser-route", () => ({
  browserRouteDescriptor: vi.fn(),
  rejectBrowserHead: vi.fn(),
  rejectBrowserMethod: vi.fn(),
  rejectBrowserOptions: vi.fn(),
}));

import { GET } from "../../app/api/account/billing/route";

beforeEach(() => {
  summaryState.billingEnabled = true;
  summaryState.billingBlocked = false;
  summaryState.customerMethod = "pm_test";
  summaryState.retrieve.mockReset();
  summaryState.snapshotComplete = false;
  summaryState.recovery = "ready";
  summaryState.stripeSubscriptionId = null;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("billing summary action availability", () => {
  it("exposes payment recovery without rewriting the subscription status or removing Portal access", async () => {
    summaryState.billingBlocked = true;
    summaryState.stripeSubscriptionId = "sub_provider";
    const response = await GET(new Request("http://localhost/api/account/billing"));
    expect(await response.json()).toMatchObject({
      billingBlocked: true,
      status: "active",
      activationAvailable: false,
      portalAvailable: true,
    });
  });
  it("shows the checkpoint and currently available allowance separately", async () => {
    const summary = await (await GET(new Request("http://localhost"))).json();
    expect(summary).toMatchObject({ grantedOnboardingAllowanceUsd: "25", availableOnboardingAllowanceUsd: "18",
      hasPaymentMethodOnFile: true, usageLimit: { currentLimitUsd: "25", percentUsed: expect.closeTo(28) } });
  });
  it.each([
    ["current", "pm_subscription", null, true],
    ["current", { id: "pm_subscription" }, null, true],
    ["current", null, "pm_customer", true],
    ["current", null, null, false],
    ["foreign", "pm_foreign", null, false],
    ["canceled", "pm_old", null, false],
    ["unavailable", null, "pm_customer", true],
  ] as const)("reads the %s provider after commit with subscription method %j and customer method %s", async (outcome, method, customerMethod, hasMethod) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15Z"));
    try {
      summaryState.stripeSubscriptionId = "sub_original";
      summaryState.customerMethod = customerMethod;
      summaryState.retrieve.mockImplementation(async id => {
        expect(summaryState.snapshotComplete).toBe(true);
        expect(id).toBe("sub_original");
        summaryState.billingBlocked = true;
        summaryState.stripeSubscriptionId = "sub_later";
        if (outcome === "unavailable") throw new Error("date unavailable");
        return { id, customer: outcome === "foreign" ? "other" : "cus_1", status: outcome === "canceled" ? "canceled" : "active", default_payment_method: method,
          metadata: { userId: "user_1", referenceId: "user_1", subscriptionId: "sub_default_user_1" },
          items: { data: [{ price: { id: "price_market" }, quantity: 1,
            current_period_start: Date.parse("2026-05-01Z") / 1000, current_period_end: Date.parse("2026-06-01Z") / 1000 }] } };
      });
      const response = await GET(new Request("http://localhost"));
      expect(response.status).toBe(200);
      const summary = await response.json();
      expect(summary).toMatchObject({ billingBlocked: false, currentPeriodCostUsd: "7", availableOnboardingAllowanceUsd: "0",
        hasPaidSubscription: true, hasPaymentMethodOnFile: hasMethod,
        nextBillingDate: outcome === "current" ? "2026-06-01T00:00:00.000Z" : null });
      expect(getPersonalPaygAction(summary, true)).toBe(hasMethod ? "Increase Limit" : "Add Payment Method");
      expect(summaryState.retrieve).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it.each([
    [true, "ready", null, true],
    [true, "unavailable", null, false],
    [true, "settlement_pending", null, false],
    [true, "ready", "sub_provider", false],
    [false, "ready", null, false],
  ] as const)(
    "enabled=%s recovery=%s binding=%s -> activation=%s",
    async (billingEnabled, recovery, stripeSubscriptionId, expected) => {
      summaryState.billingEnabled = billingEnabled;
      summaryState.recovery = recovery;
      summaryState.stripeSubscriptionId = stripeSubscriptionId;

      const response = await GET(
        new Request("http://localhost/api/account/billing"),
      );
      const payload = (await response.json()) as {
        activationAvailable: boolean;
        customerRecoveryState: string;
      };

      expect(response.status).toBe(200);
      expect(payload.activationAvailable).toBe(expected);
      if (!billingEnabled || !stripeSubscriptionId) expect(summaryState.retrieve).not.toHaveBeenCalled();
      expect(payload.customerRecoveryState).toBe(recovery);
    },
  );
});
