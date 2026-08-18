import type { ReactNode } from "react";

import { soehne } from "@/app/fonts/soehne/soehne";

export function AuthPageHeader({ eyebrow, title, description }: { eyebrow: string; title: ReactNode; description: ReactNode }) {
  return (
    <div className="space-y-2 text-center">
      <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">{eyebrow}</p>
      <h1 className={`${soehne.className} text-[32px] font-medium tracking-tight`}>{title}</h1>
      <p className="text-base font-normal text-muted-foreground">{description}</p>
    </div>
  );
}
