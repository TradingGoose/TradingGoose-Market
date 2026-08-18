import type { ReactNode } from "react";

export function AccountPageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="space-y-1"><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="max-w-2xl text-sm text-muted-foreground">{description}</p></div>{actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}</div>;
}
