import { withApiContextRequest } from "@/lib/market-api/core/context";
import { handleMarketRequest } from "@/lib/market-api/core/handler";
import { requireApiVersion } from "@/lib/market-api/core/version";
import { withSearchResponseCache } from "@/lib/market-api/v1/cache/response-cache";
import { getSearchCities } from "@/lib/market-api/v1/search/cities/route";
import { getSearchCountries } from "@/lib/market-api/v1/search/countries/route";
import { getSearchCurrencies } from "@/lib/market-api/v1/search/currencies/route";
import { getSearchCrypto } from "@/lib/market-api/v1/search/cryptos/route";
import { getSearchListings } from "@/lib/market-api/v1/search/listings/route";
import { getSearchExchanges } from "@/lib/market-api/v1/search/exchanges/route";

export const runtime = "nodejs";

type Handler = Parameters<typeof handleMarketRequest>[1];

const GET_ROUTES: Record<string, Handler> = {
  cities: getSearchCities,
  countries: getSearchCountries,
  currencies: getSearchCurrencies,
  cryptos: getSearchCrypto,
  listings: getSearchListings,
  exchanges: getSearchExchanges
};

async function handleSearchRequest(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  const { path = [] } = await params;
  const key = path[0] ?? "";
  const routeKey = path.join("/") || key;
  const handler = GET_ROUTES[key];
  return handleMarketRequest(request, async (c) => {
    const versionError = await requireApiVersion(request);
    if (versionError) return versionError;

    if (!handler) {
      return new Response(JSON.stringify({ error: "Not Found", path: `/search/${path.join("/")}` }), {
        status: 404,
        headers: { "content-type": "application/json", "x-market-api": "next" }
      });
    }

    return withSearchResponseCache(request, `search/${routeKey}`, async (cacheRequest) =>
      handler(withApiContextRequest(c, cacheRequest))
    );
  });
}

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
