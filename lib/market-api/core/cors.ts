import type { KeyedMarketRouteDescriptor } from "@/lib/market-api/core/manifest";
import { getMarketRuntimeConfig } from "@/lib/environment";

const PUBLIC_REQUEST_HEADERS = ["x-api-key", "http-referer", "x-title"] as const;
const PRIVATE_REQUEST_HEADERS = [...PUBLIC_REQUEST_HEADERS, "content-type"] as const;

function canonicalOrigin(): string {
  return getMarketRuntimeConfig().appUrl;
}

function allowedRequestHeaders(descriptor: KeyedMarketRouteDescriptor) {
  return descriptor.cors === "private-key" ? PRIVATE_REQUEST_HEADERS : PUBLIC_REQUEST_HEADERS;
}

function corsHeaders(descriptor: KeyedMarketRouteDescriptor, origin: string) {
  return new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": [...descriptor.methods, "OPTIONS"].join(", "),
    "Access-Control-Allow-Headers": allowedRequestHeaders(descriptor).join(", "),
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  });
}

function jsonError(error: string, status: number) {
  return Response.json(
    { error },
    { status, headers: { "x-market-api": "next", Vary: "Origin" } },
  );
}

export function handleMarketPreflight(
  request: Request,
  descriptor: KeyedMarketRouteDescriptor,
): Response {
  const origin = request.headers.get("origin");
  let expectedOrigin: string;
  try {
    expectedOrigin = canonicalOrigin();
  } catch {
    return jsonError("Market CORS is not configured.", 503);
  }

  if (origin !== expectedOrigin) return jsonError("Origin is not allowed.", 403);

  const requestedMethod = request.headers
    .get("access-control-request-method")
    ?.trim()
    .toUpperCase();
  if (!requestedMethod || !descriptor.methods.includes(requestedMethod as never)) {
    return jsonError("Requested method is not allowed.", 405);
  }

  const acceptedHeaders = new Set<string>(allowedRequestHeaders(descriptor));
  const requestedHeaders = request.headers.get("access-control-request-headers");
  if (requestedHeaders) {
    const parsed = requestedHeaders.split(",").map((header) => header.trim().toLowerCase());
    if (parsed.some((header) => !header || !acceptedHeaders.has(header))) {
      return jsonError("Requested headers are not allowed.", 400);
    }
  }

  return new Response(null, { status: 204, headers: corsHeaders(descriptor, expectedOrigin) });
}

export function applyMarketCors(
  request: Request,
  descriptor: KeyedMarketRouteDescriptor,
  response: Response,
): Response {
  const origin = request.headers.get("origin");
  if (!origin) return response;

  let expectedOrigin: string;
  try {
    expectedOrigin = canonicalOrigin();
  } catch {
    return response;
  }
  if (origin !== expectedOrigin) return response;

  response.headers.set("Access-Control-Allow-Origin", expectedOrigin);
  const vary = response.headers.get("Vary")
    ?.split(",")
    .map((value) => value.trim().toLowerCase());
  if (!vary?.includes("origin")) {
    response.headers.set("Vary", response.headers.get("Vary") ? `${response.headers.get("Vary")}, Origin` : "Origin");
  }
  return response;
}
