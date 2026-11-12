import { describe, expect, it, vi } from "vitest";

import type { ProviderVerification, UnkeyAdapter } from "../../lib/unkey/client";
import {
  consumeSpendLimit,
  createSpendLimitCodec,
  exactRequiredProviderUnits,
  probeSpendLimit,
  providerCostForRequest,
} from "../../lib/unkey/spend-limit";

describe("adaptive arbitrary-size per-key spend limits", () => {
  it.each([
    ["1", 1],
    ["5", 17],
    ["9007199254740992", 30],
    ["999999999999999999999999999999999999999999999999", 30],
  ] as const)("keeps every provider integer safe for $%s over %d days", (limitUsd, days) => {
    const codec = createSpendLimitCodec(limitUsd, days);
    expect(codec.limitNanoUsd).toBe(BigInt(limitUsd) * 1_000_000_000n);
    expect(Number.isSafeInteger(codec.providerLimit)).toBe(true);
    expect(codec.providerLimit).toBeGreaterThan(0);
    expect(Number.isSafeInteger(codec.duration)).toBe(true);
    expect(codec.duration).toBe(days * 86_400_000);
    expect(codec.name).toMatch(/^market-spend-q_[A-Za-z0-9_-]{43}$/);
    const requestCost = providerCostForRequest(1_000_000n, codec.quantumNanoUsd);
    expect(Number.isSafeInteger(requestCost)).toBe(true);
    expect(requestCost).toBeGreaterThan(0);
  });

  it("ceiling-reserves prior exact usage but never beyond the provider limit", () => {
    const codec = createSpendLimitCodec("9007199254740992", 9);
    const oneQuantumMinusOne = codec.quantumNanoUsd - 1n;
    expect(exactRequiredProviderUnits(oneQuantumMinusOne, codec)).toBe(1);
    expect(exactRequiredProviderUnits(codec.limitNanoUsd * 2n, codec)).toBe(
      codec.providerLimit,
    );
  });

  it("uses a cost-zero matching probe then one exact positive consumption", async () => {
    const codec = createSpendLimitCodec("5", 7);
    const calls: unknown[] = [];
    const adapter = {
      verifyKey: vi.fn(async (input: unknown) => {
        calls.push(input);
        return verification(codec);
      }),
    } as unknown as UnkeyAdapter;

    await probeSpendLimit(adapter, "tg_secret", codec, "provider_key");
    await consumeSpendLimit(adapter, "tg_secret", codec, 23, "provider_key");

    expect(calls).toEqual([
      expect.objectContaining({ ratelimit: expect.objectContaining({ cost: 0 }) }),
      expect.objectContaining({ ratelimit: expect.objectContaining({ cost: 23 }) }),
    ]);
  });

  it.each([
    (value: ProviderVerification) => ({ ...value, keyId: "other" }),
    (value: ProviderVerification) => ({ ...value, permissions: [] }),
    (value: ProviderVerification) => ({ ...value, ratelimits: [] }),
    (value: ProviderVerification) => ({
      ...value,
      ratelimits: [value.ratelimits[0], value.ratelimits[0]],
    }),
    (value: ProviderVerification) => ({
      ...value,
      ratelimits: [{ ...value.ratelimits[0], duration: value.ratelimits[0].duration + 1 }],
    }),
  ])("fails closed for mismatched provider observations", async (mutate) => {
    const codec = createSpendLimitCodec("5", 7);
    const adapter = {
      verifyKey: vi.fn(async () => mutate(verification(codec))),
    } as unknown as UnkeyAdapter;
    await expect(probeSpendLimit(adapter, "tg_secret", codec, "provider_key")).rejects.toThrow();
  });
});

function verification(codec: ReturnType<typeof createSpendLimitCodec>): ProviderVerification {
  return {
    valid: true,
    code: "VALID",
    keyId: "provider_key",
    permissions: ["market.public"],
    ratelimits: [{
      id: "limit_1",
      name: codec.name,
      limit: codec.providerLimit,
      duration: codec.duration,
      remaining: codec.providerLimit,
      reset: 1_900_000_000_000,
      exceeded: false,
      autoApply: false,
    }],
  };
}
