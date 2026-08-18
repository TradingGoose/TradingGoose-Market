import { describe, expect, it } from "vitest";
import {
  createSpendLimitCodec,
  exactRequiredProviderUnits,
  probeSpendLimit,
  providerCostForRequest,
} from "./spend-limit";
import type { UnkeyAdapter } from "./client";

describe("adaptive spend-limit codec", () => {
  it("uses direct nano-USD units when they fit", () => {
    const codec = createSpendLimitCodec("5", 7);
    expect(codec.limitNanoUsd).toBe(5_000_000_000n);
    expect(codec.quantumNanoUsd).toBe(1n);
    expect(codec.providerLimit).toBe(5_000_000_000);
    expect(codec.duration).toBe(7 * 86_400_000);
    expect(codec.name).toMatch(/^market-spend-q_[A-Za-z0-9_-]{43}$/);
  });

  it("adapts values larger than safe direct transport", () => {
    const codec = createSpendLimitCodec("999999999999999999999999999999", 30);
    expect(codec.quantumNanoUsd).toBeGreaterThan(1n);
    expect(Number.isSafeInteger(codec.providerLimit)).toBe(true);
    expect(codec.providerLimit).toBeGreaterThan(0);
    expect(providerCostForRequest(1_000_000n, codec.quantumNanoUsd)).toBe(1);
  });

  it("ceiling-rounds exact prior usage conservatively", () => {
    const codec = createSpendLimitCodec("9007199254740992", 1);
    const required = exactRequiredProviderUnits(1_000_000_001n, codec);
    expect(required).toBeGreaterThan(0);
  });

  it("accepts exactly one manual result bound to the authorized public key", async () => {
    const codec = createSpendLimitCodec("5", 7);
    const adapter = adapterWithVerification({
      valid: true,
      code: "VALID",
      keyId: "key_public",
      permissions: ["market.public"],
      ratelimits: [manualResult(codec)],
    });
    await expect(
      probeSpendLimit(adapter, "secret", codec, "key_public"),
    ).resolves.toMatchObject({ decision: "allowed", remaining: codec.providerLimit });
  });

  it.each([
    {
      label: "wrong provider key",
      mutate: (result: ReturnType<typeof verification>) => ({ ...result, keyId: "other" }),
    },
    {
      label: "invalid verification",
      mutate: (result: ReturnType<typeof verification>) => ({
        ...result,
        valid: false,
        code: "FORBIDDEN",
      }),
    },
    {
      label: "auto-applied result",
      mutate: (result: ReturnType<typeof verification>) => ({
        ...result,
        ratelimits: [{ ...result.ratelimits[0], autoApply: true }],
      }),
    },
    {
      label: "duplicate named result",
      mutate: (result: ReturnType<typeof verification>) => ({
        ...result,
        ratelimits: [result.ratelimits[0], { ...result.ratelimits[0], id: "rl_2" }],
      }),
    },
  ])("fails closed for $label", async ({ mutate }) => {
    const codec = createSpendLimitCodec("5", 7);
    const result = mutate(verification(codec));
    await expect(
      probeSpendLimit(adapterWithVerification(result), "secret", codec, "key_public"),
    ).rejects.toThrow();
  });
});

function manualResult(codec: ReturnType<typeof createSpendLimitCodec>) {
  return {
    exceeded: false,
    id: "rl_1",
    name: codec.name,
    limit: codec.providerLimit,
    duration: codec.duration,
    reset: Date.now() + codec.duration,
    remaining: codec.providerLimit,
    autoApply: false,
  };
}

function verification(codec: ReturnType<typeof createSpendLimitCodec>) {
  return {
    valid: true,
    code: "VALID",
    keyId: "key_public",
    permissions: ["market.public"],
    ratelimits: [manualResult(codec)],
  };
}

function adapterWithVerification(
  result: ReturnType<typeof verification>,
): UnkeyAdapter {
  return {
    verifyKey: async () => result,
  } as unknown as UnkeyAdapter;
}
