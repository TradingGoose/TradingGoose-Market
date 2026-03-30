import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/session";
import { TeamManagement } from "./components/team-management";

export default async function TeamPage() {
  const session = await getSession();
  if (!session?.user) {
    redirect("/login?callbackUrl=/admin/team");
  }

  const role = (session.user as { role?: string }).role;
  if (role !== "admin") {
    redirect("/admin");
  }

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto p-1">
        <TeamManagement currentUserEmail={session.user.email} />
      </section>
    </main>
  );
}
