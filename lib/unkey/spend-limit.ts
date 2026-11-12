import { createHash } from "node:crypto";
import type { ProviderVerification, UnkeyAdapter } from "./client";

const NANO_USD_PER_USD = 1_000_000_000n;
const MAX_PROVIDER_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

export type SpendLimitCodec = {
  limitNanoUsd: bigint;
  quantumNanoUsd: bigint;
  providerLimit: number;
  duration: number;
  name: string;
};

export type SpendObservation = {
  decision: "allowed" | "rate_limited";
  limit: number;
  remaining: number;
  reset: number;
  duration: number;
  quantumNanoUsd: string;
};

export function ceilDiv(value: bigint, divisor: bigint) {
  if (divisor <= 0n) throw new RangeError("divisor must be positive");
  if (value <= 0n) return 0n;
  return (value + divisor - 1n) / divisor;
}

export function createSpendLimitCodec(limitUsd: string, windowDays: number): SpendLimitCodec {
  if (!/^[1-9]\d*$/.test(limitUsd)) {
    throw new TypeError("limitUsd must be a canonical positive whole-dollar string");
  }
  if (!Number.isSafeInteger(windowDays) || windowDays < 1 || windowDays > 30) {
    throw new TypeError("windowDays must be an integer from 1 through 30");
  }

  const limitNanoUsd = BigInt(limitUsd) * NANO_USD_PER_USD;
  const quantumNanoUsd = maxBigInt(1n, ceilDiv(limitNanoUsd, MAX_PROVIDER_INTEGER));
  const providerLimitBigInt = limitNanoUsd / quantumNanoUsd;
  const providerLimit = Number(providerLimitBigInt);
  if (!Number.isSafeInteger(providerLimit) || providerLimit <= 0) {
    throw new RangeError("limit cannot be represented by the provider codec");
  }

  const digest = createHash("sha256")
    .update(quantumNanoUsd.toString())
    .digest("base64url");

  return {
    limitNanoUsd,
    quantumNanoUsd,
    providerLimit,
    duration: windowDays * 86_400_000,
    name: `market-spend-q_${digest}`,
  };
}

export function providerCostForRequest(nextRequestNanoUsd: bigint, quantumNanoUsd: bigint) {
  const cost = Number(ceilDiv(nextRequestNanoUsd, quantumNanoUsd));
  if (!Number.isSafeInteger(cost) || cost <= 0) {
    throw new RangeError("request cost cannot be represented safely");
  }
  return cost;
}

export function exactRequiredProviderUnits(
  exactRollingNanoUsd: bigint,
  codec: SpendLimitCodec,
) {
  return Number(
    minBigInt(
      BigInt(codec.providerLimit),
      ceilDiv(exactRollingNanoUsd, codec.quantumNanoUsd),
    ),
  );
}

export async function probeSpendLimit(
  adapter: UnkeyAdapter,
  rawKey: string,
  codec: SpendLimitCodec,
  expectedProviderKeyId: string,
): Promise<SpendObservation> {
  const verification = await adapter.verifyKey({
    key: rawKey,
    permission: "market.public",
    ratelimit: {
      name: codec.name,
      cost: 0,
      limit: codec.providerLimit,
      duration: codec.duration,
    },
  });
  return observationFromVerification(verification, codec, expectedProviderKeyId);
}

export async function consumeSpendLimit(
  adapter: UnkeyAdapter,
  rawKey: string,
  codec: SpendLimitCodec,
  cost: number,
  expectedProviderKeyId: string,
): Promise<SpendObservation> {
  if (!Number.isSafeInteger(cost) || cost <= 0) {
    throw new TypeError("provider cost must be a positive safe integer");
  }
  const verification = await adapter.verifyKey({
    key: rawKey,
    permission: "market.public",
    ratelimit: {
      name: codec.name,
      cost,
      limit: codec.providerLimit,
      duration: codec.duration,
    },
  });
  return observationFromVerification(verification, codec, expectedProviderKeyId);
}

function observationFromVerification(
  verification: ProviderVerification,
  codec: SpendLimitCodec,
  expectedProviderKeyId: string,
): SpendObservation {
  if (
    verification.keyId !== expectedProviderKeyId ||
    !verification.permissions.includes("market.public") ||
    (!verification.valid && verification.code !== "RATE_LIMITED")
  ) {
    throw new Error("Spend-limit verification no longer matches the authorized key");
  }
  const matchingResults = verification.ratelimits.filter(
    (candidate) => candidate.name === codec.name,
  );
  if (matchingResults.length !== 1) {
    throw new Error("Requested spend limit result must appear exactly once");
  }
  const result = matchingResults[0];
  if (
    result.autoApply !== false ||
    result.limit !== codec.providerLimit ||
    result.duration !== codec.duration
  ) {
    throw new Error("Requested spend limit result does not match the active configuration");
  }
  if (
    !Number.isSafeInteger(result.limit) ||
    result.limit <= 0 ||
    !Number.isSafeInteger(result.duration) ||
    result.duration <= 0 ||
    !Number.isSafeInteger(result.remaining) ||
    result.remaining < 0 ||
    result.remaining > result.limit ||
    !Number.isSafeInteger(result.reset) ||
    result.reset <= 0
  ) {
    throw new Error("Requested spend limit result is malformed");
  }
  return {
    decision: verification.code === "RATE_LIMITED" || result.exceeded ? "rate_limited" : "allowed",
    limit: result.limit,
    remaining: result.remaining,
    reset: result.reset,
    duration: result.duration,
    quantumNanoUsd: codec.quantumNanoUsd.toString(),
  };
}

function maxBigInt(left: bigint, right: bigint) {
  return left > right ? left : right;
}

function minBigInt(left: bigint, right: bigint) {
  return left < right ? left : right;
}
