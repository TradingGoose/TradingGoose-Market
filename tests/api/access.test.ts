import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  marketApiKeys,
  marketApiUsageCompletion,
  marketApiUsageEvent,
  subscription,
  userStats,
} from "@tradinggoose/db/schema";

const accessState = vi.hoisted(() => ({
  config: {
    billing: { enabled: false, usdPer1000Reads: "1", requestNanoUsd: 1_000_000n },
    unkey: { anonymous: null },
  } as Record<string, unknown>,
  provider: { verifyKey: vi.fn() } as Record<string, unknown>,
  database: null as unknown,
  anonymousFactory: vi.fn(),
  thresholdBilling: vi.fn(),
  billingLocks: vi.fn(),
}));

vi.mock("@/lib/environment", () => ({
  getMarketRuntimeConfig: () => accessState.config,
}));
vi.mock("@/lib/unkey/runtime", () => ({
  getMarketKeyProvider: () => accessState.provider,
}));
vi.mock("@/lib/db/runtime", () => ({ requireDatabase: () => accessState.database }));
vi.mock("@/lib/unkey/anonymous", () => ({
  createAnonymousLimiter: (...args: unknown[]) => accessState.anonymousFactory(...args),
}));
vi.mock("@/lib/billing/threshold-billing", () => ({
  checkAndBillMarketThreshold: (...args: unknown[]) =>
    accessState.thresholdBilling(...args),
}));
vi.mock("@/lib/db/locks", () => ({
  acquireAdminGrantLock: vi.fn(async () => undefined),
  acquireApiKeyLock: vi.fn(async () => undefined),
  withAdminGrantHandlerLock: async (
    _grantId: string,
    callback: (database: unknown) => unknown,
  ) => callback(accessState.database),
  withBillingSubjectAndApiKeyHandlerLocks: (...args: unknown[]) =>
    accessState.billingLocks(...args),
}));

import { handleKeyedMarketRoute } from "../../lib/market-api/core/access";
import { resolveKeyedMarketRoute } from "../../lib/market-api/core/manifest";

beforeEach(() => {
  accessState.config = {
    billing: { enabled: false, usdPer1000Reads: "1", requestNanoUsd: 1_000_000n },
    unkey: { anonymous: null },
  };
  accessState.provider = { verifyKey: vi.fn() };
  accessState.database = null;
  accessState.anonymousFactory.mockReset();
  accessState.thresholdBilling.mockReset().mockResolvedValue(undefined);
  accessState.billingLocks.mockReset().mockImplementation(
    async (_userId: string, _keyId: string, callback: (database: unknown) => unknown) =>
      callback(accessState.database),
  );
});

