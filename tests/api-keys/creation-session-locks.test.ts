import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reserveConnection: vi.fn(),
  drizzle: vi.fn(),
}));

vi.mock("@tradinggoose/db", () => ({
  schema: {},
}));

vi.mock("@/lib/db/runtime", () => ({
  requireDatabase: vi.fn(),
  reserveDatabaseConnection: mocks.reserveConnection,
}));

vi.mock("drizzle-orm/postgres-js", () => ({
  drizzle: mocks.drizzle,
}));

import {
  withAdminGrantAndApiKeyCreationHandlerLocks,
  withAdminGrantAndApiKeyHandlerLocks,
  withAdminGrantHandlerLock,
  withBillingSubjectAndApiKeyCreationHandlerLocks,
  withBillingSubjectAndApiKeyHandlerLocks,
} from "../../lib/db/locks";

const BILLING_SUBJECT_LOCK_NAMESPACE = 1_847_001;
const ADMIN_GRANT_LOCK_NAMESPACE = 1_847_002;
const API_KEY_LOCK_NAMESPACE = 1_847_003;

type QueryEvent = {
  operation: "lock" | "unlock" | "unlock_all";
  namespace: number | null;
  id: string | null;
};

function createReservedConnection(input?: {
  onQuery?: (event: QueryEvent) => unknown;
}) {
  const events: QueryEvent[] = [];
  const release = vi.fn();
  const connection = Object.assign(
    vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join(" ");
      const operation = query.includes("pg_advisory_unlock_all")
        ? "unlock_all"
        : query.includes("pg_advisory_unlock")
          ? "unlock"
          : "lock";
      const event: QueryEvent = {
        operation,
        namespace: typeof values[0] === "number" ? values[0] : null,
        id: typeof values[1] === "string" ? values[1] : null,
      };
      events.push(event);
      const override = input?.onQuery?.(event);
      if (override instanceof Error) throw override;
      if (override !== undefined) return override;
      return operation === "unlock" ? [{ unlocked: true }] : [];
    }),
    { release },
  );
  return { connection, events, release };
}

