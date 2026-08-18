import { Ratelimit } from "@unkey/ratelimit";

export const MARKET_ANONYMOUS_IDENTIFIER = "tradinggoose-market-anonymous";

export type AnonymousLimitConfig = {
  limit: number;
  durationSeconds: number;
  namespaceId: string;
  rootKey: string;
  baseUrl?: string;
};

export type AnonymousLimitResult = {
  allowed: boolean;
  providerAvailable: boolean;
  limit: number;
  remaining: number;
  reset: number;
};

export function createAnonymousLimiter(
  config: AnonymousLimitConfig,
  identifier = MARKET_ANONYMOUS_IDENTIFIER,
) {
  const limiter = new Ratelimit({
    rootKey: config.rootKey,
    namespace: config.namespaceId,
    limit: config.limit,
    duration: config.durationSeconds * 1_000,
    timeout: {
      ms: 10_000,
      fallback: () => ({
        success: false,
        limit: 0,
        remaining: 0,
        reset: Date.now() + config.durationSeconds * 1_000,
      }),
    },
    onError: () => ({
      success: false,
      limit: 0,
      remaining: 0,
      reset: Date.now() + config.durationSeconds * 1_000,
    }),
    disableTelemetry: true,
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
  });

  return async (): Promise<AnonymousLimitResult> => {
    const unavailable = (): AnonymousLimitResult => ({
      allowed: false,
      providerAvailable: false,
      limit: 0,
      remaining: 0,
      reset: Date.now() + config.durationSeconds * 1_000,
    });
    let result: unknown;
    try {
      result = await limiter.limit(identifier);
    } catch {
      return unavailable();
    }
    if (
      !result ||
      typeof result !== "object" ||
      !("success" in result) ||
      typeof result.success !== "boolean" ||
      !("limit" in result) ||
      typeof result.limit !== "number" ||
      !Number.isSafeInteger(result.limit) ||
      result.limit !== config.limit ||
      !("remaining" in result) ||
      typeof result.remaining !== "number" ||
      !Number.isSafeInteger(result.remaining) ||
      result.remaining < 0 ||
      result.remaining > config.limit ||
      !("reset" in result) ||
      typeof result.reset !== "number" ||
      !Number.isSafeInteger(result.reset) ||
      result.reset <= 0
    ) {
      return unavailable();
    }
    return {
      allowed: result.success,
      providerAvailable: true,
      limit: result.limit,
      remaining: result.remaining,
      reset: result.reset,
    };
  };
}