describe("exclusive Market API actors", () => {
  it("projects an allowed anonymous reset as conservative absolute Unix seconds", async () => {
    accessState.config = {
      billing: { enabled: false, usdPer1000Reads: "1", requestNanoUsd: 1_000_000n },
      unkey: {
        anonymous: {
          limit: 100,
          durationSeconds: 60,
          namespaceId: "anonymous_allowed",
          rootKey: "anonymous_allowed_root",
        },
      },
    };
    const limiter = vi.fn(async () => ({
      allowed: true,
      providerAvailable: true,
      limit: 100,
      remaining: 99,
      reset: 1_900_000_000_000,
    }));
    accessState.anonymousFactory.mockReturnValue(limiter);
    const handler = vi.fn(async () => Response.json({ ok: true }));

    const response = await handleKeyedMarketRoute(
      new Request("https://market.example.com/api/search/cities?version=v1"),
      resolveKeyedMarketRoute("/api/search/cities")!,
      handler,
    );

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    expect(limiter).toHaveBeenCalledOnce();
    expect(response.headers.get("X-Market-RateLimit-Limit")).toBe("100");
    expect(response.headers.get("X-Market-RateLimit-Remaining")).toBe("99");
    expect(response.headers.get("X-Market-RateLimit-Reset")).toBe("1900000000");
    expect(response.headers.get("Retry-After")).toBeNull();
  });

  it("keeps denied anonymous retry arithmetic in milliseconds while rounding reset upward", async () => {
    accessState.config = {
      billing: { enabled: false, usdPer1000Reads: "1", requestNanoUsd: 1_000_000n },
      unkey: {
        anonymous: {
          limit: 50,
          durationSeconds: 61,
          namespaceId: "anonymous_denied",
          rootKey: "anonymous_denied_root",
        },
      },
    };
    const limiter = vi.fn(async () => ({
      allowed: false,
      providerAvailable: true,
      limit: 50,
      remaining: 0,
      reset: 1_900_000_001_001,
    }));
    accessState.anonymousFactory.mockReturnValue(limiter);
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const now = vi.spyOn(Date, "now").mockReturnValue(1_900_000_000_250);

    try {
      const response = await handleKeyedMarketRoute(
        new Request("https://market.example.com/api/search/countries?version=v1"),
        resolveKeyedMarketRoute("/api/search/countries")!,
        handler,
      );

      expect(response.status).toBe(429);
      expect(await response.json()).toEqual({
        error: "Anonymous request limit exceeded",
        code: "ANONYMOUS_RATE_LIMITED",
      });
      expect(handler).not.toHaveBeenCalled();
      expect(limiter).toHaveBeenCalledOnce();
      expect(response.headers.get("X-Market-RateLimit-Limit")).toBe("50");
      expect(response.headers.get("X-Market-RateLimit-Remaining")).toBe("0");
      expect(response.headers.get("X-Market-RateLimit-Reset")).toBe("1900000002");
      expect(response.headers.get("Retry-After")).toBe("1");
    } finally {
      now.mockRestore();
    }
  });

  it("allows anonymous traffic only on a public-read descriptor", async () => {
    const handler = vi.fn(async (_context, actor) => Response.json({ actor }));
    const publicRoute = resolveKeyedMarketRoute("/api/search/cities")!;
    const privateRoute = resolveKeyedMarketRoute("/api/update/crypto-rank")!;

    const publicResponse = await handleKeyedMarketRoute(
      new Request("https://market.example.com/api/search/cities?version=v1"),
      publicRoute,
      handler,
    );
    const privateResponse = await handleKeyedMarketRoute(
      new Request("https://market.example.com/api/update/crypto-rank?version=v1", {
        method: "POST",
      }),
      privateRoute,
      handler,
    );

    expect(publicResponse.status).toBe(200);
    expect(await publicResponse.json()).toEqual({ actor: null });
    expect(privateResponse.status).toBe(401);
    expect(await privateResponse.json()).toMatchObject({ code: "API_KEY_REQUIRED" });
    expect(handler).toHaveBeenCalledOnce();
    expect(accessState.provider.verifyKey).not.toHaveBeenCalled();
    expect(accessState.anonymousFactory).not.toHaveBeenCalled();
  });

  it.each(["factory", "limiter"] as const)(
    "redacts a thrown anonymous %s failure as a fail-closed 503",
    async (failure) => {
      accessState.config = {
        billing: { enabled: false, usdPer1000Reads: "1", requestNanoUsd: 1_000_000n },
        unkey: {
          anonymous: {
            limit: 10,
            durationSeconds: 60,
            namespaceId: "anonymous_throw",
            rootKey: "anonymous_throw_root",
          },
        },
      };
      if (failure === "factory") {
        accessState.anonymousFactory.mockImplementation(() => {
          throw new Error("secret anonymous provider detail");
        });
      } else {
        accessState.anonymousFactory.mockReturnValue(
          vi.fn(async () => {
            throw new Error("secret anonymous provider detail");
          }),
        );
      }

      const response = await handleKeyedMarketRoute(
        new Request("https://market.example.com/api/search/cities?version=v1"),
        resolveKeyedMarketRoute("/api/search/cities")!,
        vi.fn(),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "Anonymous access is temporarily unavailable",
        code: "ANONYMOUS_LIMIT_UNAVAILABLE",
      });
    },
  );

  it("treats a present empty x-api-key as keyed and never falls back to anonymous", async () => {
    accessState.provider.verifyKey = vi.fn(async () => ({
      valid: false,
      code: "NOT_FOUND",
      keyId: null,
      permissions: [],
      ratelimits: [],
    }));
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const route = resolveKeyedMarketRoute("/api/get/currency")!;

    const response = await handleKeyedMarketRoute(
      new Request("https://market.example.com/api/get/currency?version=v1", {
        headers: { "x-api-key": "" },
      }),
      route,
      handler,
    );

    expect(response.status).toBe(401);
    expect(accessState.provider.verifyKey).toHaveBeenCalledWith({
      key: "",
      permission: "market.public",
    });
    expect(accessState.anonymousFactory).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("cross-denies provider-valid key classes before admission or handler work", async () => {
    accessState.provider.verifyKey = vi.fn(async () => ({
      valid: true,
      code: "VALID",
      keyId: "provider_private",
      permissions: ["market.public"],
      ratelimits: [],
    }));
    accessState.database = mappingDatabase({
      id: "local_private",
      unkeyKeyId: "provider_private",
      keyClass: "private",
      revocationRequestedAt: null,
      providerRevokedAt: null,
    });
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const route = resolveKeyedMarketRoute("/api/search/countries")!;

    const response = await handleKeyedMarketRoute(
      new Request("https://market.example.com/api/search/countries?version=v1", {
        headers: { "x-api-key": "tg_private" },
      }),
      route,
      handler,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "API_KEY_FORBIDDEN" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("admits a current-grant private actor without a customer spend-limit operation", async () => {
    accessState.provider.verifyKey = vi.fn(async () => ({
      valid: true,
      code: "VALID",
      keyId: "provider_private",
      permissions: ["market.private"],
      ratelimits: [],
    }));
    accessState.database = privateAdmissionDatabase();
    const handler = vi.fn(async (_context, actor) => Response.json({ actor }));
    const route = resolveKeyedMarketRoute("/api/update/listing-rank")!;

    const response = await handleKeyedMarketRoute(
      new Request("https://market.example.com/api/update/listing-rank?version=v1", {
        method: "POST",
        headers: { "x-api-key": "tg_private" },
      }),
      route,
      handler,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      actor: {
        keyId: "local_private",
        keyClass: "private",
        adminGrantId: "grant_1",
      },
    });
    expect(accessState.provider.verifyKey).toHaveBeenCalledOnce();
    expect(accessState.provider.verifyKey).toHaveBeenCalledWith({
      key: "tg_private",
      permission: "market.private",
    });
  });

  it("denies a provider-valid private key when its owning user is unverified", async () => {
    accessState.provider.verifyKey = vi.fn(async () => ({
      valid: true,
      code: "VALID",
      keyId: "provider_private",
      permissions: ["market.private"],
      ratelimits: [],
    }));
    accessState.database = privateAdmissionDatabase({ emailVerified: false });
    const handler = vi.fn();

    const response = await handleKeyedMarketRoute(
      new Request("https://market.example.com/api/update/listing-rank?version=v1", {
        method: "POST",
        headers: { "x-api-key": "tg_private" },
      }),
      resolveKeyedMarketRoute("/api/update/listing-rank")!,
      handler,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "API_KEY_FORBIDDEN" });
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    { emailVerified: false, ownerUserId: "user_1", label: "unverified owner" },
    { emailVerified: true, ownerUserId: "user_other", label: "owner drift" },
  ])("denies a provider-valid public key with $label", async (invalid) => {
    accessState.provider.verifyKey = vi.fn(async () => ({
      valid: true,
      code: "VALID",
      keyId: "provider_public",
      permissions: ["market.public"],
      ratelimits: [],
    }));
    accessState.database = publicAdmissionDatabase(invalid);
    const handler = vi.fn();

    const response = await handleKeyedMarketRoute(
      new Request("https://market.example.com/api/search/cities?version=v1", {
        headers: { "x-api-key": "tg_public" },
      }),
      resolveKeyedMarketRoute("/api/search/cities")!,
      handler,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "API_KEY_FORBIDDEN" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("preserves the committed handler response when threshold billing fails and retries later", async () => {
    accessState.config = {
      billing: { enabled: true, usdPer1000Reads: "1", requestNanoUsd: 1_000_000n },
      unkey: { anonymous: null },
    };
    accessState.provider.verifyKey = vi.fn(async () => ({
      valid: true,
      code: "VALID",
      keyId: "provider_public",
      permissions: ["market.public"],
      ratelimits: [],
    }));
    accessState.database = publicAdmissionDatabase({
      emailVerified: true,
      ownerUserId: "user_1",
    });
    const thresholdFailure = new Error("threshold provider unavailable");
    accessState.thresholdBilling
      .mockRejectedValueOnce(thresholdFailure)
      .mockResolvedValueOnce(undefined);
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const request = () =>
      new Request("https://market.example.com/api/search/cities?version=v1", {
        headers: { "x-api-key": "tg_public" },
      });

    const first = await handleKeyedMarketRoute(
      request(),
      resolveKeyedMarketRoute("/api/search/cities")!,
      handler,
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });

    const retry = await handleKeyedMarketRoute(
      request(),
      resolveKeyedMarketRoute("/api/search/cities")!,
      handler,
    );
    expect(retry.status).toBe(200);
    expect(accessState.thresholdBilling).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("redacts malformed verification and initial mapping failures", async () => {
    accessState.provider.verifyKey = vi.fn(async () => null);
    const route = resolveKeyedMarketRoute("/api/get/timezone")!;
    const malformed = await handleKeyedMarketRoute(
      new Request("https://market.example.com/api/get/timezone?version=v1", {
        headers: { "x-api-key": "tg_malformed" },
      }),
      route,
      vi.fn(),
    );
    expect(malformed.status).toBe(503);
    expect(await malformed.json()).toMatchObject({ code: "KEY_SERVICE_UNAVAILABLE" });

    accessState.provider.verifyKey = vi.fn(async () => ({
      valid: true,
      code: "VALID",
      keyId: "provider_mapping_error",
      permissions: ["market.public"],
      ratelimits: [],
    }));
    accessState.database = {
      select: vi.fn(() => {
        throw new Error("sensitive database failure");
      }),
    };
    const mappingFailure = await handleKeyedMarketRoute(
      new Request("https://market.example.com/api/get/timezone?version=v1", {
        headers: { "x-api-key": "tg_mapping" },
      }),
      route,
      vi.fn(),
    );
    expect(mappingFailure.status).toBe(503);
    expect(await mappingFailure.json()).toEqual({
      error: "API request admission is temporarily unavailable",
      code: "ADMISSION_UNAVAILABLE",
    });
  });

  it.each([
    { code: "FORBIDDEN", status: 403 },
    { code: "INSUFFICIENT_PERMISSIONS", status: 403 },
    { code: "NOT_FOUND", status: 401 },
  ])("maps verification denial without touching Market persistence: %#", async ({ code, status }) => {
    accessState.provider.verifyKey = vi.fn(async () => ({
      valid: false,
      code,
      keyId: null,
      permissions: [],
      ratelimits: [],
    }));
    const database = mappingDatabase(null);
    accessState.database = database;
    const route = resolveKeyedMarketRoute("/api/get/timezone")!;

    const response = await handleKeyedMarketRoute(
      new Request("https://market.example.com/api/get/timezone?version=v1", {
        headers: { "x-api-key": "tg_unknown" },
      }),
      route,
      vi.fn(),
    );

    expect(response.status).toBe(status);
    expect(database.select).not.toHaveBeenCalled();
  });
});

function mappingDatabase(mapping: Record<string, unknown> | null) {
  const select = vi.fn(() => {
    const builder = {
      from() { return builder; },
      where() { return builder; },
      async limit() { return mapping ? [mapping] : []; },
    };
    return builder;
  });
  return { select };
}

function privateAdmissionDatabase(input: { emailVerified?: boolean } = {}) {
  const key = {
    id: "local_private",
    usageOwnerId: "owner_1",
    userId: "admin_1",
    adminGrantId: "grant_1",
    unkeyKeyId: "provider_private",
    keyClass: "private",
    revocationRequestedAt: null,
    providerRevokedAt: null,
  };
  const operations = {
    select(selection?: Record<string, unknown>) {
      const builder = {
        from() { return builder; },
        innerJoin() { return builder; },
        where() { return builder; },
        for() { return builder; },
        limit() { return builder; },
        then(resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) {
          const value = selection
            ? [{
                key,
                grant: { id: "grant_1", userId: "admin_1", status: "active" },
                owner: { id: "owner_1", userId: "admin_1" },
                activeUserId: "admin_1",
                emailVerified: input.emailVerified ?? true,
              }]
            : [key];
          return Promise.resolve(value).then(resolve, reject);
        },
      };
      return builder;
    },
    insert() {
      let values: Record<string, unknown> = {};
      const builder = {
        values(next: Record<string, unknown>) { values = next; return builder; },
        onConflictDoNothing() { return builder; },
        async returning() { return [{ eventId: values.eventId }]; },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve(undefined).then(resolve, reject);
        },
      };
      return builder;
    },
    async execute() {
      return [{ now: new Date("2026-07-19T00:00:00.000Z") }];
    },
  };
  return {
    ...operations,
    transaction: async <T>(callback: (tx: typeof operations) => Promise<T>) =>
      callback(operations),
  };
}

function publicAdmissionDatabase(input: {
  emailVerified: boolean;
  ownerUserId: string;
}) {
  const key = {
    id: "local_public",
    usageOwnerId: "owner_1",
    userId: "user_1",
    adminGrantId: null,
    unkeyKeyId: "provider_public",
    keyClass: "public",
    spendLimitUsd: null,
    spendWindowDays: null,
    revocationRequestedAt: null,
    providerRevokedAt: null,
  };
  const joined = {
    key,
    owner: { id: "owner_1", userId: input.ownerUserId },
    activeUserId: "user_1",
    emailVerified: input.emailVerified,
  };
  const operations = {
    select(selection?: Record<string, unknown>) {
      return {
        from(table: unknown) {
          const rows = () => {
            if (table === marketApiKeys) {
              if (selection && "key" in selection) return [joined];
              if (selection && "userId" in selection) return [{ userId: "user_1" }];
              return [key];
            }
            if (table === subscription) {
              return [{
                id: "sub_local",
                referenceType: "user",
                referenceId: "user_1",
                plan: "payg",
                status: "active",
                stripeCustomerId: "cus_1",
                stripeSubscriptionId: "sub_provider",
              }];
            }
            if (table === userStats) {
              return [{
                id: "stats_1",
                userId: "user_1",
                usageOwnerId: "owner_1",
                billingReferenceId: "user_1",
              }];
            }
            if (table === marketApiUsageCompletion) return [];
            throw new Error("Unexpected public admission select table");
          };
          const builder = {
            innerJoin() { return builder; },
            where() { return builder; },
            for() { return builder; },
            async limit(count: number) { return rows().slice(0, count); },
          };
          return builder;
        },
      };
    },
    insert(table: unknown) {
      let values: Record<string, unknown> = {};
      const builder = {
        values(next: Record<string, unknown>) { values = next; return builder; },
        onConflictDoNothing() { return builder; },
        async returning() {
          return table === marketApiUsageCompletion
            ? [{ eventId: values.eventId }]
            : [];
        },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          if (table !== marketApiUsageEvent && table !== marketApiUsageCompletion) {
            return Promise.reject(new Error("Unexpected public admission insert table"))
              .then(resolve, reject);
          }
          return Promise.resolve(undefined).then(resolve, reject);
        },
      };
      return builder;
    },
    update(table: unknown) {
      return {
        set() {
          return {
            async where() {
              if (table !== userStats) throw new Error("Unexpected public update table");
            },
          };
        },
      };
    },
    async execute() {
      return [{ now: new Date("2026-07-19T00:00:00.000Z") }];
    },
  };
  return {
    ...operations,
    transaction: async <T>(callback: (tx: typeof operations) => Promise<T>) =>
      callback(operations),
  };
}
