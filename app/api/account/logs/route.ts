import { apiRequireCustomerSession } from "@/lib/auth/session";
import {
  browserRouteDescriptor,
  rejectBrowserHead,
  rejectBrowserMethod,
  rejectBrowserOptions,
} from "@/lib/market-api/core/browser-route";
import {
  parseUsageFilters,
  UsageFilterInputError,
} from "@/lib/usage/http-filters";
import { getCustomerLogs } from "@/lib/usage/queries";

const TEMPLATE = "/api/account/logs";
browserRouteDescriptor(TEMPLATE, "GET");

export async function GET(request: Request) {
  const guard = await apiRequireCustomerSession(request);
  if (guard.error) return guard.error;
  try {
    const filters = parseUsageFilters(new URL(request.url), "logs");
    return Response.json(await getCustomerLogs(guard.user.id, filters));
  } catch (error) {
    if (error instanceof UsageFilterInputError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export const HEAD = () => rejectBrowserHead(TEMPLATE);
export const OPTIONS = () => rejectBrowserOptions(TEMPLATE);
export const POST = () => rejectBrowserMethod(TEMPLATE, "POST");
export const PUT = () => rejectBrowserMethod(TEMPLATE, "PUT");
export const PATCH = () => rejectBrowserMethod(TEMPLATE, "PATCH");
export const DELETE = () => rejectBrowserMethod(TEMPLATE, "DELETE");
