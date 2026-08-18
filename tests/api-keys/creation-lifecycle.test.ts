import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  marketApiKeyCreationAttempts,
  marketApiKeys,
  marketUsageOwner,
  systemAdmin,
} from "@tradinggoose/db/schema";

const mocks = vi.hoisted(() => ({
  withPublicCreationLocks: vi.fn(),
  withPrivateCreationLocks: vi.fn(),
  getProvider: vi.fn(),
  deleteCandidates: vi.fn(),
}));

vi.mock("@/lib/db/locks", () => ({
  withBillingSubjectAndApiKeyCreationHandlerLocks: mocks.withPublicCreationLocks,
  withAdminGrantAndApiKeyCreationHandlerLocks: mocks.withPrivateCreationLocks,
}));

vi.mock("@/lib/unkey/runtime", () => ({
  getMarketKeyProvider: mocks.getProvider,
}));

vi.mock("@/lib/unkey/provisioning", () => ({
  deleteAndConfirmProvisioningCandidates: mocks.deleteCandidates,
}));

import {
  ApiKeyCreationConflict,
  createAdminApiKey,
  createCustomerApiKey,
} from "../../lib/api-keys/creation";

type Attempt = typeof marketApiKeyCreationAttempts.$inferSelect;
type AttemptInsert = typeof marketApiKeyCreationAttempts.$inferInsert;

class FakeCreationDatabase {
  readonly events: string[] = [];
  readonly attemptMutationParameters: unknown[][] = [];
  attempts: Attempt[] = [];
  mappings: Array<Record<string, unknown>> = [];
  lastInsertedAttempt: Attempt | null = null;
  ownerActive = true;
  userVerified = true;
  grantActive = true;
  projectionReturnsEmpty = false;
  failMappingInsert = false;
  failFinalAttemptDelete = false;
  keyLockHeld = false;
  outerLockHeld = false;
  transactionCount = 0;
  finalizationCommitGate: Promise<void> | null = null;
  finalizationReady: (() => void) | null = null;
  private transactionLabel: string | null = null;
  private readonly dialect = new PgDialect();

  select() {
    return {
      from: (table: unknown) => new FakeSelect(this, table),
    };
  }

  insert(table: unknown) {
    return {
      values: async (value: Record<string, unknown>) => {
        this.requireKeyLock();
        if (table === marketApiKeyCreationAttempts) {
          this.events.push("attempt:reserved");
          const now = new Date();
          const attempt = {
            providerKeyId: null,
            providerDisplayValue: null,
            dispatchedAt: null,
            createdAt: now,
            updatedAt: now,
            ...value,
          } as Attempt;
          this.attempts.push(attempt);
          this.lastInsertedAttempt = attempt;
          return;
        }
        if (table === marketApiKeys) {
          this.events.push("mapping:insert");
          if (this.failMappingInsert) throw new Error("mapping insert failed");
          this.mappings.push({ ...value });
          return;
        }
        throw new Error("Unexpected insert table");
      },
    };
  }

  update(table: unknown) {
    if (table !== marketApiKeyCreationAttempts) {
      throw new Error("Unexpected update table");
    }
    return {
      set: (value: Record<string, unknown>) => ({
        where: (condition: unknown) => {
          this.recordAttemptMutation(condition);
          return this.mutation(async () => {
            this.requireKeyLock();
            if (value.state === "dispatched") {
              this.events.push("attempt:dispatched");
            } else if (value.state === "cleanup_required") {
              this.events.push("attempt:cleanup_required");
            } else if (value.providerKeyId) {
              this.events.push("attempt:provider_projected");
              if (this.projectionReturnsEmpty) return [];
            }
            const attempt = this.attempts[0];
            if (!attempt) return [];
            Object.assign(attempt, value);
            return [{ id: attempt.id }];
          });
        },
      }),
    };
  }

  delete(table: unknown) {
    if (table !== marketApiKeyCreationAttempts) {
      throw new Error("Unexpected delete table");
    }
    return {
      where: (condition: unknown) => {
        this.recordAttemptMutation(condition);
        return this.mutation(async () => {
          this.requireKeyLock();
          const finalDelete = this.transactionLabel === "finalization";
          this.events.push(finalDelete ? "attempt:deleted_final" : "attempt:deleted_cleanup");
          if (finalDelete && this.failFinalAttemptDelete) return [];
          const deleted = this.attempts.splice(0);
          return deleted.map((attempt) => ({ id: attempt.id }));
        });
      },
    };
  }

