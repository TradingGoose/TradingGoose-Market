import {
  marketApiKeyCreationAttempts,
  marketApiKeys,
  systemAdmin,
  user,
} from "@tradinggoose/db/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  database: null as unknown as FakeAdminDatabase,
  confirm: vi.fn(),
  deleteCandidates: vi.fn(),
  events: [] as string[],
}));

vi.mock("@/lib/db/runtime", () => ({
  requireDatabase: () => state.database,
}));

vi.mock("@/lib/db/locks", () => ({
  acquireAdminGrantLock: vi.fn(async (_tx, grantId: string) => {
    state.events.push(`grant-xact:${grantId}`);
  }),
  acquireApiKeyLock: vi.fn(async (_tx, keyId: string) => {
    state.events.push(`key-xact:${keyId}`);
  }),
  withAdminGrantHandlerLock: async (
    grantId: string,
    callback: (database: FakeAdminDatabase) => Promise<unknown>,
  ) => {
    state.events.push(`grant-session:acquired:${grantId}`);
    try {
      return await callback(state.database);
    } finally {
      state.events.push(`grant-session:released:${grantId}`);
    }
  },
  withAdminGrantLock: async (
    grantId: string,
    callback: (database: FakeAdminDatabase) => Promise<unknown>,
  ) => {
    state.events.push(`grant-transaction:${grantId}`);
    return callback(state.database);
  },
}));

vi.mock("@/lib/api-keys/revocation", () => ({
  confirmProviderKeyRevocation: (...args: unknown[]) => state.confirm(...args),
}));

vi.mock("@/lib/unkey/provisioning", () => ({
  deleteAndConfirmProvisioningCandidates: (...args: unknown[]) =>
    state.deleteCandidates(...args),
}));

vi.mock("@/lib/unkey/runtime", () => ({
  getMarketKeyProvider: () => ({ marker: "provider" }),
}));

import { addAdmin, removeAdmin } from "../../scripts/manage-market-admin";

beforeEach(() => {
  vi.clearAllMocks();
  state.events.length = 0;
  state.database = new FakeAdminDatabase();
  state.confirm.mockImplementation(async (providerKeyId: string) => {
    state.events.push(`provider-confirmed:${providerKeyId}`);
    return { status: "revoked", retryable: false };
  });
  state.deleteCandidates.mockImplementation(async (_provider, correlationId: string) => {
    state.events.push(`candidates-zero:${correlationId}`);
  });
});

describe("admin membership lifecycle", () => {
  it("rejects an unverified user without provisioning customer or admin state", async () => {
    state.database.emailVerified = false;

    await expect(addAdmin("user_1")).rejects.toThrow("A verified user is required");

    expect(state.database.grant).toBeNull();
    expect(state.events).toEqual(["grant-transaction:user_1"]);
  });

  it("reconciles mapped keys and every reserved/dispatched/cleanup attempt before deletion", async () => {
    state.database.grant = { id: "grant_1", userId: "user_1", status: "active" };
    state.database.keys = [privateKey("key_1", "provider_mapping")];
    state.database.attempts = [
      attempt("attempt_reserved", "reserved", null, "correlation_reserved"),
      attempt("attempt_dispatched", "dispatched", "provider_attempt", "correlation_dispatched"),
      attempt("attempt_cleanup", "cleanup_required", null, "correlation_cleanup"),
    ];

    await removeAdmin("user_1");

    expect(state.database.grant).toBeNull();
    expect(state.database.keys).toEqual([
      expect.objectContaining({
        revocationRequestedAt: expect.any(Date),
        providerRevokedAt: expect.any(Date),
      }),
    ]);
    expect(state.database.attempts).toEqual([]);
    expect(state.confirm.mock.calls.map(([providerId]) => providerId)).toEqual([
      "provider_mapping",
      "provider_attempt",
    ]);
    expect(state.deleteCandidates.mock.calls.map(([, correlationId]) => correlationId))
      .toEqual(["correlation_dispatched", "correlation_cleanup"]);
    expect(state.events.indexOf("grant-status:removing")).toBeLessThan(
      state.events.indexOf("provider-confirmed:provider_mapping"),
    );
    expect(state.events.indexOf("attempt-deleted:attempt_cleanup")).toBeLessThan(
      state.events.indexOf("grant-deleted:grant_1"),
    );
    expect(state.events.at(-1)).toBe("grant-session:released:grant_1");
  });

  it("retains removing plus the uncertain attempt for a later retry", async () => {
    state.database.grant = { id: "grant_1", userId: "user_1", status: "active" };
    state.database.attempts = [
      attempt("attempt_cleanup", "cleanup_required", null, "correlation_cleanup"),
    ];
    const unavailable = new Error("candidate inventory unavailable");
    state.deleteCandidates.mockRejectedValueOnce(unavailable);

    await expect(removeAdmin("user_1")).rejects.toBe(unavailable);

    expect(state.database.grant).toEqual(
      expect.objectContaining({ status: "removing" }),
    );
    expect(state.database.attempts).toHaveLength(1);
    expect(state.events).not.toContain("grant-deleted:grant_1");
    expect(state.events.at(-1)).toBe("grant-session:released:grant_1");
  });
});

