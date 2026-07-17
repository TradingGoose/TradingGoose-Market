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
const DENY_CACHE_TTL_MS = parseTtlSeconds(env.MARKET_USAGE_VALIDATE_DENY_TTL_SECONDS, 10) * 1000;
const VALIDATE_TIMEOUT_MS = parseTtlSeconds(env.MARKET_USAGE_VALIDATE_TIMEOUT_MS, 5) * 1000;
const POST_TIMEOUT_MS = parseTtlSeconds(env.MARKET_USAGE_POST_TIMEOUT_MS, 5) * 1000;

function buildCacheKey(userId: string, officialTgUrl: string): string {
  return `${officialTgUrl.replace(/\/+$/, "")}|${userId}`;
}

function createTimeoutSignal(timeoutMs: number): AbortSignal | undefined {
  if (typeof AbortSignal === "undefined" || typeof AbortSignal.timeout !== "function") {
    return undefined;
  }
  return AbortSignal.timeout(timeoutMs);
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
      signal: createTimeoutSignal(VALIDATE_TIMEOUT_MS),
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
      signal: createTimeoutSignal(POST_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { success: false, status: res.status, error: `Usage post failed ${res.status}` };
    }
    return { success: true, status: res.status };
  } catch (error: any) {
    return { success: false, error: error?.message || "Usage post failed" };
  }
}