  async transaction<T>(callback: (transaction: never) => Promise<T>): Promise<T> {
    const priorAttempts = this.attempts.map((attempt) => ({ ...attempt }));
    const priorMappings = this.mappings.map((mapping) => ({ ...mapping }));
    const label = this.transactionCount++ === 0 ? "reservation" : "finalization";
    const previousLabel = this.transactionLabel;
    this.transactionLabel = label;
    this.events.push(`${label}:begin`);
    try {
      const result = await callback(this as never);
      if (label === "finalization" && this.finalizationCommitGate) {
        this.events.push("finalization:waiting_to_commit");
        this.finalizationReady?.();
        await this.finalizationCommitGate;
      }
      this.events.push(`${label}:commit`);
      return result;
    } catch (error) {
      this.attempts = priorAttempts;
      this.mappings = priorMappings;
      this.events.push(`${label}:rollback`);
      throw error;
    } finally {
      this.transactionLabel = previousLabel;
    }
  }

  rowsFor(table: unknown) {
    if (table === marketApiKeyCreationAttempts) {
      if (this.transactionLabel !== null) this.requireKeyLock();
      this.events.push("attempt:inspected");
      return this.attempts.map((attempt) => ({ ...attempt }));
    }
    if (table === marketUsageOwner) {
      this.events.push("owner:rechecked");
      this.requireOuterLock();
      if (this.transactionLabel !== null) this.requireKeyLock();
      return this.ownerActive
        ? [{
            id: "owner_1",
            ownerId: "owner_1",
            ownerUserId: "user_1",
            activeUserId: "user_1",
            emailVerified: this.userVerified,
          }]
        : [];
    }
    if (table === systemAdmin) {
      this.events.push("grant:rechecked");
      this.requireOuterLock();
      if (this.transactionLabel !== null) this.requireKeyLock();
      return this.grantActive ? [{ id: "grant_1" }] : [];
    }
    throw new Error("Unexpected select table");
  }

