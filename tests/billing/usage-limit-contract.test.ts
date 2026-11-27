import { beforeEach, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({
  enabled: true, status: "active", customerId: "cus_1" as string | null, providerId: "sub_1" as string | null,
  stats: { grantedOnboardingAllowanceUsd: "18", customUsageLimit: "25", currentPeriodCost: "19", billingBlocked: true, customUsageLimitUpdatedAt: new Date(0) },
  write: vi.fn(), lock: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ apiRequireCustomerSession: () => ({ user: { id: "own" } }) }));
vi.mock("@/lib/environment", () => ({ getMarketRuntimeConfig: () => ({ billing: { enabled: state.enabled } }) }));
vi.mock("@/lib/db/locks", () => ({ withBillingSubjectLock: (id: string, callback: (tx: unknown) => unknown) => {
  state.lock(id); return callback({ update: () => ({ set: (values: unknown) => ({ where: () => state.write(values) }) }) });
} }));
vi.mock("@/lib/billing/user-stats", async original => ({ ...await original<typeof import("@/lib/billing/user-stats")>(),
  readPersonalBillingState: () => ({ subscription: { status: state.status, stripeCustomerId: "cus_1", stripeSubscriptionId: state.providerId, cancelAtPeriodEnd: true },
    customerId: state.customerId, stats: state.stats }) }));
import { PUT, GET } from "@/app/api/account/billing/usage-limit/route";
const put = (body: unknown) => PUT(new Request("http://market.test", { method: "PUT", body: JSON.stringify(body) }));
beforeEach(() => {
  state.enabled = true; state.status = "active"; state.customerId = "cus_1"; state.providerId = "sub_1";
  state.stats.grantedOnboardingAllowanceUsd = "18"; state.stats.currentPeriodCost = "19";
  vi.clearAllMocks();
});
it.each([null, 22, [], { limitUsd: null }, { limitUsd: 22 }, { limitUsd: "2e3" }, { limitUsd: "-1" },
  { limitUsd: "19.0000000001" }, { limitUsd: "25", userId: "other" }, { limitUsd: "17" }, { limitUsd: "18.99" }])(
  "rejects invalid or below-floor edit %j", async body => { expect((await put(body)).status).toBe(400); expect(state.write).not.toHaveBeenCalled(); });
it.each(["19", "20.000000001", "0"])("updates only the editable cap and timestamps for %s", async limitUsd => {
  if (limitUsd === "0") { state.stats.currentPeriodCost = "0"; state.stats.grantedOnboardingAllowanceUsd = "0"; }
  const response = await put({ limitUsd });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ usageLimit: { canEdit: true, currentLimitUsd: limitUsd } });
  expect(state.write).toHaveBeenCalledWith({ customUsageLimit: limitUsd, updatedAt: expect.any(Date), customUsageLimitUpdatedAt: expect.any(Date) });
  expect(state.lock).toHaveBeenCalledWith("own");
});
it.each(["trialing", "past_due", "canceled", "unbound", "foreign", "disabled"])("denies %s edits", async status => {
  if (status === "unbound") state.providerId = null;
  else if (status === "foreign") state.customerId = "other";
  else if (status === "disabled") state.enabled = false;
  else state.status = status;
  const response = await GET(new Request("http://market.test"));
  expect(await response.json()).toMatchObject({ usageLimit: { canEdit: false, minimumLimitUsd: state.enabled ? "18" : "0" } });
  expect((await put({ limitUsd: "25" })).status).toBe(state.enabled ? 400 : 409);
  expect(state.write).not.toHaveBeenCalled();
});
