import crypto from "crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db, schema } from "@tradinggoose/db";

// --- Config ---

const env = (typeof process === "undefined" ? {} : process.env) as NodeJS.ProcessEnv;

export const billingConfig = {
  internalApiSecret: env.INTERNAL_API_SECRET || "",
  officialTgUrl: env.OFFICIAL_TG_URL || "",
};

export type UsageValidationResult = { allowed: boolean; status?: number; error?: string };

// --- Validation cache ---

type CacheEntry = UsageValidationResult & { expiresAt: number };
const usageValidationCache = new Map<string, CacheEntry>();
const inflightValidation = new Map<string, Promise<UsageValidationResult>>();

function parseTtlSeconds(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

const ALLOW_CACHE_TTL_MS = parseTtlSeconds(env.MARKET_USAGE_VALIDATE_TTL_SECONDS, 60) * 1000;
const DENY_CACHE_TTL_MS = parseTtlSeconds(env.MARKET_USAGE_VALIDATE_DENY_TTL_SECONDS, 0) * 1000;

function buildCacheKey(userId: string, officialTgUrl: string): string {
  return `${officialTgUrl.replace(/\/+$/, "")}|${userId}`;
}

// --- Validate usage limit (calls Studio) ---

export async function validateUsageLimit(params: {
  userId: string;
  officialTgUrl: string;
  internalApiSecret: string;
}): Promise<UsageValidationResult> {
  const { userId, officialTgUrl, internalApiSecret } = params;
  try {
    const base = officialTgUrl.replace(/\/+$/, "");
    const url = `${base}/api/market/api-keys/validate`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": internalApiSecret },
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) {
      return { allowed: false, status: res.status, error: `Validate failed ${res.status}` };
    }
    return { allowed: true, status: res.status };
  } catch (error: any) {
    return { allowed: false, error: error?.message || "Validate failed" };
  }
}

export async function validateUsageLimitCached(params: {
  userId: string;
  officialTgUrl: string;
  internalApiSecret: string;
}): Promise<UsageValidationResult> {
  const key = buildCacheKey(params.userId, params.officialTgUrl);

  const cached = usageValidationCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { allowed: cached.allowed, status: cached.status, error: cached.error };
  }
  if (cached) usageValidationCache.delete(key);

  const inflight = inflightValidation.get(key);
  if (inflight) return await inflight;

  const promise = (async () => {
    const result = await validateUsageLimit(params);
    const ttlMs = result.allowed
      ? ALLOW_CACHE_TTL_MS
      : result.status === 402
        ? DENY_CACHE_TTL_MS
        : 0;
    if (ttlMs > 0) {
      usageValidationCache.set(key, { ...result, expiresAt: Date.now() + ttlMs });
    } else {
      usageValidationCache.delete(key);
    }
    return result;
  })().finally(() => {
    inflightValidation.delete(key);
  });

  inflightValidation.set(key, promise);
  return await promise;
}

// --- Post usage to Studio ---

export async function postMarketUsage(params: {
  userId: string;
  endpoint: string;
  method: string;
}): Promise<{ success: boolean; status?: number; error?: string }> {
  const { userId, endpoint, method } = params;
  const { officialTgUrl, internalApiSecret } = billingConfig;
  if (!officialTgUrl || !internalApiSecret) {
    return { success: false, error: "Billing config missing" };
  }

  try {
    const base = officialTgUrl.replace(/\/+$/, "");
    const url = `${base}/api/market/usage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": internalApiSecret },
      body: JSON.stringify({ userId, endpoint, method }),
    });
    if (!res.ok) {
      return { success: false, status: res.status, error: `Usage post failed ${res.status}` };
    }
    return { success: true, status: res.status };
  } catch (error: any) {
    return { success: false, error: error?.message || "Usage post failed" };
  }
}

// --- Billing outbox ---

const MAX_ATTEMPTS = 5;
const BASE_RETRY_MS = 5_000;
const FLUSH_BATCH_SIZE = 50;

function nextRetryDelay(attempts: number): number {
  return BASE_RETRY_MS * Math.pow(2, Math.min(attempts, 4));
}

export async function enqueueBillingEvent(params: {
  eventType: string;
  userId: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  if (!db) return;
  const now = new Date().toISOString();
  await db.insert(schema.marketBillingOutbox).values({
    id: crypto.randomUUID(),
    eventType: params.eventType,
    userId: params.userId,
    payload: params.payload,
    attempts: 0,
    nextRetryAt: now,
    createdAt: now,
  });
}

export async function flushBillingOutbox(): Promise<{ delivered: number; retried: number; dropped: number }> {
  if (!db) return { delivered: 0, retried: 0, dropped: 0 };

  const now = new Date();
  const rows = await db
    .select({
      id: schema.marketBillingOutbox.id,
      eventType: schema.marketBillingOutbox.eventType,
      payload: schema.marketBillingOutbox.payload,
      userId: schema.marketBillingOutbox.userId,
      attempts: schema.marketBillingOutbox.attempts,
    })
    .from(schema.marketBillingOutbox)
    .where(
      and(
        isNull(schema.marketBillingOutbox.deliveredAt),
        or(
          isNull(schema.marketBillingOutbox.nextRetryAt),
          lt(schema.marketBillingOutbox.nextRetryAt, now.toISOString()),
        ),
      ),
    )
    .limit(FLUSH_BATCH_SIZE);

  let delivered = 0;
  let retried = 0;
  let dropped = 0;

  for (const row of rows) {
    const p = row.payload as Record<string, any>;
    const result = await postMarketUsage({
      userId: row.userId,
      endpoint: p.endpoint ?? "",
      method: p.method ?? "",
    });

    if (result.success) {
      await db
        .update(schema.marketBillingOutbox)
        .set({ deliveredAt: now.toISOString(), lastAttemptAt: now.toISOString() })
        .where(eq(schema.marketBillingOutbox.id, row.id));
      delivered++;
    } else {
      const newAttempts = row.attempts + 1;
      if (newAttempts >= MAX_ATTEMPTS) {
        await db
          .update(schema.marketBillingOutbox)
          .set({ attempts: newAttempts, lastAttemptAt: now.toISOString(), nextRetryAt: null })
          .where(eq(schema.marketBillingOutbox.id, row.id));
        dropped++;
      } else {
        const retryAt = new Date(Date.now() + nextRetryDelay(newAttempts)).toISOString();
        await db
          .update(schema.marketBillingOutbox)
          .set({ attempts: newAttempts, lastAttemptAt: now.toISOString(), nextRetryAt: retryAt })
          .where(eq(schema.marketBillingOutbox.id, row.id));
        retried++;
      }
    }
  }

  return { delivered, retried, dropped };
}

// --- Durable usage post (try immediate, fall back to outbox) ---

export async function postMarketUsageDurable(params: {
  userId: string;
  endpoint: string;
  method: string;
}): Promise<{ success: boolean; status?: number; error?: string }> {
  const result = await postMarketUsage(params);
  if (result.success) return result;

  await enqueueBillingEvent({
    eventType: "market_usage",
    userId: params.userId,
    payload: { endpoint: params.endpoint, method: params.method },
  });
  return result;
}
