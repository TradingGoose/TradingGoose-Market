import type { MarketTransaction } from "@tradinggoose/db";
import { describe, expect, it } from "vitest";

import { requireRetainedSubscriptionCustomerBridge } from "../../lib/billing/webhooks/subscription";

describe("PAYG Customer identity bridges", () => {
  it("keeps the exact retained subscription Customer authoritative with no live user", async () => {
    await expect(
      requireRetainedSubscriptionCustomerBridge(
        bridgeTransaction([]),
        localSubscription(),
        "cus_1",
      ),
    ).resolves.toBeUndefined();
  });

  it("accepts one surviving user only when its Customer matches", async () => {
    await expect(
      requireRetainedSubscriptionCustomerBridge(
        bridgeTransaction([{ id: "user_1", stripeCustomerId: "cus_1" }]),
        localSubscription(),
        "cus_1",
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["a different retained Customer", { stripeCustomerId: "cus_other" }],
    ["a null retained Customer", { stripeCustomerId: null }],
    ["a non-user reference", { referenceType: "organization" }],
    ["a non-PAYG plan", { plan: "other" }],
  ])("rejects %s", async (_label, overrides) => {
    await expect(
      requireRetainedSubscriptionCustomerBridge(
        bridgeTransaction([]),
        localSubscription(overrides),
        "cus_1",
      ),
    ).rejects.toThrow(
      "Retained PAYG subscription Customer mapping drifted from its binding",
    );
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
  ])("rejects %s", async (_label, rows, message) => {
    await expect(
      requireRetainedSubscriptionCustomerBridge(
        bridgeTransaction(rows),
        localSubscription(),
        "cus_1",
      ),
    ).rejects.toThrow(message);
  });
});

function bridgeTransaction(
  rows: Array<{ id: string; stripeCustomerId: string | null }>,
) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => rows,
        }),
      }),
    }),
  } as unknown as MarketTransaction;
}

function localSubscription(
  overrides: Record<string, unknown> = {},
) {
  return {
    referenceType: "user",
    referenceId: "user_1",
    plan: "payg",
    stripeCustomerId: "cus_1",
    ...overrides,
  } as Parameters<typeof requireRetainedSubscriptionCustomerBridge>[1];
}
