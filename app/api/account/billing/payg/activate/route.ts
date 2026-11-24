import { apiRequireCustomerSession } from "@/lib/auth/session";
import { activateMarketPayg, PaygActivationError } from "@/lib/billing/activation";
import {
  browserRouteDescriptor,
  rejectBrowserHead,
  rejectBrowserMethod,
  rejectBrowserOptions,
} from "@/lib/market-api/core/browser-route";

const TEMPLATE = "/api/account/billing/payg/activate";
browserRouteDescriptor(TEMPLATE, "POST");

export async function POST(request: Request) {
  const guard = await apiRequireCustomerSession(request);
  if (guard.error) return guard.error;
  try {
    return Response.json(await activateMarketPayg(guard.user.id));
  } catch (error) {
    if (error instanceof PaygActivationError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("PAYG activation failed", {
      userId: guard.user.id,
      errorClass: error instanceof Error ? error.name : "UnknownError",
    });
    return Response.json(
      { error: "PAYG activation failed", code: "PAYG_ACTIVATION_FAILED" },
      { status: 503 },
    );
  }
}

export const HEAD = () => rejectBrowserHead(TEMPLATE);
export const OPTIONS = () => rejectBrowserOptions(TEMPLATE);
export const GET = () => rejectBrowserMethod(TEMPLATE, "GET");
export const PUT = () => rejectBrowserMethod(TEMPLATE, "PUT");
export const PATCH = () => rejectBrowserMethod(TEMPLATE, "PATCH");
export const DELETE = () => rejectBrowserMethod(TEMPLATE, "DELETE");
