import { eq } from "drizzle-orm";
import { z } from "zod";
import { userStats } from "@tradinggoose/db/schema";
import { apiRequireCustomerSession } from "@/lib/auth/session";
import { withBillingSubjectLock } from "@/lib/db/locks";
import { getMarketRuntimeConfig } from "@/lib/environment";
import { decimalUsdToNanoUsd, nanoUsdToDecimalUsd } from "@/lib/billing/money";
import { effectiveLimitNano, isPaidBinding, readPersonalBillingState } from "@/lib/billing/user-stats";
import type { UsageLimitInfo } from "@/lib/account/contracts";
import { browserRouteDescriptor, rejectBrowserHead, rejectBrowserMethod, rejectBrowserOptions } from "@/lib/market-api/core/browser-route";

const TEMPLATE = "/api/account/billing/usage-limit";
browserRouteDescriptor(TEMPLATE, "GET");
browserRouteDescriptor(TEMPLATE, "PUT");

const input = z.object({ limitUsd: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/) }).strict();

async function usageLimit(request: Request, editing: boolean) {
  const guard = await apiRequireCustomerSession(request);
  if (guard.error) return guard.error;
  const enabled = getMarketRuntimeConfig().billing.enabled;
  if (editing && !enabled) return Response.json({ error: "Billing is disabled", code: "BILLING_DISABLED" }, { status: 409 });
  let value: bigint | undefined;
  if (editing) {
    const parsed = input.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Expected a non-negative decimal limitUsd with up to 9 places." }, { status: 400 });
    value = decimalUsdToNanoUsd(parsed.data.limitUsd);
  }
  try {
    return await withBillingSubjectLock(guard.user.id, async tx => {
      const { stats, subscription, customerId } = await readPersonalBillingState(tx, guard.user.id);
      const canEdit = enabled && isPaidBinding(subscription) && customerId === subscription.stripeCustomerId;
      const info: UsageLimitInfo = {
        currentLimitUsd: enabled ? nanoUsdToDecimalUsd(effectiveLimitNano(stats)) : null,
        minimumLimitUsd: enabled ? stats.grantedOnboardingAllowanceUsd : "0",
        canEdit, updatedAt: stats.customUsageLimitUpdatedAt?.toISOString() ?? null,
      };
      if (value !== undefined) {
        if (!canEdit) return Response.json({ error: "An active PAYG subscription is required to edit the limit." }, { status: 400 });
        if (value < decimalUsdToNanoUsd(info.minimumLimitUsd)) return Response.json({ error: "Limit cannot be below the plan minimum." }, { status: 400 });
        if (value < decimalUsdToNanoUsd(stats.currentPeriodCost)) return Response.json({ error: "Limit cannot be below current usage." }, { status: 400 });
        const now = new Date();
        info.currentLimitUsd = nanoUsdToDecimalUsd(value);
        info.updatedAt = now.toISOString();
        await tx.update(userStats).set({ customUsageLimit: info.currentLimitUsd, customUsageLimitUpdatedAt: now, updatedAt: now })
          .where(eq(userStats.id, stats.id));
      }
      return Response.json({ usageLimit: info });
    });
  } catch {
    return Response.json({ error: "CUSTOMER_STATE_UNAVAILABLE" }, { status: 503 });
  }
}
export const GET = (request: Request) => usageLimit(request, false);
export const PUT = (request: Request) => usageLimit(request, true);

export const HEAD = () => rejectBrowserHead(TEMPLATE);
export const OPTIONS = () => rejectBrowserOptions(TEMPLATE);
export const POST = () => rejectBrowserMethod(TEMPLATE, "POST");
export const PATCH = () => rejectBrowserMethod(TEMPLATE, "PATCH");
export const DELETE = () => rejectBrowserMethod(TEMPLATE, "DELETE");
