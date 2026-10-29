import {
  createMarketPreflightHandler,
  createMarketRejectedMethodHandler,
  createMarketRouteHandler,
} from "@/lib/market-api/core/route-handler";

export const runtime = "nodejs";

const handleUpdateRequest = createMarketRouteHandler({ namespace: "update" });
const handleUpdatePreflight = createMarketPreflightHandler("update");
const rejectUpdateMethod = createMarketRejectedMethodHandler("update");

export const POST = handleUpdateRequest;
export const OPTIONS = handleUpdatePreflight;
export const GET = rejectUpdateMethod;
export const HEAD = rejectUpdateMethod;
export const PUT = rejectUpdateMethod;
export const PATCH = rejectUpdateMethod;
export const DELETE = rejectUpdateMethod;
