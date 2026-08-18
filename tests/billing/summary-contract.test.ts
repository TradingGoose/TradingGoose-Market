import { beforeEach, describe, expect, it, vi } from "vitest";

const summaryState = vi.hoisted(() => ({
  billingEnabled: true,
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
    ensureMarketCustomerState: vi.fn(async () => ({
      subscription: {
        status: null,
        cancelAtPeriodEnd: null,
        stripeSubscriptionId: summaryState.stripeSubscriptionId,
      },
      userStats: {
        currentPeriodRequestQuantity: "0",
        currentPeriodCost: "0",
      },
    })),
    ensureStripeUserCustomer: vi.fn(async () => {
      if (summaryState.recovery === "settlement_pending") {
        throw new StripeCustomerSettlementPendingError();
      }
      if (summaryState.recovery === "unavailable") {
        throw new Error("transport");
      }
      return { id: "cus_1" };
    }),
  };
});

vi.mock("@/lib/environment", () => ({
  getMarketRuntimeConfig: vi.fn(() => ({
    billing: {
      enabled: summaryState.billingEnabled,
      stripeSecretKey: "stripe-secret",
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
  summaryState.recovery = "ready";
  summaryState.stripeSubscriptionId = null;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("billing summary action availability", () => {
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
      expect(payload.customerRecoveryState).toBe(recovery);
    },
  );
});
