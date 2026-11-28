import { expect, it } from "vitest";
import { effectiveLimitNano, freeEntryValues, paidEntryValues, personalUsageLimit, remainingFreeAllowance } from "@/lib/billing/user-stats";

const free = { grantedOnboardingAllowanceUsd: "25", customUsageLimit: "25", currentPeriodCost: "7", currentPeriodRequestQuantity: "7" };
it.each([["7", "18"], ["9", "16"], ["10", "15"], ["25", "0"], ["30", "0"]])(
  "debits only new free usage on reactivation at %s", (currentPeriodCost, remainder) => {
    expect(remainingFreeAllowance(free)).toBe("18");
    const paid = { ...free, ...paidEntryValues(free) };
    expect(paid).toMatchObject({ grantedOnboardingAllowanceUsd: "18", currentPeriodCost: "0", lastPeriodCost: "7" });
    const restored = { ...paid, ...freeEntryValues("25", paid.grantedOnboardingAllowanceUsd), currentPeriodCost };
    expect(paidEntryValues(restored).grantedOnboardingAllowanceUsd).toBe(remainder);
    expect(remainingFreeAllowance(restored)).toBe(remainder);
    if (currentPeriodCost === "7") expect(paidEntryValues(restored)).not.toHaveProperty("lastPeriodCost");
  });
it("uses the stored free cap throughout the free interval and keeps the minimum when bound", () => {
  const restored = { ...free, ...freeEntryValues("50", "18"), grantedOnboardingAllowanceUsd: "18", currentPeriodCost: "35" };
  expect(remainingFreeAllowance(restored)).toBe("15");
  expect(effectiveLimitNano({ ...restored, customUsageLimit: null })).toBe(18_000_000_000n);
  expect(effectiveLimitNano({ ...restored, customUsageLimit: "5" })).toBe(18_000_000_000n);
});
it("handles blocked, exact and disabled thresholds separately", () => {
  const stats = { ...free, grantedOnboardingAllowanceUsd: "0", customUsageLimit: "0", currentPeriodCost: "0", billingBlocked: false };
  expect(personalUsageLimit(stats, true)).toEqual({ currentLimitUsd: "0", isExceeded: true, percentUsed: 0, status: "exceeded" });
  expect(personalUsageLimit({ ...stats, billingBlocked: true }, true).status).toBe("blocked");
  expect(personalUsageLimit(stats, false)).toEqual({ currentLimitUsd: null, isExceeded: false, percentUsed: 0, status: "ok" });
});
