import { handleMarketRequest } from "@/lib/market-api/core/handler";
import { requireApiVersion } from "@/lib/market-api/core/version";
import { postUpdateCryptoRank } from "@/lib/market-api/v1/update/crypto-rank/route";
import { postDecayCryptoRank } from "@/lib/market-api/v1/update/crypto-rank/decay/route";
import { postUpdateCurrencyRank } from "@/lib/market-api/v1/update/currency-rank/route";
import { postDecayCurrencyRank } from "@/lib/market-api/v1/update/currency-rank/decay/route";
import { postUpdateListingRank } from "@/lib/market-api/v1/update/listing-rank/route";
import { postDecayListingRank } from "@/lib/market-api/v1/update/listing-rank/decay/route";

export const runtime = "nodejs";

type Handler = Parameters<typeof handleMarketRequest>[1];

const POST_ROUTES: Record<string, Handler> = {
  "crypto-rank": postUpdateCryptoRank,
  "crypto-rank/decay": postDecayCryptoRank,
  "currency-rank": postUpdateCurrencyRank,
  "currency-rank/decay": postDecayCurrencyRank,
  "listing-rank": postUpdateListingRank,
  "listing-rank/decay": postDecayListingRank
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  const { path = [] } = await params;
  const key = path.join("/");
  const handler = POST_ROUTES[key];
  return handleMarketRequest(request, async (c) => {
    const versionError = await requireApiVersion(request);
    if (versionError) return versionError;

    if (!handler) {
      return new Response(JSON.stringify({ error: "Not Found", path: `/update/${key}` }), {
        status: 404,
        headers: { "content-type": "application/json", "x-market-api": "next" }
      });
    }

    return handler(c);
  });
}

export async function GET(request: Request) {
  return handleMarketRequest(request, async () => {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { "content-type": "application/json", "x-market-api": "next" }
    });
  });
}
