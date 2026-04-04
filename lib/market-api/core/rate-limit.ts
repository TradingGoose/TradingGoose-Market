import type { AuthContext } from "@/lib/market-api/core/auth";

function parseEnvInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const DEFAULT_LIMIT_PER_SECOND = parseEnvInt(process.env.MARKET_RATE_LIMIT_PER_SECOND, 50);
const INTERNAL_LIMIT_PER_SECOND = parseEnvInt(process.env.MARKET_INTERNAL_RATE_LIMIT_PER_SECOND, 1000);

type RateLimitBucket = {
  windowStart: number;
  count: number;
};

const buckets = new Map<string, RateLimitBucket>();
const BUCKET_MAX_SIZE = 50_000;
const BUCKET_CLEANUP_INTERVAL = 30_000; // 30 seconds

// Periodic cleanup of stale buckets to prevent memory leak
let cleanupScheduled = false;
function scheduleCleanup() {
  if (cleanupScheduled) return;
  cleanupScheduled = true;
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now - bucket.windowStart > 10_000) {
        buckets.delete(key);
      }
    }
  }, BUCKET_CLEANUP_INTERVAL).unref();
}

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
  scheduleCleanup();

  const limit = getRateLimitLimit(auth);
  const key = getRateLimitKey(auth);
  const now = Date.now();
  const windowMs = 1000;

  const current = buckets.get(key);
  if (!current || now - current.windowStart >= windowMs) {
    // Safety cap: if buckets grow too large, evict oldest entries
    if (buckets.size >= BUCKET_MAX_SIZE) {
      const firstKey = buckets.keys().next().value;
      if (firstKey !== undefined) buckets.delete(firstKey);
    }
    buckets.set(key, { windowStart: now, count: 1 });
    return null;
  }

  if (current.count >= limit) {
    return buildRateLimitResponse(limit);
  }

  current.count += 1;
  return null;
}
