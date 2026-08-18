import { beforeEach, describe, expect, it, vi } from "vitest";

const lockState = vi.hoisted(() => ({
  tails: new Map<string, Promise<void>>(),
  active: 0,
  maxActive: 0,
}));

vi.mock("@/lib/db/locks", () => ({
  withBillingSubjectLock: async <T>(
    userId: string,
    callback: (transaction: unknown) => Promise<T>,
    database: { transaction: (callback: (transaction: unknown) => Promise<T>) => Promise<T> },
  ) => {
    const prior = lockState.tails.get(userId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    lockState.tails.set(userId, prior.then(() => current));
    await prior;
    lockState.active += 1;
    lockState.maxActive = Math.max(lockState.maxActive, lockState.active);
    try {
      return await database.transaction(callback);
    } finally {
      lockState.active -= 1;
      release();
    }
  },
}));

import { schema } from "@tradinggoose/db";
import { ensureMarketCustomerState } from "../../lib/billing/customer-state";

beforeEach(() => {
  lockState.tails.clear();
  lockState.active = 0;
  lockState.maxActive = 0;
});

describe("standalone customer lifecycle", () => {
  it("serializes concurrent repair and leaves one canonical owner, accumulator, and PAYG row", async () => {
    const fixture = customerDatabase("customer_1");

    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        ensureMarketCustomerState("customer_1", fixture.database as never),
      ),
    );

    expect(lockState.maxActive).toBe(1);
    expect(fixture.counts()).toEqual({ owners: 1, stats: 1, subscriptions: 1 });
    expect(results.every((state) => state.usageOwner.id === "owner_customer_1")).toBe(true);
    expect(results.every((state) => state.userStats.billingReferenceId === "customer_1")).toBe(true);
    expect(results.every((state) => state.subscription.id === "sub_default_customer_1")).toBe(true);
  });

  it("is additive and does not rewrite database-provisioned admin membership", async () => {
    const fixture = customerDatabase("customer_1");
    fixture.adminMemberships.set("customer_1", {
      id: "grant_1",
      userId: "customer_1",
      status: "active",
    });

    await ensureMarketCustomerState("customer_1", fixture.database as never);
    await ensureMarketCustomerState("customer_1", fixture.database as never);

    expect(fixture.adminMemberships.get("customer_1")).toEqual({
      id: "grant_1",
      userId: "customer_1",
      status: "active",
    });
  });

  it("fails closed when a retained identity bridge is inconsistent", async () => {
    const fixture = customerDatabase("customer_1");
    fixture.seedOwner();
    fixture.seedStats({ usageOwnerId: "owner_other" });

    await expect(
      ensureMarketCustomerState("customer_1", fixture.database as never),
    ).rejects.toThrow(/identity bridge is invalid/);
    expect(fixture.counts().subscriptions).toBe(0);
  });

  it("repairs canonical customer state after a transient post-commit initialization failure", async () => {
    const fixture = customerDatabase("customer_retry");
    const transientFailure = new Error("database temporarily unavailable");
    let failFirstTransaction = true;
    const database = {
      transaction: async <T>(
        callback: (transaction: unknown) => Promise<T>,
      ): Promise<T> => {
        if (failFirstTransaction) {
          failFirstTransaction = false;
          throw transientFailure;
        }
        return fixture.database.transaction(callback as never);
      },
    };

    await expect(
      ensureMarketCustomerState("customer_retry", database as never),
    ).rejects.toBe(transientFailure);
    expect(fixture.counts()).toEqual({ owners: 0, stats: 0, subscriptions: 0 });

    await expect(
      ensureMarketCustomerState("customer_retry", database as never),
    ).resolves.toMatchObject({
      usageOwner: { id: "owner_customer_retry" },
      userStats: { billingReferenceId: "customer_retry" },
      subscription: { id: "sub_default_customer_retry" },
    });
    expect(fixture.counts()).toEqual({ owners: 1, stats: 1, subscriptions: 1 });
  });
});

function customerDatabase(userId: string) {
  const users = new Map([[userId, { id: userId }]]);
  const owners = new Map<string, Record<string, unknown>>();
  const stats = new Map<string, Record<string, unknown>>();
  const subscriptions = new Map<string, Record<string, unknown>>();
  const adminMemberships = new Map<string, Record<string, unknown>>();

  const rowFor = (table: unknown) => {
    if (table === schema.user) return users.get(userId) ? [users.get(userId)] : [];
    if (table === schema.marketUsageOwner) {
      const row = owners.get(userId);
      return row ? [row] : [];
    }
    if (table === schema.userStats) {
      const row = stats.get(userId);
      return row ? [row] : [];
    }
    if (table === schema.subscription) {
      const row = subscriptions.get(userId);
      return row ? [row] : [];
    }
    return [];
  };

  const transaction = {
    select() {
      let table: unknown;
      const builder = {
        from(next: unknown) {
          table = next;
          return builder;
        },
        where() {
          return builder;
        },
        limit() {
          return builder;
        },
        for() {
          return builder;
        },
        then(resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve(rowFor(table)).then(resolve, reject);
        },
      };
      return builder;
    },
    insert(table: unknown) {
      let value: Record<string, unknown> = {};
      const builder = {
        values(next: Record<string, unknown>) {
          value = next;
          if (table === schema.marketUsageOwner && !owners.has(userId)) {
            owners.set(userId, {
              id: `owner_${userId}`,
              userId,
              createdAt: new Date(0),
              updatedAt: new Date(0),
              ...next,
            });
          }
          if (table === schema.userStats && !stats.has(userId)) {
            stats.set(userId, {
              id: `stats_${userId}`,
              userId,
              usageOwnerId: `owner_${userId}`,
              billingReferenceId: userId,
              ...next,
            });
          }
          if (table === schema.subscription && !subscriptions.has(userId)) {
            subscriptions.set(userId, {
              status: null,
              stripeCustomerId: null,
              stripeSubscriptionId: null,
              ...next,
            });
          }
          return builder;
        },
        onConflictDoNothing() {
          return builder;
        },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve(value).then(resolve, reject);
        },
      };
      return builder;
    },
  };

  return {
    database: {
      transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) =>
        callback(transaction),
    },
    adminMemberships,
    seedOwner() {
      owners.set(userId, { id: `owner_${userId}`, userId });
    },
    seedStats(overrides: Record<string, unknown>) {
      stats.set(userId, {
        id: `stats_${userId}`,
        userId,
        usageOwnerId: `owner_${userId}`,
        billingReferenceId: userId,
        ...overrides,
      });
    },
    counts: () => ({
      owners: owners.size,
      stats: stats.size,
      subscriptions: subscriptions.size,
    }),
  };
}
