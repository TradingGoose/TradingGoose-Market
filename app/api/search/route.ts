import { withApiContextRequest } from "@/lib/market-api/core/context";
import { handleMarketRequest } from "@/lib/market-api/core/handler";
import { requireApiVersion } from "@/lib/market-api/core/version";
import { withSearchResponseCache } from "@/lib/market-api/v1/cache/response-cache";
import { getSearch } from "@/lib/market-api/v1/search/route";

export const runtime = "nodejs";

async function handleSearchRequest(request: Request) {
  return handleMarketRequest(request, async (c) => {
    const versionError = await requireApiVersion(request);
    if (versionError) return versionError;
    return withSearchResponseCache(request, "search/root", async (cacheRequest) =>
      getSearch(withApiContextRequest(c, cacheRequest))
    );
  });
}

export async function GET(request: Request) {
  return handleSearchRequest(request);
}

export async function POST(request: Request) {
  return handleSearchRequest(request);
}
