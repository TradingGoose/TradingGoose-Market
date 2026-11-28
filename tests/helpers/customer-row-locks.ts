import type postgres from "postgres";
import type Stripe from "stripe";
import { beforeCompletion, gate } from "./private-rank-order";
import { expect, vi } from "vitest";

type DirectSql = ReturnType<typeof postgres>;

/** Runs inside the existing fresh-database fixture, against its migrated schema. */
export async function assertCustomerRowLockOrder(
  monitor: DirectSql,
  applicationClient: DirectSql,
) {
  const [{ requireDatabase }, customerState, creation, revocation, access, manifest, stripeClient, unkey] =
    await Promise.all([
      import("../../lib/db/runtime"),
      import("../../lib/billing/customer-state"),
      import("../../lib/api-keys/creation"),
      import("../../lib/api-keys/revocation"),
      import("../../lib/market-api/core/access"),
      import("../../lib/market-api/core/manifest"),
      import("../../lib/billing/stripe-client"),
      import("../../lib/unkey/runtime"),
    ]);
  const database = requireDatabase();
  expect(database.$client).toBe(applicationClient);
  const priorDebug = applicationClient.options.debug;
  const emittedQueries: string[] = [];
  applicationClient.options.debug = (_connection, query) => {
    emittedQueries.push(query);
  };
  const [customer] = await monitor<{ id: string; owner_id: string; email: string; name: string }[]>`
    select "user".id, owner.id as owner_id, "user".email, "user".name
    from "user"
    join market_usage_owner owner on owner.user_id = "user".id
  `;
  expect(customer).toBeDefined();
  await monitor`
    update "user" set email_verified = true, stripe_customer_id = 'cus_row_lock'
    where id = ${customer.id}
  `;
  const [grant] = await monitor<{ id: string }[]>`
    insert into system_admin (user_id) values (${customer.id}) returning id
  `;

  let nextKey = 0;
  const providerKeys = new Map<string, { keyId: string; enabled: boolean }>();
  const provider = {
    createKey: vi.fn(async () => {
      const keyId = `provider_row_lock_${++nextKey}`;
      const key = `row_lock_secret_${nextKey}`;
      providerKeys.set(key, { keyId, enabled: false });
      return { keyId, key };
    }),
    enableKey: vi.fn(async (keyId: string) => {
      const key = [...providerKeys.values()].find(entry => entry.keyId === keyId);
      if (!key) throw new Error("Unknown provider key");
      key.enabled = true;
    }),
    listKeys: vi.fn(async () => [...providerKeys.values()]),
    verifyKey: vi.fn(async ({ key }: { key: string }) => {
      const known = providerKeys.get(key);
      return { valid: Boolean(known?.enabled), code: known?.enabled ? "VALID" : "NOT_FOUND", keyId: known?.keyId ?? null };
    }),
    deleteKey: vi.fn(async (keyId: string) => {
      for (const entry of providerKeys.values()) {
        if (entry.keyId === keyId) entry.enabled = false;
      }
    }),
    getKey: vi.fn(async () => null),
  };
  const providerSpy = vi.spyOn(unkey, "getMarketKeyProvider")
    .mockReturnValue(provider as unknown as ReturnType<typeof unkey.getMarketKeyProvider>);
  const retrieve = vi.fn(async () => ({
    id: "cus_row_lock", email: customer.email, name: customer.name,
  }));
  const stripeSpy = vi.spyOn(stripeClient, "getOptionalStripeClient")
    .mockReturnValue({ customers: { retrieve } } as unknown as Stripe);

  async function alongsideBilling<T>(operation: () => Promise<T>) {
    const reading = gate();
    const resume = gate();
    retrieve.mockImplementationOnce(async () => {
      reading.release();
      await resume.promise;
      return { id: "cus_row_lock", email: customer.email, name: customer.name };
    });
    const syncing = customerState.ensureStripeUserCustomer(customer.id);
    let result: Promise<T> | undefined;
    let previous: number;
    try {
      await beforeCompletion(reading.promise, syncing, "Customer retrieval");
      previous = emittedQueries.length;
      const pending = operation();
      result = pending;
      await vi.waitUntil(async () => {
        const blocked = await beforeCompletion(monitor`
          select pid from pg_stat_activity where datname = current_database()
            and wait_event_type = 'Lock'
        `, pending, "the operation waited for Customer synchronization");
        return blocked.length === 1;
      }, { timeout: 3_000 });
      await monitor`
        select id from market_usage_owner where id = ${customer.owner_id} for update nowait
      `;
    } finally {
      resume.release();
      await Promise.allSettled([syncing, result]);
    }
    await syncing;
    const value = await result;
    expect(emittedQueries.slice(previous).some(query =>
      /inner join/i.test(query) && /for update of "user"/i.test(query)
    )).toBe(true);
    return value;
  }

  try {
    const publicKey = await creation.createCustomerApiKey({
      userId: customer.id,
      name: "Concurrent customer revocation",
      allowance: { limitUsd: null, windowDays: null },
    });
    const privateKey = await creation.createAdminApiKey({
      userId: customer.id,
      adminGrantId: grant.id,
      name: "Concurrent private admission",
    });

    const publicRoute = manifest.resolveKeyedMarketRoute("/api/search/cities")!;
    const privateRoute = manifest.resolveKeyedMarketRoute("/api/update/crypto-rank")!;
    const read = await alongsideBilling(() => access.handleKeyedMarketRoute(
      new Request("http://market.test/api/search/cities?version=v1", {
        headers: { "x-api-key": publicKey.secret },
      }),
      publicRoute,
      async () => new Response(null, { status: 204 }),
    ));
    expect(read.status).toBe(204);
    const update = await alongsideBilling(() => access.handleKeyedMarketRoute(
      new Request("http://market.test/api/update/crypto-rank?version=v1", {
        method: "POST",
        headers: { "x-api-key": privateKey.secret },
      }),
      privateRoute,
      async () => new Response(null, { status: 204 }),
    ));
    expect(update.status).toBe(204);

    const minted = await alongsideBilling(() => creation.createAdminApiKey({
      userId: customer.id,
      adminGrantId: grant.id,
      name: "Concurrent private creation",
    }));
    expect(minted.secret).toBeTruthy();
    await expect(alongsideBilling(() => revocation.revokeAdminApiKey(
      minted.key.id,
      grant.id,
    ))).resolves.toEqual({ status: "revoked", retryable: false });
    await expect(alongsideBilling(() => revocation.revokeCustomerApiKey(
      customer.id,
      publicKey.key.id,
    ))).resolves.toEqual({ status: "revoked", retryable: false });

    const [tombstone] = await monitor<{
      revocation_requested_at: Date | null;
      provider_revoked_at: Date | null;
    }[]>`
      select revocation_requested_at, provider_revoked_at
      from market_api_keys where id = ${publicKey.key.id}
    `;
    expect(tombstone.revocation_requested_at).not.toBeNull();
    expect(tombstone.provider_revoked_at).not.toBeNull();
    const [usage] = await monitor<{ events: number; completions: number }[]>`
      select count(*)::integer as events,
        (select count(*)::integer from market_api_usage_completions) as completions
      from market_api_usage_events
    `;
    expect(usage).toEqual({ events: 2, completions: 2 });
  } finally {
    applicationClient.options.debug = priorDebug;
    stripeSpy.mockRestore();
    providerSpy.mockRestore();
  }
}

