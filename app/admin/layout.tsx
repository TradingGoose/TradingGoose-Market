import { cookies } from "next/headers";

import { AppShell } from "@/components/app-shell";
import { requireAuth } from "@/lib/auth/session";

type AdminLayoutProps = {
  children: React.ReactNode;
};

export default async function AdminLayout({ children }: AdminLayoutProps) {
  const session = await requireAuth();

  const cookieStore = await cookies();
  const sidebarState = cookieStore.get("sidebar:state")?.value;
  const sidebarWidth = cookieStore.get("sidebar:width")?.value;

  const defaultOpen = sidebarState ? sidebarState === "true" : true;
  const defaultWidth = sidebarWidth ?? undefined;

  const user = {
    name: session.user.name,
    email: session.user.email,
    image: (session.user as { image?: string | null }).image ?? null,
    role: (session.user as { role?: string }).role ?? "viewer"
  };

  return (
    <AppShell defaultOpen={defaultOpen} defaultWidth={defaultWidth} user={user}>
      {children}
    </AppShell>
  );
}
