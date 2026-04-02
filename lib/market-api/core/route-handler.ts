import { withApiContextRequest } from "@/lib/market-api/core/context";
import { handleMarketRequest } from "@/lib/market-api/core/handler";
import { requireApiVersion } from "@/lib/market-api/core/version";
import { withPluginContextRequest } from "@/lib/market-api/plugins/context";
import { resolvePluginRoutes } from "@/lib/market-api/plugins/runtime";
import type { PluginRouteHandler, PluginRouteNamespace } from "@/lib/market-api/plugins/types";

export type CacheWrapper = (
  request: Request,
  key: string,
  fn: (req: Request) => Promise<Response>
) => Promise<Response>;

export interface MarketRouteOptions {
  coreRoutes: Readonly<Record<string, PluginRouteHandler>>;
  namespace: PluginRouteNamespace;
  cache?: CacheWrapper;
  /** Use the full joined path as route key (default: first segment only) */
  useFullPathKey?: boolean;
}

export function createMarketRouteHandler({
  coreRoutes,
  namespace,
  cache,
  useFullPathKey = false,
}: MarketRouteOptions) {
  return async (
    request: Request,
    { params }: { params: Promise<{ path?: string[] }> }
  ) => {
    const routes = await resolvePluginRoutes(namespace, coreRoutes);
    const { path = [] } = await params;
    const key = useFullPathKey ? path.join("/") : (path[0] ?? "");
    const routeKey = path.join("/") || key;
    const handler = routes[key];

    return handleMarketRequest(request, async (c, plugin) => {
      const versionError = await requireApiVersion(request);
      if (versionError) return versionError;

      if (!handler) {
        return new Response(
          JSON.stringify({ error: "Not Found", path: `/${namespace}/${path.join("/")}` }),
          {
            status: 404,
            headers: { "content-type": "application/json", "x-market-api": "next" },
          }
        );
      }

      if (cache) {
        return cache(request, `${namespace}/${routeKey}`, async (cacheRequest) => {
          const cacheContext = withApiContextRequest(c, cacheRequest);
          const cachePluginContext = withPluginContextRequest(plugin, cacheRequest);
          return handler(cacheContext, cachePluginContext);
        });
      }

      return handler(c, plugin);
    });
  };
}
