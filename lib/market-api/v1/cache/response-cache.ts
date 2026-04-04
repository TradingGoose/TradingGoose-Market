import { revalidateTag, unstable_cache } from "next/cache";
import { resolveSearchParams } from "../search/params";

const SEARCH_CACHE_TAG = "market-api:search";
const GET_CACHE_TAG = "market-api:get";
const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MAX_BODY_BYTES = 512 * 1024;

type SerializedSearchResponse = {
  body: string;
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
};

class UncacheableResponseError extends Error {
  response: SerializedSearchResponse;

  constructor(response: SerializedSearchResponse) {
    super("Search response should bypass cache.");
    this.response = response;
  }
}

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

function sanitizeScope(scope: string) {
  return scope.replace(/[^a-zA-Z0-9:_-]/g, ":");
}

function serializeHeaders(headers: Headers) {
  const serialized: Array<[string, string]> = [];
  headers.forEach((value, key) => {
    serialized.push([key, value]);
  });
  return serialized;
}

async function toSerializedResponse(response: Response): Promise<SerializedSearchResponse> {
  return {
    body: await response.clone().text(),
    status: response.status,
    statusText: response.statusText,
    headers: serializeHeaders(response.headers)
  };
}

function toResponse(
  payload: SerializedSearchResponse,
  cacheStatus: "HIT" | "MISS" | "BYPASS"
) {
  const headers = new Headers(payload.headers);
  headers.set("x-market-cache", cacheStatus);
  return new Response(payload.body, {
    status: payload.status,
    statusText: payload.statusText,
    headers
  });
}

function shouldCacheSerializedResponse(payload: SerializedSearchResponse, maxBodyBytes: number) {
  if (payload.status !== 200) return false;
  const contentTypeHeader = payload.headers.find(([key]) => key.toLowerCase() === "content-type")?.[1] ?? "";
  if (!contentTypeHeader.toLowerCase().includes("application/json")) return false;
  if (Buffer.byteLength(payload.body, "utf8") > maxBodyBytes) return false;
  return true;
}

export function clearSearchResponseCache() {
  revalidateTag(SEARCH_CACHE_TAG, "max");
}

export function clearGetResponseCache() {
  revalidateTag(GET_CACHE_TAG, "max");
}

type ResponseCacheConfig = {
  scope: string;
  cacheTag: string;
  ttlEnvKey: string;
  maxBodyBytesEnvKey: string;
};

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

async function withResponseCache(
  request: Request,
  config: ResponseCacheConfig,
  resolver: (cacheRequest: Request) => Promise<Response>
) {
  const params = await resolveSearchParams(request);
  const cacheKey = buildCacheKey(config.scope, params);
  const ttlSeconds = getCacheTtlSeconds(config.ttlEnvKey);
  const maxBodyBytes = getMaxBodyBytes(config.maxBodyBytesEnvKey);
  const cacheSafeRequest = buildCacheSafeRequest(request, params);
  let didCompute = false;

  const resolveCached = unstable_cache(
    async (): Promise<SerializedSearchResponse> => {
      didCompute = true;
      const serialized = await toSerializedResponse(await resolver(cacheSafeRequest));
      if (!shouldCacheSerializedResponse(serialized, maxBodyBytes)) {
        throw new UncacheableResponseError(serialized);
      }
      return serialized;
    },
    [cacheKey],
    {
      revalidate: ttlSeconds,
      tags: [config.cacheTag, `${config.cacheTag}:${sanitizeScope(config.scope)}`]
    }
  );

  try {
    const payload = await resolveCached();
    return toResponse(payload, didCompute ? "MISS" : "HIT");
  } catch (error) {
    if (error instanceof UncacheableResponseError) {
      return toResponse(error.response, "BYPASS");
    }
    throw error;
  }
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
      cacheTag: SEARCH_CACHE_TAG,
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
      cacheTag: GET_CACHE_TAG,
      ttlEnvKey: "MARKET_GET_CACHE_TTL_MS",
      maxBodyBytesEnvKey: "MARKET_GET_CACHE_MAX_BODY_BYTES"
    },
    resolver
  );
}
