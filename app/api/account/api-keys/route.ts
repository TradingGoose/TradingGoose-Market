import { apiRequireCustomerSession } from "@/lib/auth/session";
import { createCustomerApiKey, ApiKeyCreationConflict } from "@/lib/api-keys/creation";
import { listCustomerApiKeys } from "@/lib/api-keys/service";
import {
  ApiKeyInputError,
  parseCustomerKeyCreateInput,
  readApiKeyJsonBody,
} from "@/lib/api-keys/validation";
import {
  browserRouteDescriptor,
  rejectBrowserHead,
  rejectBrowserMethod,
  rejectBrowserOptions,
} from "@/lib/market-api/core/browser-route";

const TEMPLATE = "/api/account/api-keys";
browserRouteDescriptor(TEMPLATE, "GET");
browserRouteDescriptor(TEMPLATE, "POST");

export async function GET(request: Request) {
  const guard = await apiRequireCustomerSession(request);
  if (guard.error) return guard.error;
  return Response.json({ keys: await listCustomerApiKeys(guard.user.id) });
}

export async function POST(request: Request) {
  const guard = await apiRequireCustomerSession(request);
  if (guard.error) return guard.error;
  try {
    const input = parseCustomerKeyCreateInput(await readApiKeyJsonBody(request));
    const allowance =
      input.limitUsd === null
        ? ({ limitUsd: null, windowDays: null } as const)
        : ({ limitUsd: input.limitUsd, windowDays: input.windowDays! } as const);
    return Response.json(
      await createCustomerApiKey({
        userId: guard.user.id,
        name: input.name,
        allowance,
      }),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiKeyInputError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ApiKeyCreationConflict) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    console.error("Customer API key creation failed", {
      userId: guard.user.id,
      errorClass: error instanceof Error ? error.name : "UnknownError",
    });
    return Response.json({ error: "API key creation failed" }, { status: 503 });
  }
}

export const HEAD = () => rejectBrowserHead(TEMPLATE);
export const OPTIONS = () => rejectBrowserOptions(TEMPLATE);
export const PUT = () => rejectBrowserMethod(TEMPLATE, "PUT");
export const PATCH = () => rejectBrowserMethod(TEMPLATE, "PATCH");
export const DELETE = () => rejectBrowserMethod(TEMPLATE, "DELETE");
