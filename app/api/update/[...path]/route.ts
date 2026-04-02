import { handleMarketRequest } from "@/lib/market-api/core/handler";
import { createMarketRouteHandler } from "@/lib/market-api/core/route-handler";
import { adaptCoreRouteHandler } from "@/lib/market-api/plugins/runtime";
import type { PluginRouteHandler } from "@/lib/market-api/plugins/types";
import { postUpdateCryptoRank } from "@/lib/market-api/v1/update/crypto-rank/route";
import { postDecayCryptoRank } from "@/lib/market-api/v1/update/crypto-rank/decay/route";
import { postUpdateCurrencyRank } from "@/lib/market-api/v1/update/currency-rank/route";
import { postDecayCurrencyRank } from "@/lib/market-api/v1/update/currency-rank/decay/route";
import { postUpdateListingRank } from "@/lib/market-api/v1/update/listing-rank/route";
import { postDecayListingRank } from "@/lib/market-api/v1/update/listing-rank/decay/route";

export const runtime = "nodejs";

const CORE_UPDATE_ROUTES: Record<string, PluginRouteHandler> = {
  "crypto-rank": adaptCoreRouteHandler(postUpdateCryptoRank),
  "crypto-rank/decay": adaptCoreRouteHandler(postDecayCryptoRank),
  "currency-rank": adaptCoreRouteHandler(postUpdateCurrencyRank),
  "currency-rank/decay": adaptCoreRouteHandler(postDecayCurrencyRank),
  "listing-rank": adaptCoreRouteHandler(postUpdateListingRank),
  "listing-rank/decay": adaptCoreRouteHandler(postDecayListingRank)
};

const handleUpdateRequest = createMarketRouteHandler({
  coreRoutes: CORE_UPDATE_ROUTES,
  namespace: "update",
  useFullPathKey: true,
});

export async function POST(
  request: Request,
  context: { params: Promise<{ path?: string[] }> }
) {
  return handleUpdateRequest(request, context);
}

export async function GET(request: Request) {
  return handleMarketRequest(request, async (_context, _plugin) => {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { "content-type": "application/json", "x-market-api": "next" }
    });
  });
}
