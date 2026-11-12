import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import Stripe from "stripe";
import { expect, vi } from "vitest";
import { usageStripeFixture } from "../billing/stripe-usage-fixture";

/** Real admission/rollback/block/recovery through the migrated Studio accumulator. */
export async function assertBillingPaymentBlock(database: ReturnType<typeof postgres>) {
  const [environment, stripeClient, keyRuntime, customerState, access, manifest, invoices] = await Promise.all([
    import("../../lib/environment"),
    import("../../lib/billing/stripe-client"),
    import("../../lib/unkey/runtime"),
    import("../../lib/billing/customer-state"),
    import("../../lib/market-api/core/access"),
    import("../../lib/market-api/core/manifest"),
    import("../../lib/billing/webhooks/invoices"),
  ]);
  const userId = `payment_block_${randomUUID()}`;
  const customerId = "cus_1";
  const providerId = "sub_provider";
  const priceId = "price_payment_block";
  await database`
    insert into "user" (id, name, email, email_verified, stripe_customer_id, created_at, updated_at)
    values (${userId}, 'Payment block', ${`${userId}@example.com`}, true, ${customerId}, now(), now())
  `;
  const customer = await customerState.ensureMarketCustomerState(userId);
  const start = Math.floor(Date.now() / 1000) - 86_400;
  const end = start + 2 * 86_400;
  await database`
    update subscription set status = 'active', stripe_customer_id = ${customerId},
      stripe_subscription_id = ${providerId}, period_start = ${new Date(start * 1000)},
      period_end = ${new Date(end * 1000)} where id = ${customer.subscription.id}
  `;
  const keyId = `payment_key_${randomUUID()}`;
  await database`
    insert into market_api_keys (id, usage_owner_id, user_id, unkey_key_id, key_class, name, display_value,
      spend_limit_revision, spend_limit_updated_at)
    values (${keyId}, ${customer.usageOwner.id}, ${userId}, ${`provider_${keyId}`},
      'public', 'Payment block', 'tg_payment_masked', 1, now())
  `;
  const stripe = usageStripeFixture();
  stripe.subscriptionRetrieve.mockResolvedValue({
    id: providerId, customer: customerId, status: "active", default_payment_method: "pm_subscription",
    metadata: { userId, referenceId: userId, subscriptionId: customer.subscription.id },
    items: { data: [{ price: { id: priceId }, quantity: 1, current_period_start: start, current_period_end: end }] },
  } as unknown as Awaited<ReturnType<typeof stripe.subscriptionRetrieve>>);
  stripe.payInvoice.mockRejectedValueOnce(new Stripe.errors.StripeCardError({
    type: "card_error", code: "card_declined", message: "Your card was declined",
  }));
  const baseConfig = environment.getMarketRuntimeConfig();
  const enabledConfig = {
    ...baseConfig,
    billing: {
      ...baseConfig.billing, enabled: true, stripePriceId: priceId,
      invoiceThresholdUsd: "0.001", usdPer1000Reads: "1", requestNanoUsd: 1_000_000n,
    },
  };
  const configSpy = vi.spyOn(environment, "getMarketRuntimeConfig").mockReturnValue(enabledConfig);
  const stripeSpy = vi.spyOn(stripeClient, "requireEnabledStripeClient").mockReturnValue(stripe.client);
  const provider = {
    verifyKey: vi.fn(async () => ({
      valid: true, code: "VALID", keyId: `provider_${keyId}`,
      permissions: ["market.public"], ratelimits: [],
    })),
  } as unknown as ReturnType<typeof keyRuntime.getMarketKeyProvider>;
  const keySpy = vi.spyOn(keyRuntime, "getMarketKeyProvider").mockReturnValue(provider);
  const handler = vi.fn(async () => Response.json({ ok: true }));
  const route = manifest.resolveKeyedMarketRoute("/api/search/countries")!;
  const request = () => new Request("http://market.test/api/search/countries?version=v1", {
    headers: { "x-api-key": "tg_payment_test" },
  });
  async function stats() {
    const [result] = await database<{
      billing_blocked: boolean; cost: string; billed: string; quantity: string; events: number;
    }[]>`
      select billing_blocked, current_period_cost::text as cost,
        billed_overage_this_period::text as billed,
        current_period_request_quantity::text as quantity,
        (select count(*)::integer from market_api_usage_events where market_api_key_id = ${keyId}) as events
      from user_stats where user_id = ${userId}
    `;
    return result;
  }
  try {
    for (let read = 0; read < 10; read++) {
      expect((await access.handleKeyedMarketRoute(request(), route, handler)).status).toBe(200);
    }
    expect(await stats()).toMatchObject({ billing_blocked: true, quantity: "10", billed: "0", events: 10 });
    expect(Number((await stats()).cost)).toBe(0.01);
    for (let read = 0; read < 3; read++) {
      const denied = await access.handleKeyedMarketRoute(request(), route, handler);
      expect(denied.status).toBe(402);
      expect(await denied.json()).toMatchObject({ code: "BILLING_REQUIRED" });
    }
    expect(handler).toHaveBeenCalledTimes(10);
    expect((await stats()).events).toBe(10);
    expect(stripe.charges).toEqual([]);
    const invoice = [...stripe.invoices.values()][0];
    expect(invoice.status).toBe("open");
    const delayedFailure = structuredClone(invoice);
    // The global disabled mode remains ungated and never adds billable cost.
    configSpy.mockReturnValue({ ...enabledConfig, billing: { ...enabledConfig.billing, enabled: false } });
    expect((await access.handleKeyedMarketRoute(request(), route, handler)).status).toBe(200);
    expect(await stats()).toMatchObject({ billing_blocked: true, quantity: "10", events: 11 });
    configSpy.mockReturnValue(enabledConfig);
    await stripe.payInvoice(invoice.id, { payment_method: "pm_repaired" });
    await invoices.handleMarketUsageInvoicePayment(stripe.client, structuredClone(invoice));
    expect((await stats()).billing_blocked).toBe(false);
    expect((await access.handleKeyedMarketRoute(request(), route, handler)).status).toBe(200);
    expect(await stats()).toMatchObject({ billing_blocked: false, quantity: "11", events: 12 });
    expect(Number((await stats()).billed)).toBe(0.01);
    expect(Number((await stats()).cost)).toBe(0.011);
    expect(stripe.charges).toEqual([1]);
    // Model the router's post-rollback projector losing the lock to Portal and
    // invoice.paid, rather than merely a reordered signed failure delivery.
    await invoices.handleMarketUsageInvoicePayment(stripe.client, delayedFailure);
    expect((await stats()).billing_blocked).toBe(false);
    // Reconciliation of this paid invoice must not forgive another real debt.
    const otherDebt = structuredClone(invoice);
    otherDebt.id = "in_other_debt";
    otherDebt.status = "open";
    stripe.invoices.set(otherDebt.id, otherDebt);
    await database`update user_stats set billing_blocked = true where user_id = ${userId}`;
    await invoices.handleMarketUsageInvoicePayment(stripe.client, delayedFailure);
    expect((await stats()).billing_blocked).toBe(true);
  } finally {
    keySpy.mockRestore();
    stripeSpy.mockRestore();
    configSpy.mockRestore();
  }
}
