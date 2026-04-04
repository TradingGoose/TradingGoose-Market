import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db, schema } from "@tradinggoose/db";

const KEY_PREFIX = "tgm";
const PUBLIC_ID_BYTES = 8;
const SECRET_BYTES = 24;
const DEFAULT_MAX_KEYS_PER_USER = 10;

export type AuthContext = {
  userId?: string;
  keyId?: string;
  isServiceKey: boolean;
  isFreeTier: boolean;
  clientIp?: string;
  rateLimitKey: string;
};

function jsonError(message: string, status: number) {
  const response = NextResponse.json({ error: message }, { status });
  response.headers.set("x-market-api", "next");
  return response;
}

function normalizeKey(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase().startsWith("bearer ")) {
    const token = trimmed.slice(7).trim();
    return token ? token : null;
  }
  return trimmed;
}

// --- HMAC key hashing (uses INTERNAL_API_SECRET as pepper) ---

function getPepper(): string {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) throw new Error("INTERNAL_API_SECRET is required");
  return secret;
}

function hmacHash(secret: string): string {
  return crypto.createHmac("sha256", getPepper()).update(secret).digest("hex");
}

function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// --- Key format: tgm.<publicId>.<secret> ---

export function parseKey(raw: string): { publicId: string; secret: string } | null {
  if (!raw.startsWith(`${KEY_PREFIX}.`)) return null;
  const rest = raw.slice(KEY_PREFIX.length + 1);
  const separatorIndex = rest.indexOf(".");
  if (separatorIndex <= 0 || separatorIndex >= rest.length - 1) return null;
  const publicId = rest.slice(0, separatorIndex);
  const secret = rest.slice(separatorIndex + 1);
  return { publicId, secret };
}

function formatKey(publicId: string, secret: string): string {
  return `${KEY_PREFIX}.${publicId}.${secret}`;
}

// --- Key CRUD ---

export async function createApiKey(
  userId: string,
  options?: { name?: string; expiresAt?: string; maxKeys?: number }
): Promise<{ id: string; publicId: string; apiKey: string }> {
  if (!db) throw new Error("Database not configured");
  if (!userId) throw new Error("userId is required");

  const maxKeys = options?.maxKeys ?? DEFAULT_MAX_KEYS_PER_USER;
  const activeCount = await db
    .select({ id: schema.marketKeys.id })
    .from(schema.marketKeys)
    .where(and(eq(schema.marketKeys.userId, userId), eq(schema.marketKeys.status, "active")));
  if (activeCount.length >= maxKeys) {
    throw new Error(`User has reached the maximum of ${maxKeys} active keys`);
  }

  const id = crypto.randomUUID();
  const publicId = crypto.randomBytes(PUBLIC_ID_BYTES).toString("base64url");
  const secret = crypto.randomBytes(SECRET_BYTES).toString("base64url");
  const secretHash = hmacHash(secret);
  const suffix = secret.slice(-6);
  const createdAt = new Date().toISOString();

  await db.insert(schema.marketKeys).values({
    id,
    publicId,
    userId,
    secretHash,
    suffix,
    name: options?.name ?? null,
    status: "active",
    createdAt,
    expiresAt: options?.expiresAt ?? null,
  });

  return { id, publicId, apiKey: formatKey(publicId, secret) };
}

export type KeyInfo = {
  id: string;
  publicId: string;
  suffix: string;
  name: string | null;
  status: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

export async function listApiKeys(userId: string): Promise<KeyInfo[]> {
  if (!db || !userId) return [];
  const { desc } = await import("drizzle-orm");
  const rows = await db
    .select({
      id: schema.marketKeys.id,
      publicId: schema.marketKeys.publicId,
      suffix: schema.marketKeys.suffix,
      name: schema.marketKeys.name,
      status: schema.marketKeys.status,
      createdAt: schema.marketKeys.createdAt,
      lastUsedAt: schema.marketKeys.lastUsedAt,
      expiresAt: schema.marketKeys.expiresAt,
      revokedAt: schema.marketKeys.revokedAt,
    })
    .from(schema.marketKeys)
    .where(eq(schema.marketKeys.userId, userId))
    .orderBy(desc(schema.marketKeys.createdAt));

  return rows.map((r) => ({
    id: r.id,
    publicId: r.publicId,
    suffix: r.suffix || "",
    name: r.name,
    status: r.status,
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
    expiresAt: r.expiresAt,
    revokedAt: r.revokedAt,
  }));
}

export async function revokeApiKey(id: string, userId: string): Promise<boolean> {
  if (!db || !id || !userId) return false;
  const now = new Date().toISOString();
  const res = await db
    .update(schema.marketKeys)
    .set({ status: "revoked", revokedAt: now })
    .where(and(eq(schema.marketKeys.id, id), eq(schema.marketKeys.userId, userId), eq(schema.marketKeys.status, "active")))
    .returning({ id: schema.marketKeys.id });
  return Array.isArray(res) && res.length > 0;
}

export async function deleteApiKey(id: string, userId: string): Promise<boolean> {
  if (!db || !id || !userId) return false;
  const res = await db
    .delete(schema.marketKeys)
    .where(and(eq(schema.marketKeys.id, id), eq(schema.marketKeys.userId, userId)))
    .returning({ id: schema.marketKeys.id });
  return Array.isArray(res) && res.length > 0;
}

// --- Validated key cache (avoids DB lookup on every request) ---

type CachedKeyResult = { userId: string; keyId: string; expiresAt: number };
const keyCache = new Map<string, CachedKeyResult>();
const KEY_CACHE_TTL = 30_000; // 30 seconds
const KEY_CACHE_MAX_SIZE = 10_000;

// Debounce lastUsedAt writes: track last flush per key, flush at most every 60s
const lastUsedFlush = new Map<string, number>();
const LAST_USED_FLUSH_INTERVAL = 60_000; // 60 seconds

function maybeFlushLastUsed(keyId: string) {
  const now = Date.now();
  const lastFlush = lastUsedFlush.get(keyId) ?? 0;
  if (now - lastFlush < LAST_USED_FLUSH_INTERVAL) return;
  lastUsedFlush.set(keyId, now);
  void db!
    .update(schema.marketKeys)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(eq(schema.marketKeys.id, keyId));
}

// Periodic cleanup of stale cache entries (every 60s)
let keyCacheCleanupScheduled = false;
function scheduleKeyCacheCleanup() {
  if (keyCacheCleanupScheduled) return;
  keyCacheCleanupScheduled = true;
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of keyCache) {
      if (v.expiresAt <= now) keyCache.delete(k);
    }
    for (const [k, v] of lastUsedFlush) {
      if (now - v > LAST_USED_FLUSH_INTERVAL * 2) lastUsedFlush.delete(k);
    }
  }, 60_000).unref();
}

