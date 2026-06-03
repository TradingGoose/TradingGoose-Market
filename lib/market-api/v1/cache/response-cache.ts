import { createHash } from "crypto";
import { getRedis } from "@/lib/market-api/core/redis";
import { resolveSearchParams } from "../search/params";

const CACHE_NAMESPACE = "market-api:v1:response-cache";
const SEARCH_CACHE_KIND = "search";
const GET_CACHE_KIND = "get";
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_BODY_BYTES = 512 * 1024;

type RedisClient = ReturnType<typeof getRedis>;
type CacheKind = typeof SEARCH_CACHE_KIND | typeof GET_CACHE_KIND;
type CacheStatus = "HIT" | "MISS" | "BYPASS";

type SerializedResponse = {
  body: string;
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
};

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(Math.floor(parsed), 1);
}

function getCacheTtlSeconds(envKey: string, fallbackMs = DEFAULT_TTL_MS) {
  const ttlMs = parsePositiveInt(process.env[envKey], fallbackMs);
  return Math.max(1, Math.ceil(ttlMs / 1000));
}

function getMaxBodyBytes(envKey: string) {
  return parsePositiveInt(process.env[envKey], DEFAULT_MAX_BODY_BYTES);
}

function canonicalizeParams(params: URLSearchParams) {
  const entries = Array.from(params.entries());
  entries.sort((a, b) => {
    const keyDiff = a[0].localeCompare(b[0]);
    if (keyDiff !== 0) return keyDiff;
    return a[1].localeCompare(b[1]);
  });
  return entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function buildCacheKey(scope: string, params: URLSearchParams) {
  const query = canonicalizeParams(params);
  return `${scope}?${query}`;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function buildResponseCacheKey(kind: CacheKind, cacheKey: string) {
  return `${CACHE_NAMESPACE}:${kind}:response:${hash(cacheKey)}`;
}

function serializeHeaders(headers: Headers) {
  const serialized: Array<[string, string]> = [];
  headers.forEach((value, key) => {
    serialized.push([key, value]);
  });
  return serialized;
}

async function toSerializedResponse(response: Response): Promise<SerializedResponse> {
  return {
    body: await response.clone().text(),
    status: response.status,
    statusText: response.statusText,
    headers: serializeHeaders(response.headers)
  };
}

function toResponse(payload: SerializedResponse, cacheStatus: CacheStatus) {
  const headers = new Headers(payload.headers);
  headers.set("x-market-cache", cacheStatus);
  return new Response(payload.body, {
    status: payload.status,
    statusText: payload.statusText,
    headers
  });
}

function shouldCacheSerializedResponse(payload: SerializedResponse, maxBodyBytes: number) {
  if (payload.status !== 200) return false;
  const contentTypeHeader = payload.headers.find(([key]) => key.toLowerCase() === "content-type")?.[1] ?? "";
  if (!contentTypeHeader.toLowerCase().includes("application/json")) return false;
  if (Buffer.byteLength(payload.body, "utf8") > maxBodyBytes) return false;
  return true;
}

function buildCacheSafeRequest(request: Request, params: URLSearchParams) {
  const originalUrl = new URL(request.url);
  const query = canonicalizeParams(params);
  const url = query
    ? `${originalUrl.origin}${originalUrl.pathname}?${query}`
    : `${originalUrl.origin}${originalUrl.pathname}`;

  return new Request(url, {
    method: "GET",
    headers: new Headers(request.headers)
  });
}

async function readCachedResponse(redis: RedisClient, cacheKey: string) {
  const cached = await redis.get(cacheKey);
  return cached ? (JSON.parse(cached) as SerializedResponse) : null;
}

type ResponseCacheConfig = {
  scope: string;
  kind: CacheKind;
  ttlEnvKey: string;
  maxBodyBytesEnvKey: string;
};

async function withResponseCache(
  request: Request,
  config: ResponseCacheConfig,
  resolver: (cacheRequest: Request) => Promise<Response>
) {
  if (request.method.toUpperCase() !== "GET") return resolver(request);

  const params = await resolveSearchParams(request);
  const rawCacheKey = buildCacheKey(config.scope, params);
  const cacheKey = buildResponseCacheKey(config.kind, rawCacheKey);
  const cacheSafeRequest = buildCacheSafeRequest(request, params);
  let redis: RedisClient | null = null;

  try {
    redis = getRedis();
    const cached = await readCachedResponse(redis, cacheKey);
    if (cached) return toResponse(cached, "HIT");
  } catch (error) {
    redis = null;
    console.error("[response-cache] Redis read failed:", error instanceof Error ? error.message : error);
  }

  const serialized = await toSerializedResponse(await resolver(cacheSafeRequest));
  if (!shouldCacheSerializedResponse(serialized, getMaxBodyBytes(config.maxBodyBytesEnvKey))) {
    return toResponse(serialized, "BYPASS");
  }

  if (redis) {
    try {
      await redis.set(cacheKey, JSON.stringify(serialized), "EX", getCacheTtlSeconds(config.ttlEnvKey));
      return toResponse(serialized, "MISS");
    } catch (error) {
      console.error("[response-cache] Redis write failed:", error instanceof Error ? error.message : error);
    }
  }

  return toResponse(serialized, "BYPASS");
}

export async function withSearchResponseCache(
  request: Request,
  scope: string,
  resolver: (cacheRequest: Request) => Promise<Response>
) {
  return withResponseCache(
    request,
    {
      scope,
      kind: SEARCH_CACHE_KIND,
      ttlEnvKey: "MARKET_SEARCH_CACHE_TTL_MS",
      maxBodyBytesEnvKey: "MARKET_SEARCH_CACHE_MAX_BODY_BYTES"
    },
    resolver
  );
}

export async function withGetResponseCache(
  request: Request,
  scope: string,
  resolver: (cacheRequest: Request) => Promise<Response>
) {
  return withResponseCache(
    request,
    {
      scope,
      kind: GET_CACHE_KIND,
      ttlEnvKey: "MARKET_GET_CACHE_TTL_MS",
      maxBodyBytesEnvKey: "MARKET_GET_CACHE_MAX_BODY_BYTES"
    },
    resolver
  );
}
