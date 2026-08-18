import {
  marketApiKeys,
  marketUsageOwner,
  systemAdmin,
  user,
} from "@tradinggoose/db/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  database: null as unknown as FakeRevocationDatabase,
  sessionHeld: false,
  events: [] as string[],
  provider: {
    deleteKey: vi.fn(),
    getKey: vi.fn(),
  },
}));

vi.mock("@/lib/db/runtime", () => ({
  requireDatabase: () => state.database,
}));

vi.mock("@/lib/db/locks", () => ({
  acquireAdminGrantLocks: vi.fn(async (_tx, grantIds: string[]) => {
    state.events.push(`xact-grants:${[...grantIds].sort().join(",")}`);
  }),
  acquireApiKeyLock: vi.fn(async (_tx, keyId: string) => {
    state.events.push(`xact-key:${keyId}`);
  }),
  withAdminGrantAndApiKeyHandlerLocks: async (
    grantIds: string[],
    keyId: string,
    callback: (database: FakeRevocationDatabase) => Promise<unknown>,
  ) => {
    state.events.push(`session:acquired:${[...grantIds].sort().join(",")}:${keyId}`);
    state.sessionHeld = true;
    try {
      return await callback(state.database);
    } finally {
      state.sessionHeld = false;
      state.events.push("session:released");
    }
  },
}));

vi.mock("@/lib/unkey/runtime", () => ({
  getMarketKeyProvider: () => state.provider,
}));

import { revokeAdminApiKey } from "../../lib/api-keys/revocation";

beforeEach(() => {
  vi.clearAllMocks();
  state.events.length = 0;
  state.sessionHeld = false;
  state.database = new FakeRevocationDatabase();
  state.provider.deleteKey.mockImplementation(async () => {
    expect(state.sessionHeld).toBe(true);
    state.events.push("provider:delete");
  });
  state.provider.getKey.mockImplementation(async () => {
    expect(state.sessionHeld).toBe(true);
    state.events.push("provider:confirmed");
    return null;
  });
});

describe("system-wide private-key revocation", () => {
  it.each([
    {
      label: "an active target grant",
      targetGrantStatus: "active" as const,
      keyUserId: "target_user",
      ownerUserId: "target_user",
    },
    {
      label: "a removing target grant",
      targetGrantStatus: "removing" as const,
      keyUserId: "target_user",
      ownerUserId: "target_user",
    },
    {
      label: "an absent target grant with retained null user links",
      targetGrantStatus: "absent" as const,
      keyUserId: null,
      ownerUserId: null,
    },
  ])(
    "holds sorted caller/target grant plus key locks while revoking $label",
    async ({ targetGrantStatus, keyUserId, ownerUserId }) => {
      state.database.targetGrantStatus = targetGrantStatus;
      state.database.keyUserId = keyUserId;
      state.database.ownerUserId = ownerUserId;

      await expect(
        revokeAdminApiKey("key_target", "grant_caller"),
      ).resolves.toEqual({ status: "revoked", retryable: false });

      expect(state.events[0]).toBe(
        "session:acquired:grant_caller,grant_target:key_target",
      );
      expect(state.events).toEqual(
        expect.arrayContaining([
          "provider:delete",
          "provider:confirmed",
          "mapping:provider-revoked",
        ]),
      );
      expect(state.events.indexOf("mapping:provider-revoked")).toBeLessThan(
        state.events.indexOf("session:released"),
      );
      expect(state.database.transactionCount).toBe(2);
    },
  );

  it.each([
    {
      label: "an unverified caller",
      callerGrantStatus: "active" as const,
      callerEmailVerified: false,
    },
    {
      label: "a removing caller grant",
      callerGrantStatus: "removing" as const,
      callerEmailVerified: true,
    },
    {
      label: "an absent caller grant",
      callerGrantStatus: "absent" as const,
      callerEmailVerified: true,
    },
  ])("denies $label before provider work", async (invalid) => {
    state.database.callerGrantStatus = invalid.callerGrantStatus;
    state.database.callerEmailVerified = invalid.callerEmailVerified;

    await expect(
      revokeAdminApiKey("key_target", "grant_caller"),
    ).rejects.toThrow("API key was not found");

    expect(state.provider.deleteKey).not.toHaveBeenCalled();
    expect(state.provider.getKey).not.toHaveBeenCalled();
    expect(state.events.at(-1)).toBe("session:released");
  });

  it("returns an already-confirmed tombstone without repeating provider work", async () => {
    state.database.revocationRequestedAt = new Date("2026-07-19T00:00:00.000Z");
    state.database.providerRevokedAt = new Date("2026-07-19T00:01:00.000Z");

    await expect(
      revokeAdminApiKey("key_target", "grant_caller"),
    ).resolves.toEqual({ status: "revoked", retryable: false });

    expect(state.provider.deleteKey).not.toHaveBeenCalled();
    expect(state.provider.getKey).not.toHaveBeenCalled();
    expect(state.database.transactionCount).toBe(1);
    expect(state.events).not.toContain("mapping:revocation-requested");
    expect(state.events.at(-1)).toBe("session:released");
  });

  it("preserves a pending tombstone when provider non-usability is not confirmed", async () => {
    state.database.revocationRequestedAt = new Date("2026-07-19T00:00:00.000Z");
    state.provider.getKey.mockImplementationOnce(async () => {
      expect(state.sessionHeld).toBe(true);
      state.events.push("provider:still-enabled");
      return { enabled: true };
    });

    await expect(
      revokeAdminApiKey("key_target", "grant_caller"),
    ).resolves.toEqual({ status: "revocation_pending", retryable: true });

    expect(state.database.transactionCount).toBe(1);
    expect(state.events).not.toContain("mapping:revocation-requested");
    expect(state.events).not.toContain("mapping:provider-revoked");
    expect(state.events.at(-1)).toBe("session:released");
  });
});