function createAdvisoryLockManager() {
  const held = new Map<string, number>();
  const waiters = new Map<
    string,
    Array<{ owner: number; resolve: (value: unknown[]) => void }>
  >();
  const databases = new Map<object, object>();
  const events: string[] = [];
  let nextOwner = 0;

  const lockKey = (namespace: unknown, id: unknown) => `${namespace}:${id}`;
  const grantNext = (key: string) => {
    const queue = waiters.get(key);
    const next = queue?.shift();
    if (!next) return;
    if (queue?.length === 0) waiters.delete(key);
    held.set(key, next.owner);
    events.push(`granted:${next.owner}:${key}`);
    next.resolve([]);
  };

  const createConnection = () => {
    const owner = ++nextOwner;
    const release = vi.fn();
    const connection = Object.assign(
      vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = strings.join(" ");
        if (query.includes("pg_advisory_unlock_all")) {
          for (const [key, lockOwner] of held) {
            if (lockOwner !== owner) continue;
            held.delete(key);
            grantNext(key);
          }
          return [];
        }
        const key = lockKey(values[0], values[1]);
        if (query.includes("pg_advisory_unlock")) {
          if (held.get(key) !== owner) return [{ unlocked: false }];
          events.push(`unlocked:${owner}:${key}`);
          held.delete(key);
          grantNext(key);
          return [{ unlocked: true }];
        }
        if (!held.has(key)) {
          held.set(key, owner);
          events.push(`granted:${owner}:${key}`);
          return [];
        }
        events.push(`waiting:${owner}:${key}`);
        return new Promise<unknown[]>((resolve) => {
          const queue = waiters.get(key) ?? [];
          queue.push({ owner, resolve });
          waiters.set(key, queue);
        });
      }),
      { release },
    );
    const database = { owner };
    databases.set(connection, database);
    return { connection, database, owner, release };
  };

  return {
    createConnection,
    databaseFor: (connection: object) => databases.get(connection),
    events,
    waiterCount: (namespace: number, id: string) =>
      waiters.get(lockKey(namespace, id))?.length ?? 0,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("API-key creation session locks", () => {
  it("uses one reserved connection for public billing-subject then local-key locking and reverse release", async () => {
    const reserved = createReservedConnection();
    const database = { marker: "reserved-database" };
    mocks.reserveConnection.mockResolvedValue(reserved.connection);
    mocks.drizzle.mockReturnValue(database);

    await expect(
      withBillingSubjectAndApiKeyCreationHandlerLocks(
        "user_1",
        async (receivedDatabase, acquireKey) => {
          expect(receivedDatabase).toBe(database);
          expect(reserved.events).toEqual([
            {
              operation: "lock",
              namespace: BILLING_SUBJECT_LOCK_NAMESPACE,
              id: "user_1",
            },
          ]);
          await acquireKey("local_key_1");
          expect(reserved.events.at(-1)).toEqual({
            operation: "lock",
            namespace: API_KEY_LOCK_NAMESPACE,
            id: "local_key_1",
          });
          return "created";
        },
      ),
    ).resolves.toBe("created");

    expect(mocks.reserveConnection).toHaveBeenCalledTimes(1);
    expect(mocks.drizzle).toHaveBeenCalledWith(reserved.connection, { schema: {} });
    expect(reserved.events).toEqual([
      {
        operation: "lock",
        namespace: BILLING_SUBJECT_LOCK_NAMESPACE,
        id: "user_1",
      },
      { operation: "lock", namespace: API_KEY_LOCK_NAMESPACE, id: "local_key_1" },
      { operation: "unlock", namespace: API_KEY_LOCK_NAMESPACE, id: "local_key_1" },
      {
        operation: "unlock",
        namespace: BILLING_SUBJECT_LOCK_NAMESPACE,
        id: "user_1",
      },
    ]);
    expect(reserved.release).toHaveBeenCalledOnce();
  });

  it("uses originating admin-grant then local-key order and reverses both after callback failure", async () => {
    const reserved = createReservedConnection();
    const primary = new Error("provider failed");
    mocks.reserveConnection.mockResolvedValue(reserved.connection);
    mocks.drizzle.mockReturnValue({});

    await expect(
      withAdminGrantAndApiKeyCreationHandlerLocks(
        "grant_1",
        async (_database, acquireKey) => {
          await acquireKey("local_key_2");
          throw primary;
        },
      ),
    ).rejects.toBe(primary);

    expect(reserved.events).toEqual([
      { operation: "lock", namespace: ADMIN_GRANT_LOCK_NAMESPACE, id: "grant_1" },
      { operation: "lock", namespace: API_KEY_LOCK_NAMESPACE, id: "local_key_2" },
      { operation: "unlock", namespace: API_KEY_LOCK_NAMESPACE, id: "local_key_2" },
      { operation: "unlock", namespace: ADMIN_GRANT_LOCK_NAMESPACE, id: "grant_1" },
    ]);
    expect(reserved.release).toHaveBeenCalledOnce();
  });

  it("preserves an undefined callback rejection while releasing both locks", async () => {
    const reserved = createReservedConnection();
    mocks.reserveConnection.mockResolvedValue(reserved.connection);
    mocks.drizzle.mockReturnValue({});

    let rejected = false;
    try {
      await withBillingSubjectAndApiKeyCreationHandlerLocks(
        "user_undefined",
        async (_database, acquireKey) => {
          await acquireKey("local_key_undefined");
          throw undefined;
        },
      );
    } catch (error) {
      rejected = true;
      expect(error).toBeUndefined();
    }

    expect(rejected).toBe(true);
    expect(reserved.events.slice(-2)).toEqual([
      {
        operation: "unlock",
        namespace: API_KEY_LOCK_NAMESPACE,
        id: "local_key_undefined",
      },
      {
        operation: "unlock",
        namespace: BILLING_SUBJECT_LOCK_NAMESPACE,
        id: "user_undefined",
      },
    ]);
    expect(reserved.release).toHaveBeenCalledOnce();
  });

  it.each([
    { failedNamespace: BILLING_SUBJECT_LOCK_NAMESPACE, label: "outer" },
    { failedNamespace: API_KEY_LOCK_NAMESPACE, label: "local-key" },
  ])(
    "unwinds an ambiguously acquired $label lock and preserves the acquisition error",
    async ({ failedNamespace }) => {
      const primary = new Error("ambiguous acquisition response");
      let failed = false;
      const reserved = createReservedConnection({
        onQuery: (event) => {
          if (
            !failed &&
            event.operation === "lock" &&
            event.namespace === failedNamespace
          ) {
            failed = true;
            return primary;
          }
          return undefined;
        },
      });
      mocks.reserveConnection.mockResolvedValue(reserved.connection);
      mocks.drizzle.mockReturnValue({});

      await expect(
        withBillingSubjectAndApiKeyCreationHandlerLocks(
          "user_ambiguous",
          async (_database, acquireKey) => {
            await acquireKey("local_key_ambiguous");
          },
        ),
      ).rejects.toBe(primary);

      if (failedNamespace === API_KEY_LOCK_NAMESPACE) {
        expect(reserved.events.slice(-2)).toEqual([
          {
            operation: "unlock",
            namespace: API_KEY_LOCK_NAMESPACE,
            id: "local_key_ambiguous",
          },
          {
            operation: "unlock",
            namespace: BILLING_SUBJECT_LOCK_NAMESPACE,
            id: "user_ambiguous",
          },
        ]);
      } else {
        expect(reserved.events.at(-1)).toEqual({
          operation: "unlock",
          namespace: BILLING_SUBJECT_LOCK_NAMESPACE,
          id: "user_ambiguous",
        });
      }
      expect(reserved.release).toHaveBeenCalledOnce();
    },
  );

  it("quarantines a reserved connection when acquisition cleanup cannot be confirmed", async () => {
    const primary = new Error("ambiguous key acquisition");
    const cleanupFailure = new Error("connection unavailable during cleanup");
    const reserved = createReservedConnection({
      onQuery: (event) => {
        if (event.operation === "lock" && event.namespace === API_KEY_LOCK_NAMESPACE) {
          return primary;
        }
        if (
          (event.operation === "unlock" && event.namespace === API_KEY_LOCK_NAMESPACE) ||
          event.operation === "unlock_all"
        ) {
          return cleanupFailure;
        }
        return undefined;
      },
    });
    mocks.reserveConnection.mockResolvedValue(reserved.connection);
    mocks.drizzle.mockReturnValue({});

    await expect(
      withBillingSubjectAndApiKeyCreationHandlerLocks(
        "user_quarantine",
        async (_database, acquireKey) => acquireKey("local_key_quarantine"),
      ),
    ).rejects.toBe(primary);

    expect(reserved.events.at(-1)).toEqual({
      operation: "unlock_all",
      namespace: null,
      id: null,
    });
    expect(reserved.release).not.toHaveBeenCalled();
  });

  it("validates a confirmed unlock before returning the reserved connection", async () => {
    const reserved = createReservedConnection({
      onQuery: (event) =>
        event.operation === "unlock" && event.namespace === API_KEY_LOCK_NAMESPACE
          ? [{ unlocked: false }]
          : undefined,
    });
    mocks.reserveConnection.mockResolvedValue(reserved.connection);
    mocks.drizzle.mockReturnValue({});

    await expect(
      withBillingSubjectAndApiKeyCreationHandlerLocks(
        "user_bad_unlock",
        async (_database, acquireKey) => acquireKey("local_key_bad_unlock"),
      ),
    ).rejects.toThrow(/local-key lock was not held/);

    expect(reserved.events).not.toContainEqual({
      operation: "unlock_all",
      namespace: null,
      id: null,
    });
    expect(reserved.release).toHaveBeenCalledOnce();
  });

  it("cleans up an ambiguously acquired admin-grant handler lock before releasing", async () => {
    const primary = new Error("ambiguous admin-grant acquisition");
    const reserved = createReservedConnection({
      onQuery: (event) => {
        if (event.operation === "lock") return primary;
        if (event.operation === "unlock") return [{ unlocked: false }];
        return undefined;
      },
    });
    mocks.reserveConnection.mockResolvedValue(reserved.connection);
    mocks.drizzle.mockReturnValue({});

    await expect(
      withAdminGrantHandlerLock("grant_ambiguous", async () => undefined),
    ).rejects.toBe(primary);

    expect(reserved.events).toEqual([
      {
        operation: "lock",
        namespace: ADMIN_GRANT_LOCK_NAMESPACE,
        id: "grant_ambiguous",
      },
      {
        operation: "unlock",
        namespace: ADMIN_GRANT_LOCK_NAMESPACE,
        id: "grant_ambiguous",
      },
    ]);
    expect(reserved.release).toHaveBeenCalledOnce();
  });

  it("falls back to unlock-all after an ambiguous admin-grant handler release", async () => {
    const cleanupFailure = new Error("admin-grant unlock response lost");
    const reserved = createReservedConnection({
      onQuery: (event) =>
        event.operation === "unlock" ? cleanupFailure : undefined,
    });
    mocks.reserveConnection.mockResolvedValue(reserved.connection);
    mocks.drizzle.mockReturnValue({});

    await expect(
      withAdminGrantHandlerLock("grant_release", async () => "done"),
    ).rejects.toBe(cleanupFailure);

    expect(reserved.events.slice(-2)).toEqual([
      {
        operation: "unlock",
        namespace: ADMIN_GRANT_LOCK_NAMESPACE,
        id: "grant_release",
      },
      { operation: "unlock_all", namespace: null, id: null },
    ]);
    expect(reserved.release).toHaveBeenCalledOnce();
  });

  it("quarantines an admin-grant handler connection when fallback cleanup fails", async () => {
    const cleanupFailure = new Error("admin-grant unlock failed");
    const fallbackFailure = new Error("unlock-all failed");
    const reserved = createReservedConnection({
      onQuery: (event) => {
        if (event.operation === "unlock") return cleanupFailure;
        if (event.operation === "unlock_all") return fallbackFailure;
        return undefined;
      },
    });
    mocks.reserveConnection.mockResolvedValue(reserved.connection);
    mocks.drizzle.mockReturnValue({});

    await expect(
      withAdminGrantHandlerLock("grant_quarantine", async () => "done"),
    ).rejects.toBe(cleanupFailure);

    expect(reserved.events.at(-1)).toEqual({
      operation: "unlock_all",
      namespace: null,
      id: null,
    });
    expect(reserved.release).not.toHaveBeenCalled();
  });

  it("reverses both fixed locks after ambiguous API-key acquisition", async () => {
    const primary = new Error("ambiguous API-key acquisition");
    let acquisitionFailed = false;
    const reserved = createReservedConnection({
      onQuery: (event) => {
        if (
          !acquisitionFailed &&
          event.operation === "lock" &&
          event.namespace === API_KEY_LOCK_NAMESPACE
        ) {
          acquisitionFailed = true;
          return primary;
        }
        if (
          event.operation === "unlock" &&
          event.namespace === API_KEY_LOCK_NAMESPACE
        ) {
          return [{ unlocked: false }];
        }
        return undefined;
      },
    });
    mocks.reserveConnection.mockResolvedValue(reserved.connection);
    mocks.drizzle.mockReturnValue({});

    await expect(
      withBillingSubjectAndApiKeyHandlerLocks(
        "user_fixed_ambiguous",
        "local_key_fixed_ambiguous",
        async () => undefined,
      ),
    ).rejects.toBe(primary);

    expect(reserved.events).toEqual([
      {
        operation: "lock",
        namespace: BILLING_SUBJECT_LOCK_NAMESPACE,
        id: "user_fixed_ambiguous",
      },
      {
        operation: "lock",
        namespace: API_KEY_LOCK_NAMESPACE,
        id: "local_key_fixed_ambiguous",
      },
      {
        operation: "unlock",
        namespace: API_KEY_LOCK_NAMESPACE,
        id: "local_key_fixed_ambiguous",
      },
      {
        operation: "unlock",
        namespace: BILLING_SUBJECT_LOCK_NAMESPACE,
        id: "user_fixed_ambiguous",
      },
    ]);
    expect(reserved.release).toHaveBeenCalledOnce();
  });

  it("finishes reverse targeted cleanup before fixed-lock unlock-all fallback", async () => {
    const cleanupFailure = new Error("API-key unlock response lost");
    const reserved = createReservedConnection({
      onQuery: (event) =>
        event.operation === "unlock" &&
        event.namespace === API_KEY_LOCK_NAMESPACE
          ? cleanupFailure
          : undefined,
    });
    mocks.reserveConnection.mockResolvedValue(reserved.connection);
    mocks.drizzle.mockReturnValue({});

    await expect(
      withBillingSubjectAndApiKeyHandlerLocks(
        "user_fixed_release",
        "local_key_fixed_release",
        async () => "done",
      ),
    ).rejects.toBe(cleanupFailure);

    expect(reserved.events.slice(-3)).toEqual([
      {
        operation: "unlock",
        namespace: API_KEY_LOCK_NAMESPACE,
        id: "local_key_fixed_release",
      },
      {
        operation: "unlock",
        namespace: BILLING_SUBJECT_LOCK_NAMESPACE,
        id: "user_fixed_release",
      },
      { operation: "unlock_all", namespace: null, id: null },
    ]);
    expect(reserved.release).toHaveBeenCalledOnce();
  });

  it("serializes same-grant admin removal behind private creation", async () => {
    const manager = createAdvisoryLockManager();
    const creationConnection = manager.createConnection();
    const removalConnection = manager.createConnection();
    mocks.reserveConnection
      .mockResolvedValueOnce(creationConnection.connection)
      .mockResolvedValueOnce(removalConnection.connection);
    mocks.drizzle.mockImplementation((connection) => manager.databaseFor(connection));
    const creationCanFinish = deferred();
    const creationEntered = deferred();
    let removalEntered = false;

    const creation = withAdminGrantAndApiKeyCreationHandlerLocks(
      "grant_shared",
      async (_database, acquireKey) => {
        await acquireKey("local_key_shared");
        creationEntered.resolve();
        await creationCanFinish.promise;
      },
    );
    await creationEntered.promise;

    const removal = withAdminGrantHandlerLock("grant_shared", async () => {
      removalEntered = true;
    });
    for (let index = 0; index < 5; index += 1) await Promise.resolve();

    expect(removalEntered).toBe(false);
    expect(manager.waiterCount(ADMIN_GRANT_LOCK_NAMESPACE, "grant_shared")).toBe(1);

    creationCanFinish.resolve();
    await creation;
    await removal;
    expect(removalEntered).toBe(true);
    expect(manager.events).toEqual(
      expect.arrayContaining([
        `unlocked:${creationConnection.owner}:${ADMIN_GRANT_LOCK_NAMESPACE}:grant_shared`,
        `granted:${removalConnection.owner}:${ADMIN_GRANT_LOCK_NAMESPACE}:grant_shared`,
      ]),
    );
  });

  it("does not serialize an unrelated admin grant behind private creation", async () => {
    const manager = createAdvisoryLockManager();
    const creationConnection = manager.createConnection();
    const unrelatedConnection = manager.createConnection();
    mocks.reserveConnection
      .mockResolvedValueOnce(creationConnection.connection)
      .mockResolvedValueOnce(unrelatedConnection.connection);
    mocks.drizzle.mockImplementation((connection) => manager.databaseFor(connection));
    const creationCanFinish = deferred();
    const creationEntered = deferred();
    const unrelatedEntered = deferred();

    const creation = withAdminGrantAndApiKeyCreationHandlerLocks(
      "grant_a",
      async (_database, acquireKey) => {
        await acquireKey("local_key_a");
        creationEntered.resolve();
        await creationCanFinish.promise;
      },
    );
    await creationEntered.promise;

    const unrelated = withAdminGrantHandlerLock("grant_b", async () => {
      unrelatedEntered.resolve();
    });
    await unrelatedEntered.promise;
    expect(manager.waiterCount(ADMIN_GRANT_LOCK_NAMESPACE, "grant_b")).toBe(0);

    creationCanFinish.resolve();
    await Promise.all([creation, unrelated]);
  });

  it("sorts system-wide grant locks before the target key and releases in reverse", async () => {
    const reserved = createReservedConnection();
    mocks.reserveConnection.mockResolvedValue(reserved.connection);
    mocks.drizzle.mockReturnValue({ marker: "revocation-database" });

    await withAdminGrantAndApiKeyHandlerLocks(
      ["grant_z", "grant_a", "grant_z"],
      "local_key_revoke",
      async () => {
        expect(reserved.events).toEqual([
          { operation: "lock", namespace: ADMIN_GRANT_LOCK_NAMESPACE, id: "grant_a" },
          { operation: "lock", namespace: ADMIN_GRANT_LOCK_NAMESPACE, id: "grant_z" },
          { operation: "lock", namespace: API_KEY_LOCK_NAMESPACE, id: "local_key_revoke" },
        ]);
      },
    );

    expect(reserved.events).toEqual([
      { operation: "lock", namespace: ADMIN_GRANT_LOCK_NAMESPACE, id: "grant_a" },
      { operation: "lock", namespace: ADMIN_GRANT_LOCK_NAMESPACE, id: "grant_z" },
      { operation: "lock", namespace: API_KEY_LOCK_NAMESPACE, id: "local_key_revoke" },
      { operation: "unlock", namespace: API_KEY_LOCK_NAMESPACE, id: "local_key_revoke" },
      { operation: "unlock", namespace: ADMIN_GRANT_LOCK_NAMESPACE, id: "grant_z" },
      { operation: "unlock", namespace: ADMIN_GRANT_LOCK_NAMESPACE, id: "grant_a" },
    ]);
    expect(reserved.release).toHaveBeenCalledOnce();
  });

  it("keeps target-grant removal waiting through system-wide provider reconciliation", async () => {
    const manager = createAdvisoryLockManager();
    const revocationConnection = manager.createConnection();
    const removalConnection = manager.createConnection();
    mocks.reserveConnection
      .mockResolvedValueOnce(revocationConnection.connection)
      .mockResolvedValueOnce(removalConnection.connection);
    mocks.drizzle.mockImplementation((connection) => manager.databaseFor(connection));
    const providerCanFinish = deferred();
    const providerStarted = deferred();
    let removalEntered = false;

    const revocation = withAdminGrantAndApiKeyHandlerLocks(
      ["grant_caller", "grant_target"],
      "local_key_target",
      async () => {
        providerStarted.resolve();
        await providerCanFinish.promise;
      },
    );
    await providerStarted.promise;
    const removal = withAdminGrantHandlerLock("grant_target", async () => {
      removalEntered = true;
    });
    for (let index = 0; index < 5; index += 1) await Promise.resolve();

    expect(removalEntered).toBe(false);
    expect(manager.waiterCount(ADMIN_GRANT_LOCK_NAMESPACE, "grant_target")).toBe(1);
    providerCanFinish.resolve();
    await Promise.all([revocation, removal]);
    expect(removalEntered).toBe(true);
  });
});
