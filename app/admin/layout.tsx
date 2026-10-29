import { cookies } from "next/headers";

import { AppShell } from "@/components/app-shell";
import { requireSystemAdmin } from "@/lib/auth/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSystemAdmin();
  const cookieStore = await cookies();
  return (
    <AppShell mode="admin" defaultOpen={cookieStore.get("sidebar:state")?.value !== "false"} defaultWidth={cookieStore.get("sidebar:width")?.value} user={{ id: session.user.id, name: session.user.name, email: session.user.email, image: session.user.image ?? null, isAdmin: true }}>
      {children}
    </AppShell>
  );
}
