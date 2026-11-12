import {
  constructMarketStripeEvent,
  dispatchMarketStripeEvent,
} from "@/lib/billing/webhooks/router";
import {
  browserRouteDescriptor,
  rejectBrowserHead,
  rejectBrowserMethod,
  rejectBrowserOptions,
} from "@/lib/market-api/core/browser-route";

const TEMPLATE = "/api/billing/stripe/webhook";
browserRouteDescriptor(TEMPLATE, "POST");

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ error: "Missing signature" }, { status: 400 });
  }
  try {
    const event = constructMarketStripeEvent(await request.text(), signature);
    await dispatchMarketStripeEvent(event);
    return Response.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook processing failed", {
      errorClass: error instanceof Error ? error.name : "UnknownError",
    });
    return Response.json({ error: "Webhook processing failed" }, { status: 400 });
  }
}

export const HEAD = () => rejectBrowserHead(TEMPLATE);
export const OPTIONS = () => rejectBrowserOptions(TEMPLATE);
export const GET = () => rejectBrowserMethod(TEMPLATE, "GET");
export const PUT = () => rejectBrowserMethod(TEMPLATE, "PUT");
export const PATCH = () => rejectBrowserMethod(TEMPLATE, "PATCH");
export const DELETE = () => rejectBrowserMethod(TEMPLATE, "DELETE");
