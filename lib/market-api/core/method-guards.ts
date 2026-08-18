import {
  getMarketRouteDescriptorByTemplate,
  type MarketApiMethod,
  type MarketRouteDescriptor,
} from "@/lib/market-api/core/manifest";

function allowValue(descriptor: MarketRouteDescriptor) {
  return descriptor.methods.join(", ");
}

export const NEXT_ROUTE_HANDLER_METHODS = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
] as const satisfies readonly MarketApiMethod[];

export function marketMethodNotAllowed(
  descriptor: MarketRouteDescriptor,
  method?: string,
): Response {
  const headers = {
    Allow: allowValue(descriptor),
    "x-market-api": "next",
  };
  if (method?.toUpperCase() === "HEAD") {
    return new Response(null, { status: 405, headers });
  }
  return Response.json(
    {
      error: "Method Not Allowed",
      ...(method ? { method: method.toUpperCase() } : {}),
    },
    {
      status: 405,
      headers,
    },
  );
}

export function createManifestMethodPolicy(template: string) {
  const descriptor = getMarketRouteDescriptorByTemplate(template);
  const reject = (method: MarketApiMethod) => () =>
    marketMethodNotAllowed(descriptor, method);
  return Object.freeze({
    descriptor,
    reject,
    GET: reject("GET"),
    HEAD: reject("HEAD"),
    POST: reject("POST"),
    PUT: reject("PUT"),
    PATCH: reject("PATCH"),
    DELETE: reject("DELETE"),
    OPTIONS: reject("OPTIONS"),
  });
}

export function marketRouteNotFound(method?: string): Response {
  if (method?.toUpperCase() === "HEAD") {
    return new Response(null, {
      status: 404,
      headers: { "x-market-api": "next" },
    });
  }
  return Response.json(
    { error: "Not Found" },
    { status: 404, headers: { "x-market-api": "next" } },
  );
}

export function guardMarketRouteMethod(
  descriptor: MarketRouteDescriptor,
  method: string,
): Response | null {
  const normalized = method.toUpperCase() as MarketApiMethod;
  return descriptor.methods.includes(normalized) ? null : marketMethodNotAllowed(descriptor, method);
}

export async function toExplicitHeadResponse(
  responseOrPromise: Response | Promise<Response>,
): Promise<Response> {
  const response = await responseOrPromise;
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
