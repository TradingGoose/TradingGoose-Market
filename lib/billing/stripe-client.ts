import Stripe from "stripe";
import { getMarketRuntimeConfig } from "@/lib/environment";

let cachedSecret: string | null = null;
let cachedClient: Stripe | null = null;

export class BillingDisabledError extends Error {
  override readonly name = "BillingDisabledError";
  constructor() {
    super("Billing is disabled");
  }
}

export function getOptionalStripeClient() {
  const secret = getMarketRuntimeConfig().billing.stripeSecretKey;
  if (!secret) return null;
  if (!cachedClient || cachedSecret !== secret) {
    cachedSecret = secret;
    cachedClient = new Stripe(secret, {
      maxNetworkRetries: 0,
      timeout: 10_000,
      typescript: true,
    });
  }
  return cachedClient;
}

export function requireEnabledStripeClient() {
  const config = getMarketRuntimeConfig();
  if (!config.billing.enabled) throw new BillingDisabledError();
  const client = getOptionalStripeClient();
  if (!client) throw new Error("Enabled billing is missing its Stripe client");
  return client;
}

export function requireStripeWebhookClient() {
  const config = getMarketRuntimeConfig();
  const client = getOptionalStripeClient();
  if (!client || !config.billing.stripeWebhookSecret || !config.billing.stripePriceId) {
    throw new Error("Stripe webhook synchronization is not configured");
  }
  return {
    client,
    webhookSecret: config.billing.stripeWebhookSecret,
    priceId: config.billing.stripePriceId,
  };
}

export async function validateMarketStripePrice(
  stripe: Stripe | null = getOptionalStripeClient(),
) {
  const config = getMarketRuntimeConfig();
  if (!config.billing.stripePriceId) return null;
  if (!stripe) throw new Error("A Stripe Price requires a Stripe secret");
  const price = await stripe.prices.retrieve(config.billing.stripePriceId, {
    expand: ["product"],
  });
  const product = price.product;
  if (
    !price.active ||
    price.currency !== "usd" ||
    price.type !== "recurring" ||
    price.billing_scheme !== "per_unit" ||
    price.recurring?.interval !== "month" ||
    price.recurring.interval_count !== 1 ||
    price.recurring.usage_type !== "licensed" ||
    price.transform_quantity ||
    price.unit_amount !== 0 ||
    typeof product === "string" ||
    product.deleted ||
    !product.active
  ) {
    throw new Error("Configured Market PAYG Stripe Price is incompatible");
  }
  return price;
}
