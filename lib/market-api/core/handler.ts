import { createApiContext, type ApiContext } from "@/lib/market-api/core/context";
import { requireApiKey } from "@/lib/market-api/core/auth";
import { billingConfig, validateUsageLimitCached, postMarketUsageDurable } from "@/lib/market-api/core/billing";
import { enforceRateLimit } from "@/lib/market-api/core/rate-limit";
import { NextResponse } from "next/server";

export async function handleMarketRequest(
  request: Request,
  handler: (context: ApiContext) => Promise<Response>
) {
  const authResult = await requireApiKey(request);
  if (authResult instanceof Response) return authResult;

  const rateLimitResponse = enforceRateLimit(authResult.auth);
  if (rateLimitResponse) return rateLimitResponse;

  // Billing: validate usage limit for authenticated users
  const effectiveUserId = authResult.auth.userId ?? null;
  const billingEnabled =
    !!effectiveUserId &&
    !!billingConfig.internalApiSecret &&
    !!billingConfig.officialTgUrl;

  if (billingEnabled) {
    const usageCheck = await validateUsageLimitCached({
      userId: effectiveUserId,
      officialTgUrl: billingConfig.officialTgUrl,
      internalApiSecret: billingConfig.internalApiSecret,
    });
    if (!usageCheck.allowed) {
      const res = NextResponse.json(
        { error: "Usage limit exceeded or validation failed" },
        { status: usageCheck.status ?? 402 }
      );
      res.headers.set("x-market-api", "next");
      return res;
    }
  }

  const context = createApiContext(request);
  const response = await handler(context);

  // Post usage after successful response (fire-and-forget, outbox-backed)
  if (billingEnabled && response.ok) {
    const path = new URL(request.url).pathname;
    void postMarketUsageDurable({
      userId: effectiveUserId,
      endpoint: path,
      method: request.method,
    });
  }

  return response;
}
