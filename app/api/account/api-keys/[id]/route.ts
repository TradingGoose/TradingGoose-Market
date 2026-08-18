import { apiRequireCustomerSession } from "@/lib/auth/session";
import { revokeCustomerApiKey } from "@/lib/api-keys/revocation";
import {
  ApiKeyNotFoundError,
  ApiKeyRevisionConflict,
  getCustomerApiKeyDetail,
  updateCustomerApiKeyAllowance,
} from "@/lib/api-keys/service";
import {
  ApiKeyInputError,
  parseCustomerKeyUpdateInput,
  readApiKeyJsonBody,
} from "@/lib/api-keys/validation";
import {
  browserRouteDescriptor,
  rejectBrowserMethod,
  rejectBrowserHead,
  rejectBrowserOptions,
} from "@/lib/market-api/core/browser-route";

const TEMPLATE = "/api/account/api-keys/[id]";
for (const method of ["GET", "PATCH", "DELETE"] as const) {
  browserRouteDescriptor(TEMPLATE, method);
}
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const guard = await apiRequireCustomerSession(request);
  if (guard.error) return guard.error;
  try {
    return Response.json({
      key: await getCustomerApiKeyDetail(guard.user.id, (await context.params).id),
    });
  } catch (error) {
    return keyError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  const guard = await apiRequireCustomerSession(request);
  if (guard.error) return guard.error;
  try {
    const input = parseCustomerKeyUpdateInput(await readApiKeyJsonBody(request));
    const allowance =
      input.limitUsd === null
        ? ({ limitUsd: null, windowDays: null } as const)
        : ({ limitUsd: input.limitUsd, windowDays: input.windowDays! } as const);
    const key = await updateCustomerApiKeyAllowance({
      userId: guard.user.id,
      keyId: (await context.params).id,
      expectedRevision: input.expectedRevision,
      allowance,
    });
    return Response.json({ key });
  } catch (error) {
    return keyError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  const guard = await apiRequireCustomerSession(request);
  if (guard.error) return guard.error;
  try {
    const outcome = await revokeCustomerApiKey(
      guard.user.id,
      (await context.params).id,
    );
    return Response.json(outcome, {
      status: outcome.status === "revoked" ? 200 : 202,
    });
  } catch (error) {
    return keyError(error);
  }
}

function keyError(error: unknown) {
  if (error instanceof ApiKeyInputError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof ApiKeyNotFoundError) {
    return Response.json({ error: "API key was not found" }, { status: 404 });
  }
  if (error instanceof ApiKeyRevisionConflict) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  console.error("Customer API key operation failed", {
    errorClass: error instanceof Error ? error.name : "UnknownError",
  });
  return Response.json({ error: "API key operation failed" }, { status: 503 });
}

export const HEAD = () => rejectBrowserHead(TEMPLATE);
export const OPTIONS = () => rejectBrowserOptions(TEMPLATE);
export const POST = () => rejectBrowserMethod(TEMPLATE, "POST");
export const PUT = () => rejectBrowserMethod(TEMPLATE, "PUT");
