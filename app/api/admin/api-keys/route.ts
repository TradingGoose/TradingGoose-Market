import { apiRequireSystemAdmin } from "@/lib/auth/session";
import {
  ApiKeyCreationConflict,
  createAdminApiKey,
} from "@/lib/api-keys/creation";
import { listAdminApiKeys } from "@/lib/api-keys/service";
import {
  ApiKeyInputError,
  parseAdminKeyCreateInput,
  readApiKeyJsonBody,
} from "@/lib/api-keys/validation";
import {
  browserRouteDescriptor,
  rejectBrowserHead,
  rejectBrowserMethod,
  rejectBrowserOptions,
} from "@/lib/market-api/core/browser-route";

const TEMPLATE = "/api/admin/api-keys";
browserRouteDescriptor(TEMPLATE, "GET");
browserRouteDescriptor(TEMPLATE, "POST");

export async function GET(request: Request) {
  const guard = await apiRequireSystemAdmin(request);
  if (guard.error) return guard.error;
  return Response.json({ keys: await listAdminApiKeys() });
}

export async function POST(request: Request) {
  const guard = await apiRequireSystemAdmin(request);
  if (guard.error) return guard.error;
  try {
    const input = parseAdminKeyCreateInput(await readApiKeyJsonBody(request));
    return Response.json(
      await createAdminApiKey({
        userId: guard.user.id,
        adminGrantId: guard.systemAdmin.id,
        name: input.name,
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
    console.error("Private API key creation failed", {
      adminGrantId: guard.systemAdmin.id,
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
