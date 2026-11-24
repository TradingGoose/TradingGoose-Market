import { apiRequireSystemAdmin } from "@/lib/auth/session";
import { revokeAdminApiKey } from "@/lib/api-keys/revocation";
import { ApiKeyNotFoundError } from "@/lib/api-keys/service";
import {
  browserRouteDescriptor,
  rejectBrowserMethod,
  rejectBrowserHead,
  rejectBrowserOptions,
} from "@/lib/market-api/core/browser-route";

const TEMPLATE = "/api/admin/api-keys/[id]";
browserRouteDescriptor(TEMPLATE, "DELETE");
type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: Context) {
  const guard = await apiRequireSystemAdmin(request);
  if (guard.error) return guard.error;
  try {
    const outcome = await revokeAdminApiKey(
      (await context.params).id,
      guard.systemAdmin.id,
    );
    return Response.json(outcome, {
      status: outcome.status === "revoked" ? 200 : 202,
    });
  } catch (error) {
    if (error instanceof ApiKeyNotFoundError) {
      return Response.json({ error: "API key was not found" }, { status: 404 });
    }
    console.error("Private API key revocation failed", {
      adminGrantId: guard.systemAdmin.id,
      errorClass: error instanceof Error ? error.name : "UnknownError",
    });
    return Response.json({ error: "API key revocation failed" }, { status: 503 });
  }
}

export const HEAD = () => rejectBrowserHead(TEMPLATE);
export const OPTIONS = () => rejectBrowserOptions(TEMPLATE);
export const GET = () => rejectBrowserMethod(TEMPLATE, "GET");
export const POST = () => rejectBrowserMethod(TEMPLATE, "POST");
export const PUT = () => rejectBrowserMethod(TEMPLATE, "PUT");
export const PATCH = () => rejectBrowserMethod(TEMPLATE, "PATCH");
