import { createMarketRouteHandler } from "@/lib/market-api/core/route-handler";
import { adaptCoreRouteHandler } from "@/lib/market-api/plugins/runtime";
import type { PluginRouteHandler } from "@/lib/market-api/plugins/types";
import { withGetResponseCache } from "@/lib/market-api/v1/cache/response-cache";
import { getCrypto } from "@/lib/market-api/v1/get/crypto/route";
import { getCurrency } from "@/lib/market-api/v1/get/currency/route";
import { getListing } from "@/lib/market-api/v1/get/listing/route";
import { getMarketHours } from "@/lib/market-api/v1/get/market-hours/route";
import { getTimeZones } from "@/lib/market-api/v1/get/timezone/route";

export const runtime = "nodejs";

const CORE_GET_ROUTES: Record<string, PluginRouteHandler> = {
  crypto: adaptCoreRouteHandler(getCrypto),
  currency: adaptCoreRouteHandler(getCurrency),
  listing: adaptCoreRouteHandler(getListing),
  "market-hours": adaptCoreRouteHandler(getMarketHours),
  timezone: adaptCoreRouteHandler(getTimeZones)
};

const handleGetRequest = createMarketRouteHandler({
  coreRoutes: CORE_GET_ROUTES,
  namespace: "get",
  cache: withGetResponseCache,
});

export async function GET(
  request: Request,
  context: { params: Promise<{ path?: string[] }> }
) {
  return handleGetRequest(request, context);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ path?: string[] }> }
) {
  return handleGetRequest(request, context);
}
