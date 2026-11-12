import { describe, expect, it, vi } from "vitest";

import type { ProviderVerification, UnkeyAdapter } from "../../lib/unkey/client";
import {
  consumeSpendLimit,
  createSpendLimitCodec,
  probeSpendLimit,
} from "../../lib/unkey/spend-limit";

const fixedReset = 1_800_000_000_000;

describe("manual customer-key spend verification", () => {
  it("uses an explicit non-consuming probe with the derived named window", async () => {
    const codec = createSpendLimitCodec("5", 7);
    const verifyKey = vi.fn(async () => verification(codec));
    const adapter = { verifyKey } as unknown as UnkeyAdapter;

    await expect(
      probeSpendLimit(adapter, "tg_public_secret", codec, "key_public"),
    ).resolves.toEqual({
      decision: "allowed",
      limit: codec.providerLimit,
      remaining: codec.providerLimit - 1,
      reset: fixedReset,
      duration: codec.duration,
      quantumNanoUsd: codec.quantumNanoUsd.toString(),
    });
    expect(verifyKey).toHaveBeenCalledWith({
      key: "tg_public_secret",
      permission: "market.public",
      ratelimit: {
        name: codec.name,
        cost: 0,
        limit: codec.providerLimit,
        duration: codec.duration,
      },
    });
  });

  it("uses the supplied positive safe cost exactly once for consumption", async () => {
    const codec = createSpendLimitCodec("5", 7);
    const verifyKey = vi.fn(async () => verification(codec));
    const adapter = { verifyKey } as unknown as UnkeyAdapter;

    await consumeSpendLimit(adapter, "tg_public_secret", codec, 23, "key_public");

    expect(verifyKey).toHaveBeenCalledOnce();
    expect(verifyKey).toHaveBeenCalledWith({
      key: "tg_public_secret",
      permission: "market.public",
      ratelimit: {
        name: codec.name,
        cost: 23,
        limit: codec.providerLimit,
        duration: codec.duration,
      },
    });
  });

  it("accepts only an explicit matching RATE_LIMITED result as a spend denial", async () => {
    const codec = createSpendLimitCodec("5", 7);
    const limited = verification(codec, {
      valid: false,
      code: "RATE_LIMITED",
      exceeded: true,
      remaining: 0,
    });

    await expect(
      probeSpendLimit(adapterWith(limited), "tg_public_secret", codec, "key_public"),
    ).resolves.toMatchObject({ decision: "rate_limited", remaining: 0 });
  });

  it.each([
    ["missing permission", (value: ProviderVerification) => ({ ...value, permissions: [] })],
    ["wrong key", (value: ProviderVerification) => ({ ...value, keyId: "key_other" })],
    [
      "invalid non-limit result",
      (value: ProviderVerification) => ({ ...value, valid: false, code: "FORBIDDEN" }),
    ],
    ["missing named result", (value: ProviderVerification) => ({ ...value, ratelimits: [] })],
    [
      "duplicate named result",
      (value: ProviderVerification) => ({
        ...value,
        ratelimits: [value.ratelimits[0], { ...value.ratelimits[0], id: "rl_duplicate" }],
      }),
    ],
    [
      "auto-applied result",
      (value: ProviderVerification) => ({
        ...value,
        ratelimits: [{ ...value.ratelimits[0], autoApply: true }],
      }),
    ],
    [
      "wrong configured limit",
      (value: ProviderVerification) => ({
        ...value,
        ratelimits: [{ ...value.ratelimits[0], limit: value.ratelimits[0].limit - 1 }],
      }),
    ],
    [
      "wrong duration",
      (value: ProviderVerification) => ({
        ...value,
        ratelimits: [{ ...value.ratelimits[0], duration: value.ratelimits[0].duration + 1 }],
      }),
    ],
    [
      "negative remaining",
      (value: ProviderVerification) => ({
        ...value,
        ratelimits: [{ ...value.ratelimits[0], remaining: -1 }],
      }),
    ],
    [
      "remaining above limit",
      (value: ProviderVerification) => ({
        ...value,
        ratelimits: [
          { ...value.ratelimits[0], remaining: value.ratelimits[0].limit + 1 },
        ],
      }),
    ],
    [
      "invalid reset",
      (value: ProviderVerification) => ({
        ...value,
        ratelimits: [{ ...value.ratelimits[0], reset: 0 }],
      }),
    ],
  ])("fails closed for a %s", async (_label, mutate) => {
    const codec = createSpendLimitCodec("5", 7);
    await expect(
      probeSpendLimit(
        adapterWith(mutate(verification(codec))),
        "tg_public_secret",
        codec,
        "key_public",
      ),
    ).rejects.toThrow();
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an unsafe consumption cost before provider work: %s",
    async (cost) => {
      const codec = createSpendLimitCodec("5", 7);
      const verifyKey = vi.fn(async () => verification(codec));
      const adapter = { verifyKey } as unknown as UnkeyAdapter;

      await expect(
        consumeSpendLimit(adapter, "tg_public_secret", codec, cost, "key_public"),
      ).rejects.toThrow(/positive safe integer/);
      expect(verifyKey).not.toHaveBeenCalled();
    },
  );
});

function verification(
  codec: ReturnType<typeof createSpendLimitCodec>,
  overrides: {
    valid?: boolean;
    code?: string;
    exceeded?: boolean;
    remaining?: number;
  } = {},
): ProviderVerification {
  return {
    valid: overrides.valid ?? true,
    code: overrides.code ?? "VALID",
    keyId: "key_public",
    permissions: ["market.public"],
    ratelimits: [
      {
        id: "rl_spend",
        name: codec.name,
        limit: codec.providerLimit,
        duration: codec.duration,
        remaining: overrides.remaining ?? codec.providerLimit - 1,
        reset: fixedReset,
        exceeded: overrides.exceeded ?? false,
        autoApply: false,
      },
    ],
  };
}

function adapterWith(result: ProviderVerification): UnkeyAdapter {
  return {
    verifyKey: async () => result,
  } as unknown as UnkeyAdapter;
}
