import { apiRequireCustomerSession } from "@/lib/auth/session";
import {
  ensureMarketCustomerState,
  ensureStripeUserCustomer,
  StripeCustomerSettlementPendingError,
} from "@/lib/billing/customer-state";
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
  const state = await ensureMarketCustomerState(guard.user.id);
  let customerRecoveryState: "ready" | "settlement_pending" | "unavailable" =
    "unavailable";
  if (config.billing.stripeSecretKey) {
    try {
      await ensureStripeUserCustomer(guard.user.id);
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
  const subscription = state.subscription;
  const stats = state.userStats;
  return Response.json({
    billingEnabled: config.billing.enabled,
    plan: "payg",
    rateUsdPer1000Reads: config.billing.usdPer1000Reads,
    currentPeriodRequestQuantity: Number(stats.currentPeriodRequestQuantity),
    currentPeriodCostUsd: stats.currentPeriodCost,
    status: subscription.status,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd ?? false,
    customerRecoveryState,
    activationAvailable:
      config.billing.enabled &&
      customerRecoveryState === "ready" &&
      subscription.stripeSubscriptionId === null,
    portalAvailable:
      config.billing.enabled &&
      customerRecoveryState === "ready",
  });
}

export const HEAD = () => rejectBrowserHead(TEMPLATE);
export const OPTIONS = () => rejectBrowserOptions(TEMPLATE);
export const POST = () => rejectBrowserMethod(TEMPLATE, "POST");
export const PUT = () => rejectBrowserMethod(TEMPLATE, "PUT");
export const PATCH = () => rejectBrowserMethod(TEMPLATE, "PATCH");
export const DELETE = () => rejectBrowserMethod(TEMPLATE, "DELETE");
