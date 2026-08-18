import {
  createMarketPreflightHandler,
  createMarketRejectedMethodHandler,
  createMarketRouteHandler,
} from "@/lib/market-api/core/route-handler";
import { withSearchResponseCache } from "@/lib/market-api/v1/cache/response-cache";

export const runtime = "nodejs";

const handleSearchRequest = createMarketRouteHandler({
  namespace: "search",
  cache: withSearchResponseCache,
});
const handleSearchPreflight = createMarketPreflightHandler("search");
const rejectSearchMethod = createMarketRejectedMethodHandler("search");

export const GET = handleSearchRequest;
export const HEAD = handleSearchRequest;
export const OPTIONS = handleSearchPreflight;
export const POST = rejectSearchMethod;
export const PUT = rejectSearchMethod;
export const PATCH = rejectSearchMethod;
export const DELETE = rejectSearchMethod;
