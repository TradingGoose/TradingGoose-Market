import type { ReactNode } from "react";

import { cn } from "@/lib/ui/utils";

export function AuthBackground({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative min-h-screen w-full overflow-hidden", className)}>
      <div className="relative z-20 mx-auto w-full">{children}</div>
    </div>
  );
}
