import type { AuthContext } from "@/lib/market-api/core/auth";

const DEFAULT_LIMIT_PER_SECOND = 50;
const INTERNAL_LIMIT_PER_SECOND = 1000;

type RateLimitBucket = {
  windowStart: number;
  count: number;
};

const buckets = new Map<string, RateLimitBucket>();

function buildRateLimitResponse(limit: number) {
  const response = new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
    status: 429,
    headers: {
      "content-type": "application/json",
      "x-market-api": "next",
      "retry-after": "1",
      "x-rate-limit-limit": String(limit)
    }
  });
  return response;
}

function getRateLimitKey(auth: AuthContext) {
  return `api-key:${auth.rateLimitKey}`;
}

function getRateLimitLimit(auth: AuthContext) {
  return auth.isServiceKey ? INTERNAL_LIMIT_PER_SECOND : DEFAULT_LIMIT_PER_SECOND;
}

export function enforceRateLimit(auth: AuthContext): Response | null {
  const limit = getRateLimitLimit(auth);
  const key = getRateLimitKey(auth);
  const now = Date.now();
  const windowMs = 1000;

  const current = buckets.get(key);
  if (!current || now - current.windowStart >= windowMs) {
    buckets.set(key, { windowStart: now, count: 1 });
    return null;
  }

  if (current.count >= limit) {
    return buildRateLimitResponse(limit);
  }

  current.count += 1;
  return null;
}
