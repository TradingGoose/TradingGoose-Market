import {
  createMarketPreflightHandler,
  createMarketRejectedMethodHandler,
  createMarketRouteHandler,
} from "@/lib/market-api/core/route-handler";
import { withGetResponseCache } from "@/lib/market-api/v1/cache/response-cache";

export const runtime = "nodejs";

const handleGetRequest = createMarketRouteHandler({
  namespace: "get",
  cache: withGetResponseCache,
});
const handleGetPreflight = createMarketPreflightHandler("get");
const rejectGetMethod = createMarketRejectedMethodHandler("get");

export const GET = handleGetRequest;
export const HEAD = handleGetRequest;
export const OPTIONS = handleGetPreflight;
export const POST = rejectGetMethod;
export const PUT = rejectGetMethod;
export const PATCH = rejectGetMethod;
export const DELETE = rejectGetMethod;