class FakeRevocationDatabase {
  callerGrantStatus: "active" | "removing" | "absent" = "active";
  callerEmailVerified = true;
  targetGrantStatus: "active" | "removing" | "absent" = "active";
  keyUserId: string | null = "target_user";
  ownerUserId: string | null = "target_user";
  revocationRequestedAt: Date | null = null;
  providerRevokedAt: Date | null = null;
  transactionCount = 0;

  select(selection?: Record<string, unknown>) {
    return {
      from: (table: unknown) => new FakeRevocationQuery(this, table, selection),
    };
  }

  update(table: unknown) {
    return {
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            if (table !== marketApiKeys) return [];
            if (values.providerRevokedAt) {
              expect(state.sessionHeld).toBe(true);
              this.providerRevokedAt = values.providerRevokedAt as Date;
              state.events.push("mapping:provider-revoked");
            } else {
              this.revocationRequestedAt = values.revocationRequestedAt as Date;
              state.events.push("mapping:revocation-requested");
            }
            return [{ id: "key_target" }];
          },
        }),
      }),
    };
  }

  async transaction<T>(callback: (tx: FakeRevocationDatabase) => Promise<T>) {
    this.transactionCount += 1;
    return callback(this);
  }

  rows(
    table: unknown,
    selection?: Record<string, unknown>,
    joins: readonly unknown[] = [],
  ) {
    if (table === systemAdmin) {
      if (this.callerGrantStatus !== "active") return [];
      return [{
        id: "grant_caller",
        activeUserId: "caller_user",
        emailVerified: this.callerEmailVerified,
      }];
    }
    if (table === marketApiKeys) {
      if (selection && "adminGrantId" in selection && !("providerId" in selection)) {
        return [{ adminGrantId: "grant_target" }];
      }
      if (!joins.includes(marketUsageOwner)) return [];
      if (joins.includes(systemAdmin) && this.targetGrantStatus === "absent") {
        return [];
      }
      if (joins.includes(user) && (!this.keyUserId || !this.ownerUserId)) {
        return [];
      }
      return [{
        providerId: "provider_target",
        providerRevokedAt: this.providerRevokedAt,
        revocationRequestedAt: this.revocationRequestedAt,
        usageOwnerId: "owner_target",
        keyUserId: this.keyUserId,
        ownerUserId: this.ownerUserId,
        grantUserId: "target_user",
      }];
    }
    throw new Error("Unexpected revocation select table");
  }
}

class FakeRevocationQuery {
  private readonly joins: unknown[] = [];

  constructor(
    private readonly database: FakeRevocationDatabase,
    private readonly table: unknown,
    private readonly selection?: Record<string, unknown>,
  ) {}

  innerJoin(table: unknown) {
    this.joins.push(table);
    return this;
  }
  where() { return this; }
  for() { return this; }
  async limit(count: number) {
    return this.database
      .rows(this.table, this.selection, this.joins)
      .slice(0, count);
  }
}
