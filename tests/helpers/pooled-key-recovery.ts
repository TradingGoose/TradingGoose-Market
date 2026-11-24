import type postgres from "postgres";
import { expect, vi } from "vitest";
import { gate } from "./private-rank-order";

/** Provider state outlives each request and each rolled-back DB transaction. */
export async function assertPooledKeyRecovery(observer: ReturnType<typeof postgres>) {
  const [unkey, create, revoke, admin, runtime, customer, access, manifest] = await Promise.all([
    import("../../lib/unkey/runtime"),
    import("../../lib/api-keys/creation"),
    import("../../lib/api-keys/revocation"),
    import("../../scripts/manage-market-admin"),
    import("../../lib/db/runtime"),
    import("../../lib/billing/customer-state"),
    import("../../lib/market-api/core/access"),
    import("../../lib/market-api/core/manifest"),
  ]);
  const userId = "key_recovery_user";
  await observer`
    insert into "user" (id, name, email, email_verified, created_at, updated_at)
    values (${userId}, 'Key recovery', 'key-recovery@example.com', true, now(), now())
  `;
  await customer.ensureMarketCustomerState(userId);
  const [{ id: grantId }] = await observer<{ id: string }[]>`
    insert into system_admin (user_id) values (${userId}) returning id
  `;
  type Remote = { keyId: string; enabled: boolean; meta: { marketCorrelationId: string } };
  const keys = new Map<string, Remote>();
  const secrets = new Map<string, string>();
  const allocate = (correlationId: string) => {
    const keyId = crypto.randomUUID();
    const key = `provider-secret-${crypto.randomUUID()}`;
    keys.set(keyId, { keyId, enabled: false, meta: { marketCorrelationId: correlationId } });
    secrets.set(key, keyId);
    return { key, keyId };
  };
  const provider = {
    createKey: vi.fn(async ({ correlationId }: { correlationId: string }) => {
      const pending = await observer`
        select state, dispatched_at from market_api_key_creation_attempts where correlation_id = ${correlationId}
      `;
      expect(pending).toMatchObject([{ state: "dispatched", dispatched_at: expect.any(Date) }]);
      return allocate(correlationId);
    }),
    enableKey: vi.fn(async (id: string) => {
      const key = keys.get(id);
      if (!key) throw Error("Deleted key");
      key.enabled = true;
    }),
    listKeys: vi.fn(async () => [...keys.values()]),
    deleteKey: vi.fn(async (id: string) => { keys.delete(id); }),
    getKey: vi.fn(async (id: string) => keys.get(id) ?? null),
    verifyKey: vi.fn(async ({ key }: { key: string }) => {
      const remote = keys.get(secrets.get(key) ?? "");
      return { valid: !!remote?.enabled, keyId: remote?.keyId ?? null, code: remote?.enabled ? "VALID" : "NOT_FOUND" };
    }),
  };
  const spy = vi.spyOn(unkey, "getMarketKeyProvider")
    .mockReturnValue(provider as unknown as ReturnType<typeof unkey.getMarketKeyProvider>);
  const db = runtime.requireDatabase();
  const transaction = db.transaction.bind(db);
  const publicKey = () => create.createCustomerApiKey({
    userId, name: "Recovery", allowance: { limitUsd: null, windowDays: null },
  });
  const privateKey = () => create.createAdminApiKey({ userId, name: "Recovery", adminGrantId: grantId });
  const attempts = () => observer`select * from market_api_key_creation_attempts where user_id = ${userId}`;
  const mappings = () => observer`select * from market_api_keys where user_id = ${userId}`;
  const unused = async () => {
    const live = (await mappings()).filter(key => !key.revocation_requested_at);
    expect([...keys.values()].filter(key => key.enabled).map(key => key.keyId).sort())
      .toEqual(live.map(key => key.unkey_key_id).sort());
  };
  const createNormally = provider.createKey.getMockImplementation()!;
  const enableNormally = provider.enableKey.getMockImplementation()!;
  // Pause the originator after a real COMMIT, with both advisory locks released.
  function pauseAfterCommit(skipDispatch = false) {
    const committed = gate();
    const resume = gate();
    const spy = vi.spyOn(db, "transaction");
    if (skipDispatch) spy.mockImplementationOnce(transaction);
    spy.mockImplementationOnce(async (callback, options) => {
      spy.mockRestore();
      const result = await transaction(callback, options);
      committed.release();
      await resume.promise;
      return result;
    });
    return { committed: committed.promise, resume: resume.release };
  }
  async function waitForContender() {
    await vi.waitFor(async () => {
      const rows = await observer`
        select pid from pg_stat_activity where datname = current_database()
          and wait_event_type = 'Lock' and query like '%pg_advisory_xact_lock%'
      `;
      expect(rows.length).toBeGreaterThan(0);
    });
  }
  async function requestKey(secret: string, isPrivate: boolean) {
    const path = isPrivate ? "/api/update/currency-rank" : "/api/search/cities";
    return access.handleKeyedMarketRoute(new Request(`http://market.test${path}?version=v1`, {
      method: isPrivate ? "POST" : "GET", headers: { "x-api-key": secret },
    }), manifest.resolveKeyedMarketRoute(path)!, async () => new Response(null, { status: 204 }));
  }
  try {
    // A delayed create becomes visible only after the failed caller's empty
    // cleanup scan. The immutable provider ID is safe to reclaim once unowned.
    let delayedCorrelation = "";
    provider.createKey.mockImplementationOnce(async ({ correlationId }) => {
      delayedCorrelation = correlationId;
      throw Error("create reply lost");
    });
    await expect(publicKey()).rejects.toThrow();
    expect(await attempts()).toHaveLength(0);
    const late = allocate(delayedCorrelation);
    expect(keys.get(late.keyId)?.enabled).toBe(false);
    const [owned] = await observer`
      select exists(select from market_api_key_creation_attempts where correlation_id = ${delayedCorrelation})
        or exists(select from market_api_keys where unkey_key_id = ${late.keyId}) as owned
    `;
    expect(owned.owned).toBe(false);
    await provider.deleteKey(late.keyId);

    // Fail after an enable took effect. An incomplete cleanup must fence a
    // replacement until another request reconciles the same provider identity.
    provider.enableKey.mockImplementationOnce(async id => {
      await enableNormally(id);
      throw Error("enable reply lost");
    });
    provider.listKeys.mockRejectedValueOnce(Error("inventory unavailable"));
    await expect(publicKey()).rejects.toThrow();
    expect(await attempts()).toHaveLength(1);
    const calls = provider.createKey.mock.calls.length;
    await expect(publicKey()).rejects.toThrow();
    expect(provider.createKey).toHaveBeenCalledTimes(calls);
    expect(await attempts()).toHaveLength(0);
    await unused();

    // The mapping transaction can roll back, or commit and lose its reply.
    for (const committed of [false, true]) {
      let fault = true;
      const txn = vi.spyOn(db, "transaction").mockImplementation(async (callback, options) => {
        const before = provider.enableKey.mock.calls.length;
        const result = await transaction(async tx => {
          const value = await callback(tx);
          if (fault && !committed && before !== provider.enableKey.mock.calls.length) {
            fault = false;
            throw Error("mapping rolled back");
          }
          return value;
        }, options);
        if (fault && committed && before !== provider.enableKey.mock.calls.length) {
          fault = false;
          throw Error("mapping commit reply lost");
        }
        return result;
      });
      try {
        if (committed) {
          const result = await publicKey();
          expect((await requestKey(result.secret, false)).status).toBe(204);
          expect(JSON.stringify(await mappings())).not.toContain(result.secret);
        } else {
          await expect(publicKey()).rejects.toThrow();
        }
        expect(fault).toBe(false);
      } finally {
        txn.mockRestore();
      }
      await unused();
    }

    // After the originator exits, the listed mapping is durable and masked.
    // A fresh caller can revoke it and receive a new secret only by creating a replacement.
    const lost = await publicKey();
    const service = await import("../../lib/api-keys/service");
    const listed = (await service.listCustomerApiKeys(userId)).find(key => key.id === lost.key.id);
    expect(listed?.displayValue).toBe(create.maskRawKey(lost.secret));
    expect(JSON.stringify(listed)).not.toContain(lost.secret);
    expect(await revoke.revokeCustomerApiKey(userId, lost.key.id)).toMatchObject({ status: "revoked" });
    const replacement = await publicKey();
    expect(replacement.secret).not.toBe(lost.secret);

    for (const issue of [publicKey, privateKey]) {
      const createdBefore = provider.createKey.mock.calls.length;
      const enabledBefore = provider.enableKey.mock.calls.length;
      const deletedBefore = provider.deleteKey.mock.calls.length;
      const dispatch = pauseAfterCommit();
      const original = issue();
      try {
        await Promise.race([dispatch.committed, original]);
        const [pending] = await attempts();
        expect(pending.provider_key_id).toBeNull();
        await expect(issue()).rejects.toThrow("already in progress");
        expect(await attempts()).toEqual([pending]);

        // Advance the fixture past the initial lease. The provider result
        // must renew it before another request observes that committed ID.
        await observer`
          update market_api_key_creation_attempts set dispatched_at = now() - interval '2 minutes',
            updated_at = now() - interval '2 minutes' where id = ${pending.id}
        `;
        const projection = pauseAfterCommit();
        dispatch.resume();
        try {
          await Promise.race([projection.committed, original]);
          const [projected] = await attempts();
          expect(projected.id).toBe(pending.id);
          expect(projected.updated_at.getTime() - projected.dispatched_at.getTime()).toBeGreaterThan(60_000);
          expect(keys.get(projected.provider_key_id)?.enabled).toBe(false);
          await expect(issue()).rejects.toThrow("already in progress");
          expect(await attempts()).toEqual([projected]);
        } finally {
          projection.resume();
        }
      } finally {
        dispatch.resume();
        await Promise.allSettled([original]);
      }
      const issued = await original;
      const providerId = secrets.get(issued.secret);
      expect(keys.get(providerId!)?.enabled).toBe(true);
      expect((await mappings()).filter(key => key.unkey_key_id === providerId)).toMatchObject([{ id: issued.key.id }]);
      expect(provider.createKey).toHaveBeenCalledTimes(createdBefore + 1);
      expect(provider.enableKey).toHaveBeenCalledTimes(enabledBefore + 1);
      expect(provider.deleteKey).toHaveBeenCalledTimes(deletedBefore);
      expect(await attempts()).toHaveLength(0);
      await unused();
    }

    // Recovery wins the lock after an originator stalls with a projected ID.
    // Even if it resumes after replacement, it cannot enable or delete that key.
    const stalled = pauseAfterCommit(true);
    const stale = publicKey();
    try {
      await Promise.race([stalled.committed, stale]);
      const [prior] = await attempts();
      expect(keys.get(prior.provider_key_id)?.enabled).toBe(false);
      await observer`
        update market_api_key_creation_attempts set updated_at = now() - interval '61 seconds'
        where id = ${prior.id}
      `;
      await expect(publicKey()).rejects.toThrow("A prior key creation was reconciled");
      expect(await attempts()).toHaveLength(0);
      expect(keys.has(prior.provider_key_id)).toBe(false);
      const fresh = await publicKey();
      const deletes = provider.deleteKey.mock.calls.length;
      const enables = provider.enableKey.mock.calls.length;
      stalled.resume();
      await expect(stale).rejects.toBeInstanceOf(create.ApiKeyCreationConflict);
      expect(provider.deleteKey).toHaveBeenCalledTimes(deletes);
      expect(provider.enableKey).toHaveBeenCalledTimes(enables);
      expect(keys.get(secrets.get(fresh.secret)!)?.enabled).toBe(true);
      await unused();
    } finally {
      stalled.resume();
      await Promise.allSettled([stale]);
    }

    for (const isPrivate of [false, true]) {
      const issued = await (isPrivate ? privateKey() : publicKey());
      const denied = gate();
      const release = gate();
      const id = secrets.get(issued.secret)!;
      provider.deleteKey.mockImplementationOnce(async target => {
        expect(target).toBe(id);
        denied.release();
        await release.promise;
        keys.delete(id);
        throw Error("delete reply lost");
      });
      const revokeKey = () => isPrivate
        ? revoke.revokeAdminApiKey(issued.key.id, "rank_grant_3")
        : revoke.revokeCustomerApiKey(userId, issued.key.id);
      const pending = revokeKey();
      try {
        await denied.promise;
        expect(keys.get(id)?.enabled).toBe(true);
        const [row] = await observer`
          select revocation_requested_at, provider_revoked_at from market_api_keys where id = ${issued.key.id}
        `;
        expect(row.revocation_requested_at).not.toBeNull();
        expect(row.provider_revoked_at).toBeNull();
        expect((await requestKey(issued.secret, isPrivate)).status).toBe(403);
      } finally {
        release.release();
      }
      expect(await pending).toMatchObject({ status: "revocation_pending" });
      // Roll back a provider confirmation after its remote delete succeeded.
      const failConfirmation = vi.spyOn(db, "transaction")
        .mockImplementationOnce(transaction)
        .mockImplementationOnce((callback, options) => transaction(async tx => {
          await callback(tx);
          throw Error("local confirmation failed");
        }, options));
      try {
        expect(await revokeKey()).toMatchObject({ status: "revocation_pending" });
        expect((await observer`select provider_revoked_at from market_api_keys where id = ${issued.key.id}`)[0].provider_revoked_at).toBeNull();
      } finally {
        failConfirmation.mockRestore();
      }
      expect(await revokeKey()).toMatchObject({ status: "revoked" });
      expect(provider.deleteKey).toHaveBeenLastCalledWith(id);
    }

    // Both removers initially see the same grant. A creator waiting to enable
    // must recheck that grant, regardless of which remover finishes first.
    const projected = gate();
    const release = gate();
    provider.createKey.mockImplementationOnce(async input => {
      const key = await createNormally(input);
      projected.release();
      await release.promise;
      return key;
    });
    const creating = privateKey().then(() => "issued", () => "reconciled");
    await projected.promise;
    const choseGrant = gate();
    const retryRemoval = gate();
    const paused = vi.spyOn(db, "transaction").mockImplementationOnce(async (callback, options) => {
      choseGrant.release();
      await retryRemoval.promise;
      return transaction(callback, options);
    });
    const slowRemoval = admin.removeAdmin(userId);
    await choseGrant.promise;
    const removing = admin.removeAdmin(userId);
    try {
      await waitForContender();
    } finally {
      release.release();
    }
    expect(await creating).toBe("reconciled");
    try {
      await removing;
      await admin.addAdmin(userId);
    } finally {
      retryRemoval.release();
      paused.mockRestore();
      await slowRemoval;
    }
    expect(await attempts()).toHaveLength(0);
    expect(await observer`select id from system_admin where id = ${grantId}`).toHaveLength(0);
    const [publicHistory] = await observer`
      select count(*)::int as count from market_api_usage_events e
      join market_api_keys k on k.id = e.market_api_key_id where k.user_id = ${userId} and k.key_class = 'public'
    `;
    expect(publicHistory.count).toBe(1);
    const [newGrant] = await observer`select id from system_admin where user_id = ${userId}`;
    expect(newGrant.id).not.toBe(grantId);
    await unused();
  } finally {
    spy.mockRestore();
  }
}
