import { apiRequireCustomerSession } from "@/lib/auth/session";
import { ensureStripeUserCustomer } from "@/lib/billing/customer-state";
import { requireEnabledStripeClient } from "@/lib/billing/stripe-client";
import { getMarketRuntimeConfig } from "@/lib/environment";
import {
  browserRouteDescriptor,
  rejectBrowserHead,
  rejectBrowserMethod,
  rejectBrowserOptions,
} from "@/lib/market-api/core/browser-route";

const TEMPLATE = "/api/account/billing/portal";
browserRouteDescriptor(TEMPLATE, "POST");

export async function POST(request: Request) {
  const guard = await apiRequireCustomerSession(request);
  if (guard.error) return guard.error;
  const config = getMarketRuntimeConfig();
  if (!config.billing.enabled) {
    return Response.json(
      { error: "Billing is disabled", code: "BILLING_DISABLED" },
      { status: 409 },
    );
  }
  try {
    const stripe = requireEnabledStripeClient();
    const customer = await ensureStripeUserCustomer(guard.user.id);
    const portal = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: `${config.appUrl}/account/api-keys?billing=updated`,
    });
    return Response.json({ url: portal.url });
  } catch (error) {
    console.error("Billing Portal creation failed", {
      userId: guard.user.id,
      errorClass: error instanceof Error ? error.name : "UnknownError",
    });
    return Response.json(
      { error: "Billing Portal is temporarily unavailable" },
      { status: 503 },
    );
  }
}

export const HEAD = () => rejectBrowserHead(TEMPLATE);
export const OPTIONS = () => rejectBrowserOptions(TEMPLATE);
export const GET = () => rejectBrowserMethod(TEMPLATE, "GET");
export const PUT = () => rejectBrowserMethod(TEMPLATE, "PUT");
export const PATCH = () => rejectBrowserMethod(TEMPLATE, "PATCH");
export const DELETE = () => rejectBrowserMethod(TEMPLATE, "DELETE");
