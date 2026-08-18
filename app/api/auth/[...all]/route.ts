import { auth } from "@/lib/auth/server";
import { dispatchAuthProtocolRequest } from "@/lib/auth/protocol";
import { ensureMarketCustomerState } from "@/lib/billing/customer-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(request: Request): Promise<Response> {
  return dispatchAuthProtocolRequest(request, async (accepted) => {
    if (
      accepted.method === "GET" &&
      new URL(accepted.url).pathname === "/api/auth/get-session"
    ) {
      try {
        const session = await auth.api.getSession({ headers: accepted.headers });
        if (session?.user && !session.user.emailVerified) {
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
    return auth.handler(accepted);
  });
}

export const GET = handle;
export const POST = handle;
export const HEAD = handle;
export const OPTIONS = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
