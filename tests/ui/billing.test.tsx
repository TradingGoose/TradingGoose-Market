// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubscriptionSettings } from "@/components/settings-dialog/subscription-settings";
import type { BillingSummary } from "@/lib/account/contracts";
import { account, baseSummary, billingFixture, billingPath, limitPath, prefPath, release, wrapper } from "../helpers/billing-ui";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const free: Partial<BillingSummary> = {
  status: null, hasPaidSubscription: false, hasStripeSubscription: false, activationAvailable: true,
  currentPeriodCostUsd: "7", grantedOnboardingAllowanceUsd: "25", availableOnboardingAllowanceUsd: "18",
  usageLimit: { currentLimitUsd: "25", percentUsed: 28, isExceeded: false, status: "ok" },
};
function mount(changes: Partial<BillingSummary> = {}, canEdit = true) {
  const f = billingFixture(changes, { canEdit });
  render(<SubscriptionSettings userId={account.id} onOpenChange={vi.fn()} />, { wrapper: wrapper(f.client) });
  return f;
}
describe("personal PAYG controls", () => {
  it.each([
    ["unbound", free, "Activate PAYG"], ["unbound without method", { ...free, hasPaymentMethodOnFile: false }, "Add Payment Method"],
    ["active", {}, "Increase Limit"], ["blocked", { billingBlocked: true }, "Resolve Payment"],
    ["canceling", { cancelAtPeriodEnd: true }, "Increase Limit"], ["past due", { status: "past_due" }, "Resolve Payment"],
    ["unpaid", { status: "unpaid" }, "Resolve Payment"], ["incomplete", { status: "incomplete" }, "Resolve Payment"],
    ["expired", { status: "incomplete_expired" }, "Resolve Payment"],
  ] as const)("keeps PAYG current and chooses the action for %s", (_name, changes, action) => {
    mount(changes);
    expect(screen.getByRole("button", { name: action })).toBeTruthy();
    expect(!!screen.queryByRole("button", { name: "Edit limit" })).toBe(action === "Increase Limit");
    const card = screen.getByRole("article");
    expect(card.getAttribute("aria-current")).toBe("true");
    expect(card.className).toContain("border-primary");
    expect(within(card).getByText("$0.00")).toBeTruthy();
    expect(within(card).getByText("/mo")).toBeTruthy();
    expect(within(card).getByText("$0.001 / 1,000 reads")).toBeTruthy();
    expect(within(card).getByText("1,250 reads this period")).toBeTruthy();
    expect(within(card).getByText("Current").className).toContain("h-9");
    expect(within(card).queryByRole("button")).toBeNull();
    expect(within(card).getAllByRole("listitem")).toHaveLength(3);
    expect(card.querySelector("p")).toBeNull();
    const unbound = "hasStripeSubscription" in changes && !changes.hasStripeSubscription;
    expect(screen.getByText(unbound ? /Available onboarding allowance \$18.00/ : /Reserved onboarding allowance \$18.00/)).toBeTruthy();
    expect(!!screen.queryByRole("switch")).toBe(!unbound);
    if (unbound) {
      expect(screen.getByText("$7.00")).toBeTruthy();
      expect(screen.getByText("$25.00")).toBeTruthy();
    }
  });
  it("shows the provider date and delegates restoration to Portal", async () => {
    const f = mount({ nextBillingDate: "2026-06-01T12:00:00Z", cancelAtPeriodEnd: true }, false);
    expect(screen.getByText("6/1/2026")).toBeTruthy();
    expect(screen.getByText("Next Billing Date")).toBeTruthy();
    expect(screen.getByText("Restore Subscription")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manage Billing" })).toBeTruthy();
    const portal = f.hold("POST", billingPath + "/portal");
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    await waitFor(() => expect(f.count("POST", billingPath + "/portal")).toBe(1));
    await release(portal, false);
    expect(await screen.findByText("Failed to open billing portal")).toBeTruthy();
  });
  it("retains the local card and recovery state without a provider date", () => {
    mount({ billingBlocked: true, portalAvailable: false, customerRecoveryState: "settlement_pending" });
    expect(screen.queryByText("Next Billing Date")).toBeNull();
    expect(screen.getByRole("button", { name: "Resolve Payment" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Current")).toBeTruthy();
    expect(screen.getByText("Manage Subscription")).toBeTruthy();
  });
  it("keeps key usage available in disabled mode", () => {
    mount({ billingEnabled: false });
    expect(screen.getByText("Billing is not enabled.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });
  it("activates once, then reads the two financial resources", async () => {
    const f = mount(free);
    const path = billingPath + "/payg/activate", gate = f.hold("POST", path);
    const activate = screen.getByRole("button", { name: "Activate PAYG" });
    fireEvent.click(activate); fireEvent.click(activate);
    expect(activate.hasAttribute("disabled")).toBe(true);
    expect(activate.getAttribute("aria-busy")).toBe("true");
    expect(activate.textContent).toBe("Activate PAYG");
    f.server.summary = baseSummary;
    await release(gate);
    expect(await screen.findByRole("button", { name: "Increase Limit" })).toBeTruthy();
    expect([f.count("POST", path), f.count("GET", billingPath), f.count("GET", limitPath), f.count("GET", prefPath)]).toEqual([1, 1, 1, 0]);
  });
  it.each([[402, "PAYMENT_REQUIRED", true], [409, "PAYMENT_METHOD_REQUIRED", true], [409, "OTHER", false]] as const)(
    "performs the activation fallback for %i/%s", async (status, code, fallback) => {
      const f = mount(free);
      f.hold("POST", billingPath + "/payg/activate").resolve(Response.json({ error: "activation failed", code }, { status }));
      fireEvent.click(screen.getByRole("button", { name: "Activate PAYG" }));
      if (fallback) await waitFor(() => expect(f.count("POST", billingPath + "/portal")).toBe(1));
      else expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Failed to activate PAYG");
    });
  it("uses the source loading surface and closes on billing read error", async () => {
    const f = billingFixture();
    f.client.clear();
    const read = f.hold("GET", billingPath), close = vi.fn();
    render(<SubscriptionSettings userId={account.id} onOpenChange={close} />, { wrapper: wrapper(f.client) });
    expect(screen.getByRole("status", { name: "Loading subscription" })).toBeTruthy();
    await release(read, false);
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
    expect(screen.queryByText("Current")).toBeNull();
  });
});
