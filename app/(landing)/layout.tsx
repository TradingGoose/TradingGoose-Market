import { notFound } from "next/navigation";
import { isHosted } from "@/lib/environment";

type LandingLayoutProps = {
  children: React.ReactNode;
};

export default function LandingLayout({ children }: LandingLayoutProps) {
  if (isHosted) {
    notFound();
  }

  return <>{children}</>;
}
