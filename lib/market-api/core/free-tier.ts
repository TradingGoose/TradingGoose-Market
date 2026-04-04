import { getRedis } from "@/lib/market-api/core/redis";

// --- Configuration (env-overridable) ---

function parseEnvInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const FREE_TIER_RPM = parseEnvInt(process.env.MARKET_FREE_TIER_RPM, 25);
const FREE_TIER_RPD = parseEnvInt(process.env.MARKET_FREE_TIER_RPD, 500);
const KEY_PREFIX = "ft";

// --- In-memory fallback (used when Redis is unavailable) ---

type MemBucket = { count: number; resetAt: number };
const memMinute = new Map<string, MemBucket>();
const memDaily = new Map<string, MemBucket>();
const MEM_MAX_SIZE = 50_000;

let memCleanupScheduled = false;
function scheduleMemCleanup() {
  if (memCleanupScheduled) return;
  memCleanupScheduled = true;
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of memMinute) {
      if (v.resetAt <= now) memMinute.delete(k);
    }
    for (const [k, v] of memDaily) {
      if (v.resetAt <= now) memDaily.delete(k);
    }
  }, 60_000).unref();
}

function memIncr(map: Map<string, MemBucket>, key: string, windowMs: number): number {
  scheduleMemCleanup();
  const now = Date.now();
  const existing = map.get(key);
  if (existing && existing.resetAt > now) {
    existing.count += 1;
    return existing.count;
  }
  if (map.size >= MEM_MAX_SIZE) {
    const firstKey = map.keys().next().value;
    if (firstKey !== undefined) map.delete(firstKey);
  }
  map.set(key, { count: 1, resetAt: now + windowMs });
  return 1;
}

// --- IP extraction ---

export function extractClientIp(request: Request): string {
  const headers = request.headers;

  // Standard proxy headers (leftmost = original client)
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  // Vercel/Cloudflare-specific
  const cfIp = headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  return "unknown";
}

// --- Rate limit check ---

export type FreeTierResult =
  | { allowed: true; remaining: { minute: number; daily: number } }
  | { allowed: false; retryAfter: number; reason: "minute" | "daily" };

async function checkWithRedis(ip: string): Promise<FreeTierResult | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const now = Date.now();
    const minuteKey = `${KEY_PREFIX}:min:${ip}:${Math.floor(now / 60_000)}`;
    const dayKey = `${KEY_PREFIX}:day:${ip}:${new Date().toISOString().slice(0, 10)}`;

    // Use pipeline for atomicity and single round-trip
    const pipeline = redis.pipeline();
    pipeline.incr(minuteKey);
    pipeline.expire(minuteKey, 120); // 2 min TTL (covers window + buffer)
    pipeline.incr(dayKey);
    pipeline.expire(dayKey, 90_000); // 25 hours TTL (covers day + buffer)
    const results = await pipeline.exec();

    if (!results) return null;

    const minuteCount = (results[0]?.[1] as number) ?? 0;
    const dailyCount = (results[2]?.[1] as number) ?? 0;

    if (minuteCount > FREE_TIER_RPM) {
      const secondsIntoMinute = Math.floor((now % 60_000) / 1000);
      return { allowed: false, retryAfter: 60 - secondsIntoMinute, reason: "minute" };
    }

    if (dailyCount > FREE_TIER_RPD) {
      return { allowed: false, retryAfter: 3600, reason: "daily" };
    }

    return {
      allowed: true,
      remaining: {
        minute: Math.max(0, FREE_TIER_RPM - minuteCount),
        daily: Math.max(0, FREE_TIER_RPD - dailyCount),
      },
    };
  } catch {
    return null; // Fall through to in-memory
  }
}

function checkWithMemory(ip: string): FreeTierResult {
  const minuteCount = memIncr(memMinute, ip, 60_000);
  const dailyCount = memIncr(memDaily, ip, 86_400_000);

  if (minuteCount > FREE_TIER_RPM) {
    return { allowed: false, retryAfter: 60, reason: "minute" };
  }

  if (dailyCount > FREE_TIER_RPD) {
    return { allowed: false, retryAfter: 3600, reason: "daily" };
  }

  return {
    allowed: true,
    remaining: {
      minute: Math.max(0, FREE_TIER_RPM - minuteCount),
      daily: Math.max(0, FREE_TIER_RPD - dailyCount),
    },
  };
}

export async function enforceFreeTierLimit(ip: string): Promise<FreeTierResult> {
  const redisResult = await checkWithRedis(ip);
  if (redisResult) return redisResult;
  return checkWithMemory(ip);
}

export function buildFreeTierLimitResponse(result: Extract<FreeTierResult, { allowed: false }>) {
  const message =
    result.reason === "daily"
      ? "Free tier daily limit exceeded. Get an API key for higher limits."
      : "Free tier rate limit exceeded. Max 25 requests per minute.";

  return new Response(JSON.stringify({ error: message }), {
    status: 429,
    headers: {
      "content-type": "application/json",
      "x-market-api": "next",
      "x-market-tier": "free",
      "retry-after": String(result.retryAfter),
    },
  });
}

export { FREE_TIER_RPM, FREE_TIER_RPD };
