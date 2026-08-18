import { handleKeyedMarketRoute } from "@/lib/market-api/core/access";
import { withApiContextRequest } from "@/lib/market-api/core/context";
import { applyMarketCors, handleMarketPreflight } from "@/lib/market-api/core/cors";
import {
  resolveKeyedMarketRoute,
  type KeyedMarketRouteDescriptor,
} from "@/lib/market-api/core/manifest";
import {
  guardMarketRouteMethod,
  marketMethodNotAllowed,
  marketRouteNotFound,
  toExplicitHeadResponse,
} from "@/lib/market-api/core/method-guards";
import { requireApiVersion } from "@/lib/market-api/core/version";

export type CacheWrapper = (
  request: Request,
  key: string,
  fn: (request: Request) => Promise<Response>,
) => Promise<Response>;

export type MarketRouteNamespace = "search" | "get" | "update";

export type MarketRouteOptions = Readonly<{
  namespace: MarketRouteNamespace;
  cache?: CacheWrapper;
}>;

function pathBelongsToNamespace(
  descriptor: KeyedMarketRouteDescriptor,
  namespace: MarketRouteNamespace,
) {
  return descriptor.path === `/api/${namespace}` || descriptor.path.startsWith(`/api/${namespace}/`);
}

export function createMarketRouteHandler({ namespace, cache }: MarketRouteOptions) {
  return async (request: Request): Promise<Response> => {
    const pathname = new URL(request.url).pathname;
    const descriptor = resolveKeyedMarketRoute(pathname);
    if (!descriptor || !pathBelongsToNamespace(descriptor, namespace)) {
      return marketRouteNotFound(request.method);
    }

    const methodError = guardMarketRouteMethod(descriptor, request.method);
    if (methodError) return applyMarketCors(request, descriptor, methodError);

    const versionError = requireApiVersion(request);
    if (versionError) return applyMarketCors(request, descriptor, versionError);

    const response = await handleKeyedMarketRoute(
      request,
      descriptor,
      async (context, actor) => {
        if (!cache) return descriptor.handler(context, actor);

        return cache(context.req.raw, descriptor.id, async (cacheRequest) =>
          descriptor.handler(withApiContextRequest(context, cacheRequest), actor),
        );
      },
    );

    const methodResponse =
      request.method.toUpperCase() === "HEAD"
        ? await toExplicitHeadResponse(response)
        : response;
    return applyMarketCors(request, descriptor, methodResponse);
  };
}

export function createMarketPreflightHandler(namespace: MarketRouteNamespace) {
  return (request: Request): Response => {
    const pathname = new URL(request.url).pathname;
    const descriptor = resolveKeyedMarketRoute(pathname);
    if (!descriptor || !pathBelongsToNamespace(descriptor, namespace)) {
      return marketRouteNotFound(request.method);
    }

    const versionError = requireApiVersion(request);
    if (versionError) return applyMarketCors(request, descriptor, versionError);
    return handleMarketPreflight(request, descriptor);
  };
}

export function createMarketRejectedMethodHandler(namespace: MarketRouteNamespace) {
  return async (request: Request): Promise<Response> => {
    const descriptor = resolveKeyedMarketRoute(new URL(request.url).pathname);
    if (!descriptor || !pathBelongsToNamespace(descriptor, namespace)) {
      return marketRouteNotFound(request.method);
    }
    const response = marketMethodNotAllowed(descriptor, request.method);
    const methodResponse =
      request.method.toUpperCase() === "HEAD"
        ? await toExplicitHeadResponse(response)
        : response;
    return applyMarketCors(request, descriptor, methodResponse);
  };
}