export async function assertBillingDateDoesNotBlockAdmission(sql: DirectSql) {
  const [environment, auth, customerState, stripeClient, unkey, access, manifest, billing, limits, runtime] = await Promise.all([
    import("../../lib/environment"), import("../../lib/auth/session"), import("../../lib/billing/customer-state"),
    import("../../lib/billing/stripe-client"), import("../../lib/unkey/runtime"), import("../../lib/market-api/core/access"),
    import("../../lib/market-api/core/manifest"), import("../../app/api/account/billing/route"),
    import("../../app/api/account/billing/usage-limit/route"), import("../../lib/db/runtime"),
  ]);
  const id = "customer_date";
  const customer = { id: "cus_date", name: "Billing date", email: "date@example.com", invoice_settings: { default_payment_method: null } };
  const end = Date.parse("2026-06-01Z") / 1000;
  const start = Date.parse("2026-05-01Z") / 1000;
  const base = environment.getMarketRuntimeConfig();
  const config = { ...base, billing: { ...base.billing, enabled: true, stripeSecretKey: "test", stripePriceId: "price_date",
    invoiceThresholdUsd: "100", onboardingAllowanceUsd: "10", requestNanoUsd: 20_000_000n, usdPer1000Reads: "20" } };
  const configured = vi.spyOn(environment, "getMarketRuntimeConfig").mockReturnValue(config);
  const lookingUp = gate();
  const release = gate();
  const provider = {
    customers: { retrieve: vi.fn(async () => customer) },
    subscriptions: { retrieve: vi.fn(async () => {
      lookingUp.release(); await release.promise;
      return { id: "sub_date", customer: customer.id, status: "active", default_payment_method: "pm_date",
        metadata: { userId: id, referenceId: id, subscriptionId: `sub_default_${id}` },
        items: { data: [{ price: { id: "price_date" }, quantity: 1, current_period_start: start, current_period_end: end }] } };
    }) },
  };
  const optional = vi.spyOn(stripeClient, "getOptionalStripeClient").mockReturnValue(provider as unknown as Stripe);
  const enabled = vi.spyOn(stripeClient, "requireEnabledStripeClient").mockReturnValue(provider as unknown as Stripe);
  const session = vi.spyOn(auth, "apiRequireCustomerSession").mockResolvedValue({ user: { id } } as never);
  const keys = vi.spyOn(unkey, "getMarketKeyProvider").mockReturnValue({ verifyKey: async ({ key }: { key: string }) =>
    ({ valid: true, code: "VALID", keyId: key }) } as unknown as ReturnType<typeof unkey.getMarketKeyProvider>);
  const descriptor = manifest.resolveKeyedMarketRoute("/api/search/countries")!;
  const read = (key: string) => access.handleKeyedMarketRoute(new Request("http://market.test/api/search/countries", {
    headers: { "x-api-key": key },
  }), descriptor, async () => new Response("ok"));
  let summary: Promise<Response> | undefined;
  let admitted: Promise<Response> | undefined;
  try {
    await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at)
      values (${id}, ${customer.name}, ${customer.email}, true, now(), now())`;
    const state = await customerState.ensureMarketCustomerState(id);
    for (const key of ["key_date_a", "key_date_b"]) {
      await sql`insert into market_api_keys (usage_owner_id, user_id, unkey_key_id, key_class, name, display_value,
        spend_limit_revision, spend_limit_updated_at)
        values (${state.usageOwner.id}, ${id}, ${key}, 'public', 'Billing date', 'test', 1, now())`;
    }
    await sql`update user_stats set current_period_cost = 9.99 where user_id = ${id}`;
    const contenders = await Promise.all([read("key_date_a"), read("key_date_b")]);
    expect(contenders.map(r => r.status).sort()).toEqual([200, 402]);
    expect(await contenders.find(r => r.status === 402)!.json()).toMatchObject({ code: "USAGE_LIMIT_EXCEEDED" });
    expect(await sql`select current_period_cost from user_stats where user_id = ${id}`).toMatchObject([{ current_period_cost: "10.01" }]);
    expect(await sql`select stripe_subscription_id from market_api_usage_events where usage_owner_id = ${state.usageOwner.id}`)
      .toMatchObject([{ stripe_subscription_id: null }]);
    expect(provider.customers.retrieve).not.toHaveBeenCalled();
    expect(enabled).not.toHaveBeenCalled();

    await sql`update "user" set stripe_customer_id = ${customer.id} where id = ${id}`;
    await sql`update subscription set stripe_customer_id = ${customer.id}, stripe_subscription_id = 'sub_date', status = 'active',
      period_start = '2026-04-01Z', period_end = '2026-05-01Z' where reference_id = ${id}`;
    await sql`update user_stats set current_period_cost = 0, current_period_request_quantity = 0, granted_onboarding_allowance_usd = 0
      where user_id = ${id}`;
    config.billing.requestNanoUsd = 1_000_000n;
    config.billing.usdPer1000Reads = "1";
    summary = billing.GET(new Request("http://market.test/api/account/billing"));
    await beforeCompletion(lookingUp.promise, summary, "provider billing date");
    admitted = read("key_date_a");
    expect((await beforeCompletion(admitted, summary, "funded admission")).status).toBe(200);
    expect(await sql`select current_period_cost, current_period_request_quantity from user_stats where user_id = ${id}`)
      .toMatchObject([{ current_period_cost: "0.001", current_period_request_quantity: "1" }]);
    expect(await sql`select billable_cost_usd from market_api_usage_events where stripe_subscription_id = 'sub_date'`)
      .toMatchObject([{ billable_cost_usd: "0.001" }]);
    release.release();
    expect(await (await summary).json()).toMatchObject({
      nextBillingDate: new Date(end*1000).toISOString(), currentPeriodCostUsd: "0", hasPaymentMethodOnFile: true,
    });

    const beforeCommit = gate(), commit = gate();
    const db = runtime.requireDatabase();
    const transaction = db.transaction.bind(db);
    const spy = vi.spyOn(db, "transaction").mockImplementationOnce((callback, options) => transaction(async tx => {
      const result = await callback(tx); beforeCommit.release(); await commit.promise; return result;
    }, options));
    let edit: Promise<Response> | undefined;
    try {
      admitted = read("key_date_b");
      await beforeCompletion(beforeCommit.promise, admitted, "admission commit");
      edit = limits.PUT(new Request("http://market.test", { method: "PUT", body: JSON.stringify({ limitUsd: "0.001" }) }));
      await vi.waitUntil(async () => {
        const [row] = await beforeCompletion(sql`select count(*)::int as waiting from pg_stat_activity
          where datname=current_database() and wait_event='advisory'`, edit!, "edit subject lock");
        return row.waiting === 1;
      }, { timeout: 3000 });
    } finally {
      commit.release(); await Promise.allSettled([admitted, edit]); spy.mockRestore();
    }
    expect((await admitted).status).toBe(200);
    expect((await edit!)?.status).toBe(400);
  } finally {
    release.release(); await Promise.allSettled([summary, admitted]);
    keys.mockRestore(); session.mockRestore(); enabled.mockRestore(); optional.mockRestore(); configured.mockRestore();
  }
}
