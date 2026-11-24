import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import Stripe from "stripe";
import { expect, vi } from "vitest";
import { gate } from "./private-rank-order";
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
  const active = {
    id: providerId, customer: customerId, status: "active", default_payment_method: "pm_subscription",
    metadata: { userId, referenceId: userId, subscriptionId: customer.subscription.id },
    items: { data: [{ price: { id: priceId }, quantity: 1, current_period_start: start, current_period_end: end }] },
  } as unknown as Stripe.Subscription;
  stripe.subscriptionRetrieve.mockResolvedValue(active as Awaited<ReturnType<typeof stripe.subscriptionRetrieve>>);
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
    // A delayed failure delivery rereads the paid invoice.
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

    stripe.invoices.delete(otherDebt.id);
    await invoices.handleMarketUsageInvoicePayment(stripe.client, delayedFailure);
    const read = () => access.handleKeyedMarketRoute(request(), route, handler);
    const setRate = (rate: string, cost: bigint, threshold = "0.01") => configSpy.mockReturnValue({
      ...enabledConfig,
      billing: { ...enabledConfig.billing, invoiceThresholdUsd: threshold, usdPer1000Reads: rate, requestNanoUsd: cost },
    });
    for (const point of ["invoice", "item", "finalize", "pay", "commit"] as const) {
      const before = await stats();
      const count = stripe.invoices.size;
      setRate("10", 10_000_000n);
      if (point === "commit") {
        await database`create function reject_billed_commit() returns trigger language plpgsql as $$
          begin raise exception 'fixture rejects local billed watermark commit'; end $$`;
        await database`create constraint trigger reject_billed_commit after update on user_stats
          deferrable initially deferred for each row
          when (new.billed_overage_this_period > old.billed_overage_this_period)
          execute function reject_billed_commit()`;
      } else {
        stripe.state.lostResponse = point;
      }
      try {
        expect((await read()).status).toBe(200);
      } finally {
        if (point === "commit") {
          await database`drop trigger reject_billed_commit on user_stats`;
          await database`drop function reject_billed_commit()`;
        }
      }
      const failed = await stats();
      expect(failed.events).toBe(before.events + 1);
      expect(failed.billed).toBe(before.billed);
      expect(stripe.invoices.size).toBe(count + 1);
      setRate("1", 1_000_000n);
      expect((await read()).status).toBe(200);
      const recovered = await stats();
      expect(recovered.events).toBe(failed.events + 1);
      expect(Number(recovered.billed)).toBe(Number(failed.cost));
      expect(stripe.invoices.size).toBe(count + 1);
      expect(stripe.items).toHaveLength(count + 1);
      expect(stripe.charges).toHaveLength(count + 1);
    }

    setRate("1000", 1_000_000_000n, "99999");
    await assertSpendConcurrency(database, userId, customer.usageOwner.id);

    setRate("10", 10_000_000n);
    const { handleMarketSubscriptionDeleted } = await import("../../lib/billing/webhooks/subscription");
    const next = structuredClone(active);
    next.items.data[0].current_period_start = end;
    next.items.data[0].current_period_end = end + 86_400;
    const cycle = {
      billing_reason: "subscription_cycle", customer: customerId, period_start: start, period_end: end,
      parent: { subscription_details: { subscription: providerId } },
    } as Stripe.Invoice;
    for (const delivery of ["cycle", "deletion"] as const) {
      const before = stripe.invoices.size;
      const create = stripe.invoiceCreate.getMockImplementation()!;
      const snapshot = { ...next, status: "canceled" as const };
      const [admitted] = await whileProviderPaused(database, (pause) => {
        stripe.invoiceCreate.mockImplementationOnce(async (...args) => {
          const created = await create(...args);
          await pause();
          if (delivery === "deletion") throw new Error("Threshold create reply lost");
          return created;
        });
        return read();
      }, () => {
        // The next-period or canceled snapshot becomes live during the prior threshold request.
        stripe.subscriptionRetrieve.mockResolvedValue(next as Awaited<ReturnType<typeof stripe.subscriptionRetrieve>>);
        const deliver = () => delivery === "cycle"
          ? invoices.handleMarketCycleInvoiceFinalized(stripe.client, cycle)
          : handleMarketSubscriptionDeleted(stripe.client, snapshot);
        if (delivery === "deletion") {
          const pay = stripe.payInvoice.getMockImplementation()!;
          stripe.payInvoice.mockImplementationOnce(async (...args) => {
            const [binding] = await database`select status, stripe_subscription_id from subscription where id = ${customer.subscription.id}`;
            expect(binding).toEqual({ status: "canceled", stripe_subscription_id: providerId });
            return pay(...args);
          });
        }
        return Promise.all([deliver(), deliver()]);
      }, 2);
      expect(admitted.status).toBe(200);
      expect(stripe.invoices.size).toBe(before + 1);
      expect(stripe.items).toHaveLength(before + 1);
      expect(stripe.charges).toHaveLength(before + 1);
      const [local] = await database`select status, period_end, stripe_subscription_id from subscription where id = ${customer.subscription.id}`;
      if (delivery === "cycle") {
        expect(local).toMatchObject({ status: "active", stripe_subscription_id: providerId });
        expect(new Date(local.period_end).getTime()).toBe((end + 86_400) * 1000);
      } else {
        expect(local).toMatchObject({ status: "canceled", stripe_subscription_id: null });
      }
      expect((await stats()).quantity).toBe("0");
    }
  } finally {
    keySpy.mockRestore();
    stripeSpy.mockRestore();
    configSpy.mockRestore();
  }
}

