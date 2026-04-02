import { createMarketRouteHandler } from "@/lib/market-api/core/route-handler";
import { adaptCoreRouteHandler } from "@/lib/market-api/plugins/runtime";
import type { PluginRouteHandler } from "@/lib/market-api/plugins/types";
import { withSearchResponseCache } from "@/lib/market-api/v1/cache/response-cache";
import { getSearchCities } from "@/lib/market-api/v1/search/cities/route";
import { getSearchCountries } from "@/lib/market-api/v1/search/countries/route";
import { getSearchCurrencies } from "@/lib/market-api/v1/search/currencies/route";
import { getSearchCrypto } from "@/lib/market-api/v1/search/cryptos/route";
import { getSearchListings } from "@/lib/market-api/v1/search/listings/route";
import { getSearchExchanges } from "@/lib/market-api/v1/search/exchanges/route";

export const runtime = "nodejs";

const CORE_SEARCH_ROUTES: Record<string, PluginRouteHandler> = {
  cities: adaptCoreRouteHandler(getSearchCities),
  countries: adaptCoreRouteHandler(getSearchCountries),
  currencies: adaptCoreRouteHandler(getSearchCurrencies),
  cryptos: adaptCoreRouteHandler(getSearchCrypto),
  listings: adaptCoreRouteHandler(getSearchListings),
  exchanges: adaptCoreRouteHandler(getSearchExchanges)
};

const handleSearchRequest = createMarketRouteHandler({
  coreRoutes: CORE_SEARCH_ROUTES,
  namespace: "search",
  cache: withSearchResponseCache,
});

export async function GET(
  request: Request,
  context: { params: Promise<{ path?: string[] }> }
) {
  return handleSearchRequest(request, context);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ path?: string[] }> }
) {
  return handleSearchRequest(request, context);
}
