import type { ReactNode } from "react";

import { PageHeader } from "@/components/page-header";

export function AdminPageShell({ title, description, actions, children }: { title: string; description: string; actions?: ReactNode; children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6"><PageHeader title={title} description={description} actions={actions} />{children}</div>;
}
