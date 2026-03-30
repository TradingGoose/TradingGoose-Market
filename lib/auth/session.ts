import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "./server";

export async function getSession() {
  const cookieStore = await cookies();
  return auth.api.getSession({
    headers: new Headers({
      cookie: cookieStore.toString()
    })
  });
}

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
