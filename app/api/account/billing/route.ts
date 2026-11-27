import { apiRequireCustomerSession } from "@/lib/auth/session";
import {
  ensureStripeUserCustomer,
  StripeCustomerSettlementPendingError,
} from "@/lib/billing/customer-state";
import type Stripe from "stripe";
import { withBillingSubjectLock } from "@/lib/db/locks";
import { requireEnabledStripeClient } from "@/lib/billing/stripe-client";
import { isFreeBinding, isPaidBinding, personalUsageLimit, readPersonalBillingState, remainingFreeAllowance } from "@/lib/billing/user-stats";
import { requireExactCurrentProviderSubscription, requireRetainedSubscriptionCustomerBridge } from "@/lib/billing/webhooks/subscription";
import type { BillingSummary } from "@/lib/account/contracts";
import { getMarketRuntimeConfig } from "@/lib/environment";
import {
  browserRouteDescriptor,
  rejectBrowserHead,
  rejectBrowserMethod,
  rejectBrowserOptions,
} from "@/lib/market-api/core/browser-route";

const TEMPLATE = "/api/account/billing";
browserRouteDescriptor(TEMPLATE, "GET");

export async function GET(request: Request) {
  const guard = await apiRequireCustomerSession(request);
  if (guard.error) return guard.error;
  const config = getMarketRuntimeConfig();
  let customer: Stripe.Customer | undefined;
  let customerRecoveryState: "ready" | "settlement_pending" | "unavailable" =
    "unavailable";
  if (config.billing.stripeSecretKey) {
    try {
      customer = await ensureStripeUserCustomer(guard.user.id);
      customerRecoveryState = "ready";
    } catch (error) {
      customerRecoveryState =
        error instanceof StripeCustomerSettlementPendingError
          ? "settlement_pending"
          : "unavailable";
      console.error("Stripe Customer summary synchronization failed", {
        userId: guard.user.id,
        errorClass: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
  const enabled = config.billing.enabled;
  const snapshot = await withBillingSubjectLock(guard.user.id, async tx => {
    const { subscription: local, stats, customerId } = await readPersonalBillingState(tx, guard.user.id);
    if (local.stripeSubscriptionId) await requireRetainedSubscriptionCustomerBridge(tx, local, local.stripeCustomerId!);
    const free = isFreeBinding(local);
    const summary: BillingSummary = {
      billingEnabled: enabled, billingBlocked: stats.billingBlocked, plan: "payg",
      rateUsdPer1000Reads: config.billing.usdPer1000Reads,
      currentPeriodRequestQuantity: Number(stats.currentPeriodRequestQuantity), currentPeriodCostUsd: stats.currentPeriodCost,
      status: local.status, cancelAtPeriodEnd: local.cancelAtPeriodEnd ?? false, customerRecoveryState,
      activationAvailable: enabled && customerRecoveryState === "ready" && free,
      portalAvailable: enabled && customerRecoveryState === "ready",
      grantedOnboardingAllowanceUsd: stats.grantedOnboardingAllowanceUsd,
      availableOnboardingAllowanceUsd: enabled && free && !stats.billingBlocked ? remainingFreeAllowance(stats) : "0",
      hasPaidSubscription: isPaidBinding(local), hasStripeSubscription: !!local.stripeSubscriptionId,
      hasPaymentMethodOnFile: !!customer && customer.id === customerId && !!customer.invoice_settings?.default_payment_method,
      nextBillingDate: null, usageLimit: personalUsageLimit(stats, enabled),
    };
    return { summary, local };
  }).catch(() => null);
  if (!snapshot) return Response.json({ error: "CUSTOMER_STATE_UNAVAILABLE" }, { status: 503 });
  const { local, summary } = snapshot;
  if (enabled && local.stripeSubscriptionId) {
    try {
      const fresh = await requireEnabledStripeClient().subscriptions.retrieve(local.stripeSubscriptionId);
      requireExactCurrentProviderSubscription(fresh, local);
      if (fresh.status !== "canceled") summary.nextBillingDate = new Date(fresh.items.data[0].current_period_end * 1000).toISOString();
    } catch {
      console.warn("Provider billing date unavailable", { subscriptionId: local.id });
    }
  }
  return Response.json(summary);
}

export const HEAD = () => rejectBrowserHead(TEMPLATE);
export const OPTIONS = () => rejectBrowserOptions(TEMPLATE);
export const POST = () => rejectBrowserMethod(TEMPLATE, "POST");
export const PUT = () => rejectBrowserMethod(TEMPLATE, "PUT");
export const PATCH = () => rejectBrowserMethod(TEMPLATE, "PATCH");
export const DELETE = () => rejectBrowserMethod(TEMPLATE, "DELETE");
