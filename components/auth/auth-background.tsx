import type { ReactNode } from "react";

import { BackgroundRippleEffect } from "@/components/ui/background-ripple-effect";
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
      <BackgroundRippleEffect interactive={false} maskClassName="opacity-25" />
      <div className="relative z-20 mx-auto w-full">{children}</div>
    </div>
  );
}
