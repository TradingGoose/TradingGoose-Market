import { beforeEach, describe, expect, it, vi } from "vitest";

const ratelimitState = vi.hoisted(() => ({
  options: [] as Array<Record<string, unknown>>,
  identifiers: [] as string[],
  result: { success: true, limit: 100, remaining: 99, reset: 1_900_000_000_000 } as unknown,
  error: null as Error | null,
}));

vi.mock("@unkey/ratelimit", () => ({
  Ratelimit: class {
    constructor(options: Record<string, unknown>) {
      ratelimitState.options.push(options);
    }
    async limit(identifier: string) {
      ratelimitState.identifiers.push(identifier);
      if (ratelimitState.error) throw ratelimitState.error;
      return ratelimitState.result;
    }
  },
}));

import {
  MARKET_ANONYMOUS_IDENTIFIER,
  createAnonymousLimiter,
} from "../../lib/unkey/anonymous";

beforeEach(() => {
  ratelimitState.options.length = 0;
  ratelimitState.identifiers.length = 0;
  ratelimitState.result = {
    success: true,
    limit: 100,
    remaining: 99,
    reset: 1_900_000_000_000,
  };
  ratelimitState.error = null;
});

describe("one service-wide anonymous Unkey bucket", () => {
  it("uses the constant server-owned identifier and exact configured window", async () => {
    const limiter = createAnonymousLimiter({
      rootKey: "anonymous-root",
      namespaceId: "market-anonymous",
      limit: 100,
      durationSeconds: 60,
      baseUrl: "https://unkey.test",
    });

    await expect(limiter()).resolves.toEqual({
      allowed: true,
      providerAvailable: true,
      limit: 100,
      remaining: 99,
      reset: 1_900_000_000_000,
    });
    expect(ratelimitState.identifiers).toEqual([MARKET_ANONYMOUS_IDENTIFIER]);
    expect(ratelimitState.options[0]).toMatchObject({
      rootKey: "anonymous-root",
      namespace: "market-anonymous",
      limit: 100,
      duration: 60_000,
      disableTelemetry: true,
      baseUrl: "https://unkey.test",
    });
  });

  it("marks a malformed/fallback provider result unavailable rather than allowing traffic", async () => {
    ratelimitState.result = {
      success: false,
      limit: 0,
      remaining: 0,
      reset: 1_900_000_000_000,
    };
    const limiter = createAnonymousLimiter({
      rootKey: "anonymous-root",
      namespaceId: "market-anonymous",
      limit: 100,
      durationSeconds: 60,
    });

    await expect(limiter()).resolves.toMatchObject({
      allowed: false,
      providerAvailable: false,
    });
  });

  it.each([
    null,
    { success: "true", limit: 100, remaining: 99, reset: 1_900_000_000_000 },
    { success: true, limit: 99, remaining: 98, reset: 1_900_000_000_000 },
    { success: true, limit: 100, remaining: -1, reset: 1_900_000_000_000 },
    { success: true, limit: 100, remaining: 99, reset: Number.NaN },
  ])("fails closed for malformed provider result %#", async (result) => {
    ratelimitState.result = result;
    const limiter = createAnonymousLimiter({
      rootKey: "anonymous-root",
      namespaceId: "market-anonymous",
      limit: 100,
      durationSeconds: 60,
    });

    await expect(limiter()).resolves.toMatchObject({
      allowed: false,
      providerAvailable: false,
      limit: 0,
      remaining: 0,
    });
  });

  it("fails closed when the provider call throws", async () => {
    ratelimitState.error = new Error("provider secret");
    const limiter = createAnonymousLimiter({
      rootKey: "anonymous-root",
      namespaceId: "market-anonymous",
      limit: 100,
      durationSeconds: 60,
    });

    await expect(limiter()).resolves.toMatchObject({
      allowed: false,
      providerAvailable: false,
    });
  });
});
