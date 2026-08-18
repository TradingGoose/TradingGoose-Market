import type Stripe from "stripe";
import {
  requireStripeWebhookClient,
  validateMarketStripePrice,
} from "../stripe-client";
import { handleMarketCycleInvoiceFinalized } from "./invoices";
import {
  handleMarketSubscriptionDeleted,
  handleMarketSubscriptionProjection,
} from "./subscription";

export function constructMarketStripeEvent(rawBody: string, signature: string) {
  const { client, webhookSecret } = requireStripeWebhookClient();
  return client.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

export async function dispatchMarketStripeEvent(event: Stripe.Event) {
  const { client } = requireStripeWebhookClient();
  await validateMarketStripePrice(client);
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await handleMarketSubscriptionProjection(client, event.data.object.id);
      return;
    case "customer.subscription.deleted":
      await handleMarketSubscriptionDeleted(client, event.data.object);
      return;
    case "invoice.finalized":
      await handleMarketCycleInvoiceFinalized(client, event.data.object);
      return;
    default:
      return;
  }
}
