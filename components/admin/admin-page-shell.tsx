import type { ReactNode } from "react";

export function AdminPageShell({ title, description, actions, children }: { title: string; description: string; actions?: ReactNode; children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="space-y-1"><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="max-w-3xl text-sm text-muted-foreground">{description}</p></div>{actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}</div>{children}</div>;
}