/** The competing application requests must actually be waiting on the production lock. */
async function whileProviderPaused<T, U>(
  database: ReturnType<typeof postgres>,
  request: (pause: () => Promise<void>) => Promise<T>,
  contend: () => Promise<U>,
  waiters = 1,
): Promise<[T, U]> {
  const entered = gate();
  const resume = gate();
  const first = request(() => {
    entered.release();
    return resume.promise;
  });
  let second: Promise<U> | undefined;
  try {
    await Promise.race([entered.promise, first.then(() => { throw new Error("Request missed its provider barrier"); })]);
    second = contend();
    await vi.waitFor(async () => {
      const [{ count }] = await database`select count(*)::int as count from pg_stat_activity
        where datname = current_database() and wait_event = 'advisory'`;
      expect(count).toBe(waiters);
    }, { timeout: 4_000 });
  } finally {
    resume.release();
    await Promise.allSettled([first, second]);
  }
  return Promise.all([first, second]);
}

async function assertSpendConcurrency(database: ReturnType<typeof postgres>, userId: string, ownerId: string) {
  const [keyRuntime, service, revocation, access, manifest] = await Promise.all([
    import("../../lib/unkey/runtime"), import("../../lib/api-keys/service"), import("../../lib/api-keys/revocation"),
    import("../../lib/market-api/core/access"), import("../../lib/market-api/core/manifest"),
  ]);
  const keyId = "spend_key";
  const providerId = "spend_provider";
  await database`insert into market_api_keys (id, usage_owner_id, user_id, unkey_key_id, key_class, name,
    display_value, spend_limit_revision, spend_limit_updated_at, spend_limit_usd, spend_window_days)
    values (${keyId}, ${ownerId}, ${userId}, ${providerId}, 'public', 'Capped', 'masked', 1, now(), 1, 1)`;
  const [{ baseline }] = await database`select total_request_quantity::int as baseline from user_stats where user_id = ${userId}`;
  let consumed = 0;
  let loseReply = false;
  let resetDuringConsume = false;
  let pause: (() => Promise<void>) | undefined;
  const provider = {
    async verifyKey({ ratelimit }: { ratelimit?: { name: string; cost: number; duration: number; limit: number } }) {
      if (ratelimit?.cost && resetDuringConsume) {
        resetDuringConsume = false;
        consumed = 0;
      }
      const exceeded = Boolean(ratelimit && consumed + ratelimit.cost > ratelimit.limit);
      if (ratelimit?.cost && !exceeded) {
        consumed += ratelimit.cost;
        if (loseReply) {
          loseReply = false;
          throw new Error("Consume reply lost");
        }
        const pending = pause;
        pause = undefined;
        await pending?.();
      }
      return {
        valid: !exceeded, code: exceeded ? "RATE_LIMITED" : "VALID", keyId: providerId,
        permissions: ["market.public"],
        ratelimits: ratelimit ? [{ ...ratelimit, autoApply: false, exceeded, reset: Date.now() + ratelimit.duration,
          remaining: Math.max(0, ratelimit.limit - consumed) }] : [],
      };
    },
    deleteKey: vi.fn(),
    getKey: vi.fn(async () => null),
  };
  const prior = keyRuntime.getMarketKeyProvider();
  const spy = vi.mocked(keyRuntime.getMarketKeyProvider);
  spy.mockReturnValue(provider as unknown as typeof prior);
  const descriptor = manifest.resolveKeyedMarketRoute("/api/search/countries")!;
  const handler = vi.fn(async () => new Response());
  const read = () => access.handleKeyedMarketRoute(new Request("http://market.test/api/search/countries?version=v1", {
    headers: { "x-api-key": "spend_secret" },
  }), descriptor, handler);
  const heldRead = (hold: () => Promise<void>) => { pause = hold; return read(); };
  const edit = (revision: number, limit: string) => service.updateCustomerApiKeyAllowance({
    keyId, userId, expectedRevision: revision, allowance: { limitUsd: limit, windowDays: 1 },
  });
  async function totals() {
    const [row] = await database`select count(e.id)::int as events, coalesce(sum(e.billable_cost_usd), 0)::int as cost,
      k.provider_remaining_units, k.spend_limit_revision as revision, k.provider_observed_revision as observed,
      k.provider_decision as decision, stats.total_request_quantity::int - ${baseline} as accrued
      from market_api_keys k join user_stats stats on stats.user_id = k.user_id
      left join market_api_usage_events e on e.market_api_key_id = k.id
      where k.id = ${keyId} group by k.id, stats.id`;
    return row;
  }
  try {
    const [winner, denied] = await whileProviderPaused(database, heldRead, read);
    expect([winner.status, denied.status]).toEqual([200, 429]);
    expect(await totals()).toMatchObject({ cost: 1, events: 1, accrued: 1, observed: 1, revision: 1,
      provider_remaining_units: "0", decision: "rate_limited" });

    // Unkey's window resets between the probe and consume. The exact ledger is still full.
    resetDuringConsume = true;
    expect((await read()).status).toBe(429);
    expect(await totals()).toMatchObject({ cost: 1, events: 1, accrued: 1, decision: "allowed" });
    await edit(1, "2");
    const [last] = await whileProviderPaused(database, heldRead, () => edit(2, "3"));
    expect(last.status).toBe(200);
    expect(await totals()).toMatchObject({ cost: 2, events: 2, accrued: 2, observed: 2, revision: 3 });
    loseReply = true;
    expect((await read()).status).toBe(503);
    expect(consumed).toBe(3_000_000_000);
    expect((await read()).status).toBe(429);
    expect(await totals()).toMatchObject({ cost: 2, events: 2, accrued: 2, observed: 3, provider_remaining_units: "0" });
    await edit(3, "4");
    const [accepted, revoked] = await whileProviderPaused(database, heldRead, () => revocation.revokeCustomerApiKey(userId, keyId));
    expect(accepted.status).toBe(200);
    expect(revoked.status).toBe("revoked");
    expect((await read()).status).toBe(403);
    expect(await totals()).toMatchObject({ cost: 3, events: 3, accrued: 3, observed: 4, revision: 4 });
    expect(handler).toHaveBeenCalledTimes(3);
  } finally {
    spy.mockReturnValue(prior);
  }
}
