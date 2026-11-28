import { expect, it } from "vitest";
import { formatBillingUsd, getPersonalPaygAction, usagePills } from "@/lib/account/billing-presentation";

it.each([[0.49, 0], [0.5, 1], [28, 3], [87, 7], [87.5, 8], [101, 8]])("renders rounded %s percent", (percent, filled) => {
  expect(usagePills(percent)).toEqual([...Array(filled).fill(filled === 8 ? "#ef4444" : "#ffcc00"), ...Array(8-filled).fill("#88888850")]);
});
it("uses source USD formatting and prioritizes payment recovery", () => {
  expect(formatBillingUsd("25")).toBe("$25.00");
  const base = { billingBlocked: false, status: null, hasPaymentMethodOnFile: true, hasStripeSubscription: true };
  expect(getPersonalPaygAction(base, true)).toBe("Increase Limit");
  expect(getPersonalPaygAction(base, false)).toBe("Manage Billing");
  expect(getPersonalPaygAction({ ...base, hasStripeSubscription: false }, false)).toBe("Activate PAYG");
  expect(getPersonalPaygAction({ ...base, hasPaymentMethodOnFile: false }, true)).toBe("Add Payment Method");
  expect(getPersonalPaygAction({ ...base, status: "unpaid", hasPaymentMethodOnFile: false }, true)).toBe("Resolve Payment");
});
