import type postgres from "postgres";
import type { MarketDatabase } from "@tradinggoose/db";
import type Stripe from "stripe";
import { sql } from "drizzle-orm";
import { expect, vi } from "vitest";

type DirectSql = ReturnType<typeof postgres>;

/** Runs inside the existing fresh-database fixture, against its migrated schema. */
export async function assertCustomerRowLockOrder(
  monitor: DirectSql,
  applicationClient: DirectSql,
) {
  const [{ requireDatabase }, locks, customerState, creation, revocation, access, manifest, stripeClient, unkey] =
    await Promise.all([
      import("../../lib/db/runtime"),
      import("../../lib/db/locks"),
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
      providerKeys.set(key, { keyId, enabled: true });
      return { keyId, key };
    }),
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
  const stripeSpy = vi.spyOn(stripeClient, "getOptionalStripeClient")
    .mockReturnValue({
      customers: {
        retrieve: vi.fn(async () => {
          // The synchronizer has already selected its identity bridge. Its
          // joined owner must remain independently lockable while it is open.
          await monitor`
            select id from market_usage_owner
            where id = ${customer.owner_id} for update nowait
          `;
          return { id: "cus_row_lock", email: customer.email, name: customer.name };
        }),
      },
    } as unknown as Stripe);

  async function alongsideBilling<T>(operation: () => Promise<T>) {
    let pending: Promise<{ value: T } | { error: unknown }> | undefined;
    try {
      await database.transaction(async (tx) => {
        await locks.acquireBillingSubjectLock(tx, customer.id);
        await tx.execute(sql`
          select id from "user" where id = ${customer.id} for update
        `);
        const operationQueryStart = emittedQueries.length;
        pending = operation().then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
        await vi.waitFor(async () => {
          const waiting = await monitor<{ pid: number }[]>`
            select pid from pg_stat_activity
            where datname = current_database()
              and pid <> pg_backend_pid()
              and wait_event_type = 'Lock'
          `;
          expect(waiting).toHaveLength(1);
          // Check SQL emitted by the installed driver for the actual key path.
          const lockedJoin = emittedQueries.slice(operationQueryStart)
            .find((query) => /inner join/i.test(query) && /for update/i.test(query));
          expect(lockedJoin).toMatch(/for update of "user"(?:\s|$)/i);
        }, { timeout: 5_000 });
        await expect(customerState.ensureStripeUserCustomer(
          customer.id,
          tx as unknown as MarketDatabase,
        )).resolves.toMatchObject({ id: "cus_row_lock" });
      });
    } catch (error) {
      // Release the blocking identity row before awaiting the key operation,
      // including assertion-failure cleanup, so failures cannot strand clients.
      if (pending) await pending;
      throw error;
    }
    if (!pending) throw new Error("The concurrent key operation did not start");
    const result = await pending;
    if ("error" in result) throw result.error;
    return result.value;
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
