import type postgres from "postgres";
import { expect, vi } from "vitest";

type Observer = ReturnType<typeof postgres>;

/** A barrier in the caller cannot occupy another database connection. */
export function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

export function beforeCompletion<T>(ready: Promise<T>, operation: Promise<unknown>, phase: string) {
  return Promise.race([ready, operation.then(() => {
    throw new Error(`Operation completed before ${phase}`);
  })]);
}

export async function assertPrivateRankOrdering(monitor: Observer) {
  const [runtime, manifest, unkey, { POST }, admin, revoke] = await Promise.all([
    import("../../lib/db/runtime"),
    import("../../lib/market-api/core/manifest"),
    import("../../lib/unkey/runtime"),
    import("../../app/api/update/[...path]/route"),
    import("../../scripts/manage-market-admin"),
    import("../../lib/api-keys/revocation"),
  ]);
  await monitor`
    insert into "user" (id, name, email, email_verified, created_at, updated_at)
    select 'rank_user_' || i, 'Rank ' || i, 'rank' || i || '@example.com', true, now(), now()
    from generate_series(1, 12) i
  `;
  await monitor`
    insert into market_usage_owner (id, user_id)
    select 'rank_owner_' || i, 'rank_user_' || i from generate_series(1, 12) i
  `;
  await monitor`
    insert into system_admin (id, user_id)
    select 'rank_grant_' || i, 'rank_user_' || i from generate_series(1, 12) i
  `;
  await monitor`
    insert into market_api_keys (id, usage_owner_id, user_id, unkey_key_id, admin_grant_id, key_class, name, display_value)
    select 'rank_key_' || i, 'rank_owner_' || i, 'rank_user_' || i, 'rank_provider_' || i,
      'rank_grant_' || i, 'private', 'Rank', 'masked' from generate_series(1, 12) i
  `;
  await monitor`
    insert into currencies (code, name)
    select 'RANK' || i, 'Rank currency ' || i from generate_series(1, 12) i
  `;
  const provider = {
    verifyKey: async ({ key }: { key: string }) => ({ valid: true, code: "VALID", keyId: key }),
    deleteKey: vi.fn(),
    getKey: async () => null,
  };
  const providerSpy = vi.spyOn(unkey, "getMarketKeyProvider")
    .mockReturnValue(provider as unknown as ReturnType<typeof unkey.getMarketKeyProvider>);
  const route = manifest.resolveKeyedMarketRoute("/api/update/currency-rank")!;
  const resolve = manifest.resolveKeyedMarketRoute;
  const routeSpy = vi.spyOn(manifest, "resolveKeyedMarketRoute");
  let waiting = 0;
  const firstFive = gate();
  routeSpy.mockImplementation((path) => path !== route.path ? resolve(path) : {
    ...route,
    handler: async (context, actor) => {
      waiting++;
      await firstFive.promise;
      return route.handler(context, actor);
    },
  });
  function post(index: number, decay = false) {
    return POST(new Request(`http://market.test/api/update/currency-rank${decay ? "/decay" : ""}?version=v1&currency_code=RANK${index}`, {
      method: "POST", headers: { "x-api-key": `rank_provider_${index}` },
    }));
  }
  const ranks = () => monitor<{ code: string; rank: number }[]>`select code, rank from currencies where code like 'RANK%' order by code`;
  const history = (index: number) => monitor<{ http_status: number | null }[]>`
    select c.http_status from market_api_usage_events e left join market_api_usage_completions c on c.event_id = e.id
    where e.market_api_key_id = ${`rank_key_${index}`} order by e.admitted_at
  `;
  const requests = Array.from({ length: 12 }, (_, i) => post(i + 1));
  try {
    // Filling all five backends makes a lookup on a second connection deadlock.
    try {
      await beforeCompletion(
        vi.waitFor(() => expect(waiting).toBe(5), { timeout: 5_000 }),
        Promise.race(requests), "five rank handlers entered",
      );
    } finally {
      firstFive.release();
    }
    const responses = await Promise.all(requests);
    expect(responses.map(r => r.status)).toEqual(Array(12).fill(200));
    expect((await ranks()).map(row => row.rank)).toEqual(Array(12).fill(1));
    for (let i = 1; i <= 12; i++) expect(await history(i)).toEqual([{ http_status: 200 }]);

    // Removal must wait for a rank mutation already holding the grant.
    const held = gate();
    const resume = gate();
    routeSpy.mockImplementation(path => path !== route.path ? resolve(path) : {
      ...route, handler: async (context, actor) => {
        held.release();
        await resume.promise;
        return route.handler(context, actor);
      },
    });
    const writing = post(1);
    let removing: ReturnType<typeof admin.removeAdmin> | undefined;
    try {
      await beforeCompletion(held.promise, writing, "the rank handler acquired the grant");
      const removal = admin.removeAdmin("rank_user_1");
      removing = removal;
      await vi.waitUntil(async () => {
        const blocked = await beforeCompletion(monitor`
          select pid from pg_stat_activity where datname = current_database()
            and wait_event_type = 'Lock' and query like '%pg_advisory_xact_lock%'
        `, removal, "admin removal waited for the rank handler");
        return blocked.length === 1;
      });
      expect(await history(1)).toEqual([{ http_status: 200 }, { http_status: null }]);
      expect(provider.deleteKey).not.toHaveBeenCalled();
    } finally {
      resume.release();
      await Promise.allSettled([writing, removing]);
    }
    await removing;
    expect((await writing).status).toBe(200);
    expect((await ranks()).find(row => row.code === "RANK1")?.rank).toBe(2);
    expect((await post(1, true)).status).toBe(403);

    // Revoke in the gap between the two commits. The admitted event must
    // survive, and its handler must never run after the revocation commits.
    const db = runtime.requireDatabase();
    const transaction = db.transaction.bind(db);
    const admitted = gate();
    const continueRequest = gate();
    const before = await ranks();
    const txnSpy = vi.spyOn(db, "transaction").mockImplementationOnce(async (callback, options) => {
      const result = await transaction(callback, options);
      admitted.release();
      await continueRequest.promise;
      return result;
    });
    const decay = post(2, true);
    try {
      await beforeCompletion(admitted.promise, decay, "decay admission committed");
      await revoke.revokeAdminApiKey("rank_key_2", "rank_grant_3");
    } finally {
      continueRequest.release();
      await Promise.allSettled([decay]);
      txnSpy.mockRestore();
    }
    expect((await decay).status).toBe(403);
    expect(await ranks()).toEqual(before);
    expect(await history(2)).toEqual([{ http_status: 200 }, { http_status: 403 }]);

    // Hold the real revoker in Unkey after its tombstone has committed.
    // The admitted request runs out its five-second grant-lock wait in B.
    const afterAdmission = gate();
    const beginMutation = gate();
    const deleting = gate();
    const finishDelete = gate();
    const pausedAdmission = vi.spyOn(db, "transaction").mockImplementationOnce(async (callback, options) => {
      const result = await transaction(callback, options);
      afterAdmission.release();
      await beginMutation.promise;
      return result;
    });
    provider.deleteKey.mockImplementationOnce(async () => {
      deleting.release();
      await finishDelete.promise;
    });
    const queued = post(4);
    let revoking: ReturnType<typeof revoke.revokeAdminApiKey> | undefined;
    try {
      await beforeCompletion(afterAdmission.promise, queued, "private admission committed");
      revoking = revoke.revokeAdminApiKey("rank_key_4", "rank_grant_3");
      await beforeCompletion(deleting.promise, revoking, "revocation reached Unkey");
      beginMutation.release();
      const response = await queued;
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: "ADMISSION_UNAVAILABLE" });
      expect(await ranks()).toEqual(before);
      expect(await history(4)).toEqual([{ http_status: 200 }, { http_status: 503 }]);
    } finally {
      beginMutation.release();
      finishDelete.release();
      await Promise.allSettled([queued, revoking]);
      pausedAdmission.mockRestore();
    }
    await revoking;

    // Roll back a successful handler before its transaction can commit.
    const failing = vi.spyOn(db, "transaction")
      .mockImplementationOnce(transaction)
      .mockImplementationOnce((callback, options) => transaction(async tx => {
        await callback(tx);
        throw new Error("mutation transaction failed");
      }, options));
    try {
      expect((await post(3)).status).toBe(500);
      expect(await ranks()).toEqual(before);
      expect(await history(3)).toEqual([{ http_status: 200 }, { http_status: 500 }]);
    } finally {
      failing.mockRestore();
    }
  } finally {
    firstFive.release();
    await Promise.allSettled(requests);
    routeSpy.mockRestore();
    providerSpy.mockRestore();
  }
}
