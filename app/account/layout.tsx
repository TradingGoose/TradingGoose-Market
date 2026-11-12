import { cookies } from "next/headers";

import { AppShell } from "@/components/app-shell";
import { getCurrentSystemAdmin } from "@/lib/admin/access";
import { requireCustomerSession } from "@/lib/auth/session";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const session = await requireCustomerSession();
  const membership = await getCurrentSystemAdmin(session.user.id);
  const cookieStore = await cookies();
  return (
    <AppShell mode="account" defaultOpen={cookieStore.get("sidebar:state")?.value !== "false"} defaultWidth={cookieStore.get("sidebar:width")?.value} user={{ id: session.user.id, name: session.user.name, email: session.user.email, image: session.user.image ?? null, isAdmin: Boolean(membership) }}>
      {children}
    </AppShell>
  );
}
