import type postgres from "postgres";
import type Stripe from "stripe";
import { gate } from "./private-rank-order";
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
    await reading.promise;
    const previous = emittedQueries.length;
    const result = operation();
    try {
      await vi.waitFor(async () => {
        const blocked = await monitor`
          select pid from pg_stat_activity where datname = current_database()
            and wait_event_type = 'Lock'
        `;
        expect(blocked).toHaveLength(1);
      }, { timeout: 3_000 });
      await monitor`
        select id from market_usage_owner where id = ${customer.owner_id} for update nowait
      `;
    } finally {
      resume.release();
      await syncing;
    }
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
