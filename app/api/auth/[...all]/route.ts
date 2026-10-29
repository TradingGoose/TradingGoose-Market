import { auth } from "@/lib/auth/server";
import { dispatchAuthProtocolRequest } from "@/lib/auth/protocol";
import { ensureMarketCustomerState } from "@/lib/billing/customer-state";
import { getMarketRuntimeConfig } from "@/lib/environment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(request: Request): Promise<Response> {
  return dispatchAuthProtocolRequest(request, async (accepted) => {
    const response = await auth.handler(accepted);
    if (
      response.ok &&
      accepted.method === "GET" &&
      new URL(accepted.url).pathname === "/api/auth/get-session"
    ) {
      try {
        const session = await response.clone().json();
        if (session?.user && !session.user.emailVerified && getMarketRuntimeConfig().betterAuth.emailVerificationEnabled) {
          return Response.json(null);
        }
        if (session?.user) await ensureMarketCustomerState(session.user.id);
      } catch {
        return Response.json(
          { error: "CUSTOMER_STATE_UNAVAILABLE" },
          { status: 503 }
        );
      }
    }
    return response;
  });
}

export const GET = handle;
export const POST = handle;
export const HEAD = handle;
export const OPTIONS = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