class FakeAdminDatabase {
  emailVerified = true;
  grant: { id: string; userId: string; status: string } | null = null;
  keys: Array<Record<string, unknown>> = [];
  attempts: Array<Record<string, unknown>> = [];

  select(selection?: Record<string, unknown>) {
    return {
      from: (table: unknown) => new FakeQuery(this, table, selection),
    };
  }

  update(table: unknown) {
    return {
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => this.applyUpdate(table, values),
        }),
      }),
    };
  }

  insert(table: unknown) {
    return {
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          if (table !== systemAdmin || this.grant) return [];
          this.grant = {
            id: "grant_inserted",
            userId: String(values.userId),
            status: String(values.status),
          };
          return [this.grant];
        },
      }),
    };
  }

  delete(table: unknown) {
    return {
      where: () => ({
        returning: async () => this.applyDelete(table),
      }),
    };
  }

  async transaction<T>(callback: (tx: FakeAdminDatabase) => Promise<T>) {
    return callback(this);
  }

  rows(table: unknown, selection?: Record<string, unknown>) {
    if (table === user) {
      return [{ id: "user_1", emailVerified: this.emailVerified }];
    }
    if (table === systemAdmin) return this.grant ? [{ ...this.grant }] : [];
    if (table === marketApiKeys) {
      if (selection && "id" in selection && !("providerKeyId" in selection)) {
        return this.keys.filter(
          (key) => !key.revocationRequestedAt || !key.providerRevokedAt,
        );
      }
      return this.keys.map((key) => ({ ...key }));
    }
    if (table === marketApiKeyCreationAttempts) {
      return this.attempts.map((attempt) => ({ ...attempt }));
    }
    throw new Error("Unexpected select table");
  }

  private applyUpdate(table: unknown, values: Record<string, unknown>) {
    if (table === systemAdmin) {
      if (!this.grant) return [];
      Object.assign(this.grant, values);
      state.events.push(`grant-status:${this.grant.status}`);
      return [{ id: this.grant.id }];
    }
    if (table === marketApiKeys) {
      const target = values.providerRevokedAt
        ? this.keys.find((key) => !key.providerRevokedAt)
        : this.keys.find((key) => !key.revocationRequestedAt);
      if (!target) return [];
      Object.assign(target, values);
      state.events.push(
        values.providerRevokedAt
          ? `mapping-provider-revoked:${target.id}`
          : `mapping-revocation-requested:${target.id}`,
      );
      return [{ id: target.id }];
    }
    throw new Error("Unexpected update table");
  }

  private applyDelete(table: unknown) {
    if (table === marketApiKeyCreationAttempts) {
      const deleted = this.attempts.shift();
      if (!deleted) return [];
      state.events.push(`attempt-deleted:${deleted.id}`);
      return [{ id: deleted.id }];
    }
    if (table === systemAdmin) {
      if (!this.grant) return [];
      const deleted = this.grant;
      this.grant = null;
      state.events.push(`grant-deleted:${deleted.id}`);
      return [{ id: deleted.id }];
    }
    throw new Error("Unexpected delete table");
  }
}

class FakeQuery implements PromiseLike<Array<Record<string, unknown>>> {
  constructor(
    private readonly database: FakeAdminDatabase,
    private readonly table: unknown,
    private readonly selection?: Record<string, unknown>,
  ) {}

  where() { return this; }
  for() { return this; }
  orderBy() { return this; }

  async limit(count: number) {
    const rows = this.database.rows(this.table, this.selection);
    if (this.table === marketApiKeyCreationAttempts && count === 2) {
      return rows.slice(0, 1);
    }
    return rows.slice(0, count);
  }

  then<TResult1 = Array<Record<string, unknown>>, TResult2 = never>(
    onfulfilled?: ((value: Array<Record<string, unknown>>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.database.rows(this.table, this.selection)).then(
      onfulfilled,
      onrejected,
    );
  }
}

function privateKey(id: string, providerKeyId: string) {
  return {
    id,
    adminGrantId: "grant_1",
    keyClass: "private",
    unkeyKeyId: providerKeyId,
    revocationRequestedAt: null,
    providerRevokedAt: null,
  };
}

function attempt(
  id: string,
  attemptState: "reserved" | "dispatched" | "cleanup_required",
  providerKeyId: string | null,
  correlationId: string,
) {
  return {
    id,
    reservedKeyId: `reserved_${id}`,
    adminGrantId: "grant_1",
    keyClass: "private",
    correlationId,
    state: attemptState,
    providerKeyId,
  };
}
