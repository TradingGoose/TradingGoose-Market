import { withApiContextRequest } from "@/lib/market-api/core/context";
import { handleMarketRequest } from "@/lib/market-api/core/handler";
import { requireApiVersion } from "@/lib/market-api/core/version";
import { withGetResponseCache } from "@/lib/market-api/v1/cache/response-cache";
import { getCrypto } from "@/lib/market-api/v1/get/crypto/route";
import { getCurrency } from "@/lib/market-api/v1/get/currency/route";
import { getListing } from "@/lib/market-api/v1/get/listing/route";
import { getMarketHours } from "@/lib/market-api/v1/get/market-hours/route";
import { getTimeZones } from "@/lib/market-api/v1/get/timezone/route";

export const runtime = "nodejs";

type Handler = Parameters<typeof handleMarketRequest>[1];

const GET_ROUTES: Record<string, Handler> = {
  crypto: getCrypto,
  currency: getCurrency,
  listing: getListing,
  "market-hours": getMarketHours,
  timezone: getTimeZones
};

async function handleGetRequest(
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
      return new Response(JSON.stringify({ error: "Not Found", path: `/get/${path.join("/")}` }), {
        status: 404,
        headers: { "content-type": "application/json", "x-market-api": "next" }
      });
    }

    return withGetResponseCache(request, `get/${routeKey}`, async (cacheRequest) =>
      handler(withApiContextRequest(c, cacheRequest))
    );
  });
}

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