// --- O(1) key lookup with caching ---

async function lookupApiKey(rawKey: string): Promise<{ userId: string; keyId: string } | null> {
  if (!db) return null;

  const parsed = parseKey(rawKey);
  if (!parsed) return null;

  // Cache key includes secret hash so different secrets don't match
  const candidateHash = hmacHash(parsed.secret);
  const cacheKey = `${parsed.publicId}:${candidateHash}`;
  const cached = keyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    maybeFlushLastUsed(cached.keyId);
    return { userId: cached.userId, keyId: cached.keyId };
  }

  const rows = await db
    .select({
      id: schema.marketKeys.id,
      userId: schema.marketKeys.userId,
      secretHash: schema.marketKeys.secretHash,
      status: schema.marketKeys.status,
      expiresAt: schema.marketKeys.expiresAt,
    })
    .from(schema.marketKeys)
    .where(eq(schema.marketKeys.publicId, parsed.publicId))
    .limit(1);

  const row = rows[0] ?? null;
  if (!row) return null;

  if (row.status === "revoked") return null;
  if (row.expiresAt && new Date(row.expiresAt) <= new Date()) return null;

  if (!timingSafeCompare(candidateHash, row.secretHash)) return null;

  // Cache the validated key
  if (keyCache.size >= KEY_CACHE_MAX_SIZE) {
    // Evict oldest entry
    const firstKey = keyCache.keys().next().value;
    if (firstKey !== undefined) keyCache.delete(firstKey);
  }
  keyCache.set(cacheKey, {
    userId: row.userId,
    keyId: row.id,
    expiresAt: Date.now() + KEY_CACHE_TTL
  });
  scheduleKeyCacheCleanup();

  maybeFlushLastUsed(row.id);

  return { userId: row.userId, keyId: row.id };
}

// --- Request auth ---

import { extractClientIp } from "@/lib/market-api/core/free-tier";

const FREE_TIER_ENABLED = process.env.MARKET_FREE_TIER_ENABLED !== "false";

export async function requireApiKey(
  request: Request
): Promise<{ auth: AuthContext } | Response> {
  const apiKey = normalizeKey(request.headers.get("x-api-key"));

  // No API key: return free tier auth (if enabled) instead of 401
  if (!apiKey) {
    if (FREE_TIER_ENABLED) {
      const clientIp = extractClientIp(request);
      return {
        auth: {
          isServiceKey: false,
          isFreeTier: true,
          clientIp,
          rateLimitKey: `free:${clientIp}`,
        },
      };
    }
    return jsonError("Unauthorized", 401);
  }

  const internalSecret = process.env.INTERNAL_API_SECRET ?? null;
  if (internalSecret && apiKey === internalSecret) {
    return {
      auth: {
        isServiceKey: true,
        isFreeTier: false,
        rateLimitKey: "service"
      }
    };
  }

  if (!db) {
    return jsonError("Database connection is not configured.", 503);
  }

  const localKey = await lookupApiKey(apiKey);
  if (!localKey) {
    return jsonError("Unauthorized", 401);
  }

  return {
    auth: {
      isServiceKey: false,
      isFreeTier: false,
      userId: localKey.userId,
      keyId: localKey.keyId,
      rateLimitKey: localKey.userId || localKey.keyId || apiKey
    }
  };
}
