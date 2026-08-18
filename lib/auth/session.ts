import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { getCurrentSystemAdmin } from "@/lib/admin/access";
import { auth } from "@/lib/auth/server";
import { ensureMarketCustomerState } from "@/lib/billing/customer-state";
import { requireSameOriginBrowserMutation } from "@/lib/market-api/core/browser-route";

export type MarketSessionUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
};

export async function getSession(headers?: Headers) {
  const requestHeaders = headers ?? new Headers({
    cookie: (await cookies()).toString()
  });
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (session?.user && !session.user.emailVerified) {
    return null;
  }

  if (session?.user) {
    await ensureMarketCustomerState(session.user.id);
  }

  return session;
}

export async function requireCustomerSession(callbackUrl = "/account/api-keys") {
  const session = await getSession();
  if (!session?.user) {
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }
  return session;
}

export async function requireSystemAdmin() {
  const session = await requireCustomerSession("/admin");
  const membership = await getCurrentSystemAdmin(session.user.id);
  if (!membership) {
    redirect("/account/api-keys");
  }
  return { ...session, systemAdmin: membership };
}

type CustomerGuardSuccess = {
  user: MarketSessionUser;
  error?: never;
};

type CustomerGuardFailure = {
  user?: never;
  error: Response;
};

export type CustomerGuardResult = CustomerGuardSuccess | CustomerGuardFailure;

export async function apiRequireCustomerSession(request: Request): Promise<CustomerGuardResult> {
  const originError = requireSameOriginBrowserMutation(request);
  if (originError) return { error: originError };

  let session: Awaited<ReturnType<typeof getSession>>;
  try {
    session = await getSession(request.headers);
  } catch {
    return {
      error: NextResponse.json(
        { error: "CUSTOMER_STATE_UNAVAILABLE" },
        { status: 503 }
      )
    };
  }

  if (!session?.user) {
    return {
      error: NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
    };
  }

  return { user: session.user as MarketSessionUser };
}

export type SystemAdminGuardResult =
  | {
      user: MarketSessionUser;
      systemAdmin: NonNullable<Awaited<ReturnType<typeof getCurrentSystemAdmin>>>;
      error?: never;
    }
  | CustomerGuardFailure;

export async function apiRequireSystemAdmin(request: Request): Promise<SystemAdminGuardResult> {
  const customer = await apiRequireCustomerSession(request);
  if (customer.error) return customer;

  let membership: Awaited<ReturnType<typeof getCurrentSystemAdmin>>;
  try {
    membership = await getCurrentSystemAdmin(customer.user.id);
  } catch {
    return {
      error: NextResponse.json(
        { error: "ADMIN_STATE_UNAVAILABLE" },
        { status: 503 }
      )
    };
  }

  if (!membership) {
    return {
      error: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    };
  }

  return {
    user: customer.user,
    systemAdmin: membership
  };
}