  private mutation(run: () => Promise<Array<{ id: string }>>) {
    let result: Promise<Array<{ id: string }>> | null = null;
    const execute = () => (result ??= run());
    return {
      returning: async () => execute(),
      then: <TResult1 = Array<{ id: string }>, TResult2 = never>(
        onfulfilled?: ((value: Array<{ id: string }>) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => execute().then(onfulfilled, onrejected),
    };
  }

  private recordAttemptMutation(condition: unknown) {
    const query = this.dialect.sqlToQuery(
      condition as Parameters<PgDialect["sqlToQuery"]>[0],
    );
    this.attemptMutationParameters.push([...query.params]);
  }

  private requireKeyLock() {
    if (!this.keyLockHeld) {
      throw new Error("Creation database/provider work escaped the local-key session lock");
    }
  }

  private requireOuterLock() {
    if (!this.outerLockHeld) {
      throw new Error("Creation state was loaded outside its subject/grant session lock");
    }
  }
}

class FakeSelect {
  constructor(
    private readonly database: FakeCreationDatabase,
    private readonly table: unknown,
  ) {}

  where() {
    return this;
  }

  innerJoin() {
    return this;
  }

  for() {
    return this;
  }

  async limit(count: number) {
    return this.database.rowsFor(this.table).slice(0, count);
  }
}

type Fixture = ReturnType<typeof createFixture>;
let fixture: Fixture;

function createFixture() {
  const database = new FakeCreationDatabase();
  const events = database.events;
  const provider = {
    createKey: vi.fn(async (request: { permission: string }) => {
      if (!database.keyLockHeld) failUnlocked();
      events.push("provider:create");
      return {
        keyId: "provider_key_1",
        key:
          request.permission === "market.private"
            ? "tg_admin_raw-secret-once"
            : "tg_pub_raw-secret-once",
      };
    }),
    deleteKey: vi.fn(async () => {
      if (!database.keyLockHeld) failUnlocked();
      events.push("provider:delete_known");
    }),
  };
  return {
    database,
    events,
    provider,
    cleanupUncertain: false,
    lockedKeyId: null as string | null,
  };
}

function failUnlocked(): never {
  throw new Error("Provider work escaped the local-key session lock");
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function runCreationLocks(
  outer: string,
  callback: (
    database: never,
    acquireKey: (keyId: string) => Promise<void>,
  ) => Promise<unknown>,
) {
  fixture.events.push(`outer:acquired:${outer}`);
  fixture.database.outerLockHeld = true;
  try {
    return await callback(fixture.database as never, async (keyId) => {
      fixture.lockedKeyId = keyId;
      fixture.database.keyLockHeld = true;
      fixture.events.push(`key:acquired:${keyId}`);
    });
  } finally {
    if (fixture.lockedKeyId) {
      fixture.events.push(`key:released:${fixture.lockedKeyId}`);
    }
    fixture.database.keyLockHeld = false;
    fixture.database.outerLockHeld = false;
    fixture.events.push(`outer:released:${outer}`);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture = createFixture();
  mocks.getProvider.mockImplementation(() => fixture.provider);
  mocks.withPublicCreationLocks.mockImplementation(
    async (userId: string, callback: never) =>
      runCreationLocks(userId, callback),
  );
  mocks.withPrivateCreationLocks.mockImplementation(
    async (grantId: string, callback: never) =>
      runCreationLocks(grantId, callback),
  );
  mocks.deleteCandidates.mockImplementation(async (_provider, correlationId: string) => {
    if (!fixture.database.keyLockHeld) failUnlocked();
    fixture.events.push(`provider:confirm_zero:${correlationId}`);
    if (fixture.cleanupUncertain) throw new Error("provider cleanup is uncertain");
  });
});

describe("API-key creation lifecycle under the locked reserved connection", () => {
  it("reserves before dispatch, holds the key through provider/final commit, and reveals once afterward", async () => {
    const created = await createCustomerApiKey({
      userId: "user_1",
      name: "Customer key",
      allowance: { limitUsd: "25", windowDays: 7 },
    });
    fixture.events.push("caller:received_secret");

    const eventIndex = (event: string) => fixture.events.indexOf(event);
    const inserted = fixture.database.lastInsertedAttempt;
    expect(inserted).not.toBeNull();
    expect(fixture.lockedKeyId).toBe(inserted?.reservedKeyId);
    expect(eventIndex("attempt:reserved")).toBeLessThan(eventIndex("attempt:dispatched"));
    expect(eventIndex("attempt:dispatched")).toBeLessThan(eventIndex("provider:create"));
    expect(eventIndex("provider:create")).toBeLessThan(
      eventIndex("attempt:provider_projected"),
    );
    expect(eventIndex("mapping:insert")).toBeLessThan(eventIndex("finalization:commit"));
    expect(eventIndex("finalization:commit")).toBeLessThan(
      eventIndex(`key:released:${fixture.lockedKeyId}`),
    );
    expect(eventIndex("outer:released:user_1")).toBeLessThan(
      eventIndex("caller:received_secret"),
    );

    expect(created.secret).toBe("tg_pub_raw-secret-once");
    expect(created.key.displayValue).not.toContain("raw-secret-once");
    expect(JSON.stringify(inserted)).not.toContain("tg_pub_raw-secret-once");
    expect(fixture.database.attempts).toEqual([]);
    expect(fixture.database.mappings).toHaveLength(1);
    expect(JSON.stringify(fixture.database.mappings)).not.toContain(
      "tg_pub_raw-secret-once",
    );

    const identityValues = [
      inserted?.id,
      inserted?.reservedKeyId,
      inserted?.correlationId,
    ];
    expect(fixture.database.attemptMutationParameters.length).toBeGreaterThanOrEqual(3);
    for (const parameters of fixture.database.attemptMutationParameters) {
      expect(parameters).toEqual(expect.arrayContaining(identityValues));
    }
  });

  it("keeps the public promise unresolved until the deferred final transaction commits", async () => {
    const commitGate = deferred();
    const finalizationReady = deferred();
    fixture.database.finalizationCommitGate = commitGate.promise;
    fixture.database.finalizationReady = finalizationReady.resolve;
    let revealed: Awaited<ReturnType<typeof createCustomerApiKey>> | null = null;

    const pendingCreation = createCustomerApiKey({
      userId: "user_1",
      name: "Commit-gated key",
      allowance: { limitUsd: null, windowDays: null },
    }).then((result) => {
      revealed = result;
      return result;
    });

    await finalizationReady.promise;
    expect(fixture.events).toContain("finalization:waiting_to_commit");
    expect(fixture.events).not.toContain("finalization:commit");
    expect(revealed).toBeNull();
    expect(fixture.database.keyLockHeld).toBe(true);

    commitGate.resolve();
    await expect(pendingCreation).resolves.toMatchObject({
      secret: "tg_pub_raw-secret-once",
    });
    expect(fixture.events).toContain("finalization:commit");
  });

  it("deletes a prior reserved attempt under its reserved-key lock without provider work", async () => {
    fixture.database.attempts = [
      priorAttempt({
        state: "reserved",
        reservedKeyId: "reserved_not_dispatched",
        correlationId: "correlation_not_dispatched",
        dispatchedAt: null,
      }),
    ];

    await expect(
      createCustomerApiKey({
        userId: "user_1",
        name: "Retry reserved",
        allowance: { limitUsd: null, windowDays: null },
      }),
    ).rejects.toBeInstanceOf(ApiKeyCreationConflict);

    expect(fixture.lockedKeyId).toBe("reserved_not_dispatched");
    expect(fixture.events).toContain("attempt:deleted_cleanup");
    expect(fixture.provider.createKey).not.toHaveBeenCalled();
    expect(fixture.provider.deleteKey).not.toHaveBeenCalled();
    expect(mocks.deleteCandidates).not.toHaveBeenCalled();
    expect(mocks.getProvider).not.toHaveBeenCalled();
    expect(fixture.database.attempts).toEqual([]);
  });

  it("locks a prior reserved ID, cleans a lost provider response, and requires a fresh request", async () => {
    fixture.database.attempts = [
      priorAttempt({
        state: "dispatched",
        reservedKeyId: "reserved_prior",
        correlationId: "correlation_prior",
      }),
    ];

    await expect(
      createCustomerApiKey({
        userId: "user_1",
        name: "Retry",
        allowance: { limitUsd: null, windowDays: null },
      }),
    ).rejects.toBeInstanceOf(ApiKeyCreationConflict);

    expect(fixture.lockedKeyId).toBe("reserved_prior");
    expect(fixture.provider.createKey).not.toHaveBeenCalled();
    expect(fixture.events).toContain("provider:confirm_zero:correlation_prior");
    expect(fixture.database.attempts).toEqual([]);

    await expect(
      createCustomerApiKey({
        userId: "user_1",
        name: "Fresh",
        allowance: { limitUsd: null, windowDays: null },
      }),
    ).resolves.toMatchObject({ secret: "tg_pub_raw-secret-once" });
    expect(fixture.provider.createKey).toHaveBeenCalledOnce();
  });

  it("cleans a known provider key when provider-result projection fails", async () => {
    fixture.database.projectionReturnsEmpty = true;

    await expect(
      createCustomerApiKey({
        userId: "user_1",
        name: "Projection failure",
        allowance: { limitUsd: null, windowDays: null },
      }),
    ).rejects.toThrow(/provider result could not be projected/);

    expect(fixture.events).toContain("attempt:cleanup_required");
    expect(fixture.events).toContain("provider:delete_known");
    expect(fixture.events.some((event) => event.startsWith("provider:confirm_zero:"))).toBe(
      true,
    );
    expect(fixture.database.attempts).toEqual([]);
    expect(fixture.database.mappings).toEqual([]);
  });

  it.each([
    { failure: "mapping insert", configure: (database: FakeCreationDatabase) => {
      database.failMappingInsert = true;
    } },
    { failure: "attempt deletion", configure: (database: FakeCreationDatabase) => {
      database.failFinalAttemptDelete = true;
    } },
  ])("cleans the known provider result after final $failure failure", async ({ configure }) => {
    configure(fixture.database);

    await expect(
      createCustomerApiKey({
        userId: "user_1",
        name: "Finalization failure",
        allowance: { limitUsd: null, windowDays: null },
      }),
    ).rejects.toThrow();

    expect(fixture.events).toContain("finalization:rollback");
    expect(fixture.events).toContain("provider:delete_known");
    expect(fixture.database.attempts).toEqual([]);
    expect(fixture.database.mappings).toEqual([]);
  });

  it("retains cleanup_required and blocks blind remint while lost-response cleanup is uncertain", async () => {
    const lostResponse = new Error("provider response lost");
    fixture.cleanupUncertain = true;
    fixture.provider.createKey.mockRejectedValueOnce(lostResponse);

    await expect(
      createCustomerApiKey({
        userId: "user_1",
        name: "Uncertain",
        allowance: { limitUsd: null, windowDays: null },
      }),
    ).rejects.toBe(lostResponse);

    expect(fixture.database.attempts).toHaveLength(1);
    expect(fixture.database.attempts[0]?.state).toBe("cleanup_required");

    await expect(
      createCustomerApiKey({
        userId: "user_1",
        name: "Must not remint",
        allowance: { limitUsd: null, windowDays: null },
      }),
    ).rejects.toThrow(/cleanup is uncertain/);
    expect(fixture.provider.createKey).toHaveBeenCalledOnce();
    expect(fixture.database.attempts).toHaveLength(1);
  });

  it("takes the originating grant before the reserved key and denies removal-first private creation", async () => {
    fixture.database.grantActive = false;

    await expect(
      createAdminApiKey({
        userId: "user_1",
        adminGrantId: "grant_1",
        name: "Private key",
      }),
    ).rejects.toBeInstanceOf(ApiKeyCreationConflict);

    expect(fixture.events[0]).toBe("outer:acquired:grant_1");
    expect(fixture.events).not.toContainEqual(expect.stringMatching(/^key:acquired:/));
    expect(fixture.events).toContain("grant:rechecked");
    expect(fixture.provider.createKey).not.toHaveBeenCalled();
    expect(mocks.withPublicCreationLocks).not.toHaveBeenCalled();
  });

  it("denies an unverified customer before reserving a key or calling the provider", async () => {
    fixture.database.userVerified = false;

    await expect(
      createCustomerApiKey({
        userId: "user_1",
        name: "Unverified customer",
        allowance: { limitUsd: null, windowDays: null },
      }),
    ).rejects.toThrow("Verified Market customer state is missing");

    expect(fixture.events[0]).toBe("outer:acquired:user_1");
    expect(fixture.events).toContain("owner:rechecked");
    expect(fixture.lockedKeyId).toBeNull();
    expect(fixture.provider.createKey).not.toHaveBeenCalled();
    expect(fixture.database.attempts).toEqual([]);
  });

  it("successfully creates one private key under grant then key with the safe one-time shape", async () => {
    const created = await createAdminApiKey({
      userId: "user_1",
      adminGrantId: "grant_1",
      name: "Private success",
    });

    const acquiredGrant = fixture.events.indexOf("outer:acquired:grant_1");
    const acquiredKey = fixture.events.findIndex((event) => event.startsWith("key:acquired:"));
    const providerCreate = fixture.events.indexOf("provider:create");
    const finalCommit = fixture.events.indexOf("finalization:commit");
    expect(acquiredGrant).toBeLessThan(acquiredKey);
    expect(acquiredKey).toBeLessThan(providerCreate);
    expect(providerCreate).toBeLessThan(finalCommit);
    expect(mocks.withPrivateCreationLocks).toHaveBeenCalledOnce();
    expect(fixture.provider.createKey).toHaveBeenCalledOnce();
    expect(fixture.provider.createKey).toHaveBeenCalledWith(
      expect.objectContaining({ permission: "market.private" }),
    );
    expect(fixture.database.mappings).toEqual([
      expect.objectContaining({
        adminGrantId: "grant_1",
        keyClass: "private",
        displayValue: expect.not.stringContaining("raw-secret-once"),
      }),
    ]);
    expect(created).toMatchObject({
      key: {
        name: "Private success",
        displayValue: expect.not.stringContaining("raw-secret-once"),
        status: "available",
      },
      secret: "tg_admin_raw-secret-once",
    });
    expect(created.key).not.toHaveProperty("spendLimitUsd");
    expect(fixture.database.attempts).toEqual([]);
  });
});

function priorAttempt(
  overrides: Partial<AttemptInsert> & Pick<AttemptInsert, "state" | "reservedKeyId" | "correlationId">,
): Attempt {
  const now = new Date();
  const { reservedKeyId, correlationId, state, ...additionalOverrides } = overrides;
  return {
    id: "attempt_prior",
    reservedKeyId,
    usageOwnerId: "owner_1",
    userId: "user_1",
    adminGrantId: null,
    keyClass: "public",
    name: "Prior",
    spendLimitUsd: null,
    spendWindowDays: null,
    correlationId,
    state,
    providerKeyId: null,
    providerDisplayValue: null,
    dispatchedAt: now,
    createdAt: now,
    updatedAt: now,
    ...additionalOverrides,
  } as Attempt;
}
