import { BackgroundRippleEffect } from "@/components/ui/background-ripple-effect";
import { cn } from "@/lib/ui/utils";

type LandingBackgroundProps = {
  className?: string;
  children: React.ReactNode;
};

export default function Background({ className, children }: LandingBackgroundProps) {
  return (
    <div className={cn("relative isolate h-svh overflow-hidden", className)}>
      <BackgroundRippleEffect cellSize={90} rows={15} />
      <div className="relative z-10 mx-auto w-full">{children}</div>
    </div>
  );
}
