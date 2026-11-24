import { apiRequireSystemAdmin } from "@/lib/auth/session";
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
import { getAdminActivity, getAdminLogs } from "@/lib/usage/queries";

const TEMPLATE = "/api/admin/api-usage";
browserRouteDescriptor(TEMPLATE, "GET");

export async function GET(request: Request) {
  const guard = await apiRequireSystemAdmin(request);
  if (guard.error) return guard.error;
  const url = new URL(request.url);
  const view = url.searchParams.get("view");
  if (url.searchParams.getAll("view").length !== 1 || (view !== "activity" && view !== "logs")) {
    return Response.json({ error: "view must be activity or logs" }, { status: 400 });
  }
  try {
    const filters = parseUsageFilters(url, view, { allowView: true });
    return Response.json(
      view === "activity"
        ? { view, data: await getAdminActivity(filters) }
        : { view, data: await getAdminLogs(filters) },
    );
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
