import { createApiContext, type ApiContext } from "@/lib/market-api/core/context";
import { requireApiKey } from "@/lib/market-api/core/auth";
import { billingConfig, validateUsageLimitCached, postMarketUsageDurable } from "@/lib/market-api/core/billing";
import { enforceRateLimit } from "@/lib/market-api/core/rate-limit";
import { enforceFreeTierLimit, buildFreeTierLimitResponse } from "@/lib/market-api/core/free-tier";
import { createPluginContext } from "@/lib/market-api/plugins/context";
import type { PluginContext } from "@/lib/market-api/plugins/types";
import { after, NextResponse } from "next/server";

function setTierHeader(response: Response, isFreeTier: boolean) {
  response.headers.set("x-market-tier", isFreeTier ? "free" : "authenticated");
  return response;
}

export async function handleMarketRequest(
  request: Request,
  handler: (context: ApiContext, plugin: PluginContext) => Promise<Response>
) {
  const authResult = await requireApiKey(request);
  if (authResult instanceof Response) return authResult;

  const { auth } = authResult;

  // Free tier: enforce IP-based rate limits (25/min, 500/day)
  if (auth.isFreeTier) {
    const ip = auth.clientIp ?? "unknown";
    const freeTierResult = await enforceFreeTierLimit(ip);
    if (!freeTierResult.allowed) {
      return buildFreeTierLimitResponse(freeTierResult);
    }

    const context = createApiContext(request);
    const pluginContext = createPluginContext(request, auth);
    const response = await handler(context, pluginContext);

    setTierHeader(response, true);
    if (freeTierResult.allowed) {
      response.headers.set("x-ratelimit-remaining-minute", String(freeTierResult.remaining.minute));
      response.headers.set("x-ratelimit-remaining-daily", String(freeTierResult.remaining.daily));
    }
    return response;
  }

  // Authenticated tier: enforce per-key rate limits
  const rateLimitResponse = enforceRateLimit(auth);
  if (rateLimitResponse) return rateLimitResponse;

  // Billing: validate usage limit for authenticated users
  const effectiveUserId = auth.userId ?? null;
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
  const pluginContext = createPluginContext(request, auth);
  const response = await handler(context, pluginContext);

  setTierHeader(response, false);

  // Post usage after successful response (fire-and-forget, outbox-backed)
  if (billingEnabled && response.ok) {
    const path = new URL(request.url).pathname;
    after(async () => {
      await postMarketUsageDurable({
        userId: effectiveUserId,
        endpoint: path,
        method: request.method,
      });
    });
  }

  return response;
}
