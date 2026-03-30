import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { auth } from "./server";

// ---------------------------------------------------------------------------
// Shared session fetcher
// ---------------------------------------------------------------------------

export async function getSession() {
  const cookieStore = await cookies();
  return auth.api.getSession({
    headers: new Headers({
      cookie: cookieStore.toString()
    })
  });
}

// ---------------------------------------------------------------------------
// Page-level guards (redirect on failure — for layouts / server components)
// ---------------------------------------------------------------------------

export async function requireAuth() {
  const session = await getSession();
  if (!session?.user) {
    redirect("/login?callbackUrl=/admin");
  }
  return session;
}

export async function requireAdmin() {
  const session = await requireAuth();
  if ((session.user as { role?: string }).role !== "admin") {
    redirect("/admin");
  }
  return session;
}

export async function requireEditor() {
  const session = await requireAuth();
  const role = (session.user as { role?: string }).role;
  if (!role || !["admin", "editor"].includes(role)) {
    redirect("/admin");
  }
  return session;
}

// ---------------------------------------------------------------------------
// API-level guards (return NextResponse on failure — for route handlers)
// ---------------------------------------------------------------------------

type SessionUser = {
  id: string;
  name: string;
  email: string;
  role?: string;
};

type ApiGuardOk = { user: SessionUser; error?: never };
type ApiGuardFail = { user?: never; error: NextResponse };
type ApiGuardResult = ApiGuardOk | ApiGuardFail;

export async function apiRequireAuth(): Promise<ApiGuardResult> {
  const session = await getSession();
  if (!session?.user) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    };
  }
  return { user: session.user as SessionUser };
}

export async function apiRequireEditor(): Promise<ApiGuardResult> {
  const result = await apiRequireAuth();
  if (result.error) return result;
  const role = result.user.role;
  if (!role || !["admin", "editor"].includes(role)) {
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 })
    };
  }
  return result;
}

export async function apiRequireAdmin(): Promise<ApiGuardResult> {
  const result = await apiRequireAuth();
  if (result.error) return result;
  if (result.user.role !== "admin") {
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 })
    };
  }
  return result;
}
