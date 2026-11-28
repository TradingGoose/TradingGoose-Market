import { eq } from "drizzle-orm";
import { z } from "zod";
import { userStats } from "@tradinggoose/db/schema";
import { apiRequireCustomerSession } from "@/lib/auth/session";
import { withBillingSubjectLock } from "@/lib/db/locks";

import { browserRouteDescriptor, rejectBrowserHead, rejectBrowserMethod, rejectBrowserOptions } from "@/lib/market-api/core/browser-route";

const TEMPLATE = "/api/account/billing/notifications";
browserRouteDescriptor(TEMPLATE, "GET");
browserRouteDescriptor(TEMPLATE, "PATCH");

const preferences = z.object({ billingUsageNotificationsEnabled: z.boolean() }).strict();
const selection = { billingUsageNotificationsEnabled: userStats.billingUsageNotificationsEnabled };

async function notifications(request: Request, editing: boolean) {
  const guard = await apiRequireCustomerSession(request);
  if (guard.error) return guard.error;
  const body = editing ? preferences.safeParse(await request.json().catch(() => null)) : null;
  if (body && !body.success) return Response.json({ error: "Expected billingUsageNotificationsEnabled boolean." }, { status: 400 });
  try {
    const [result] = await withBillingSubjectLock(guard.user.id, async tx => {
      const own = eq(userStats.userId, guard.user.id);
      return body?.success
        ? tx.update(userStats).set({ ...body.data, updatedAt: new Date() }).where(own).returning(selection)
        : tx.select(selection).from(userStats).where(own).limit(1);
    });
    if (!result) throw new Error("Missing billing preferences");
    return Response.json(result);
  } catch {
    return Response.json({ error: "CUSTOMER_STATE_UNAVAILABLE" }, { status: 503 });
  }
}
export const GET = (request: Request) => notifications(request, false);
export const PATCH = (request: Request) => notifications(request, true);

export const HEAD = () => rejectBrowserHead(TEMPLATE);
export const OPTIONS = () => rejectBrowserOptions(TEMPLATE);
export const POST = () => rejectBrowserMethod(TEMPLATE, "POST");
export const PUT = () => rejectBrowserMethod(TEMPLATE, "PUT");
export const DELETE = () => rejectBrowserMethod(TEMPLATE, "DELETE");
