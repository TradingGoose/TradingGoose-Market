import { decimalUsdToNanoUsd, nanoUsdToDecimalUsd } from "@/lib/billing/money";
import type { BillingSummary } from "./contracts";

export const billingCopy = {
  disabled: "Billing is not enabled.",
  paymentFailed: "Payment failed. Please update your payment method.",
  limitExceeded: "Usage limit exceeded. Increase your limit to continue.",
} as const;

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
export const formatBillingUsd = (amount: number | string) => currency.format(Number(amount));

export function usageLimitSummary(currentUsd: string, limit: bigint | null, billingBlocked: boolean): BillingSummary["usageLimit"] {
  if (limit === null) return { currentLimitUsd: null, isExceeded: false, percentUsed: 0, status: "ok" };
  const current = decimalUsdToNanoUsd(currentUsd);
  const isExceeded = current >= limit;
  return {
    currentLimitUsd: nanoUsdToDecimalUsd(limit), isExceeded,
    percentUsed: limit > 0n ? Number(current) / Number(limit) * 100 : 0,
    status: billingBlocked ? "blocked" : isExceeded ? "exceeded" : current * 100n >= limit * 80n ? "warning" : "ok",
  };
}

export function usagePills(percentUsed: number) {
  const rounded = Math.min(100, Math.max(0, Math.round(percentUsed)));
  const filled = Math.ceil(rounded / 100 * 8);
  return Array.from({ length: 8 }, (_, i) => i >= filled ? "#88888850" : filled === 8 ? "#ef4444" : "#ffcc00");
}

const paymentResolutionStatuses = new Set(["past_due", "incomplete", "incomplete_expired", "unpaid"]);

export function getPersonalPaygAction(data: Pick<BillingSummary, "billingBlocked" | "status" | "hasPaymentMethodOnFile" | "hasStripeSubscription">, canEdit: boolean) {
  if (data.billingBlocked || paymentResolutionStatuses.has(data.status ?? "")) return "Resolve Payment";
  if (!data.hasPaymentMethodOnFile) return "Add Payment Method";
  if (!data.hasStripeSubscription) return "Activate PAYG";
  return canEdit ? "Increase Limit" : "Manage Billing";
}
