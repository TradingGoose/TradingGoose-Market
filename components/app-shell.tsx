"use client";

import { usePathname } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import type { UserMenuUser } from "@/components/user-menu";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

type AppShellProps = {
  children: React.ReactNode;
  defaultOpen?: boolean;
  defaultWidth?: string;
  user: UserMenuUser;
};

const TITLES: Record<string, string> = {
  "/admin": "Dashboard",
  "/admin/listings": "Listings",
  "/admin/cryptos": "Cryptos",
  "/admin/chains": "Chains",
  "/admin/exchanges": "Exchanges",
  "/admin/markets": "Markets",
  "/admin/countries": "Countries",
  "/admin/cities": "Cities",
  "/admin/currencies": "Currencies",
  "/admin/timezones": "Timezones",
  "/admin/market-hours": "MarketHours",
  "/admin/team": "Team"
};

export function AppShell({ children, defaultOpen, defaultWidth, user }: AppShellProps) {
  const pathname = usePathname() ?? "/";
  const normalizedPath = pathname !== "/" ? pathname.replace(/\/+$/, "") : "/";
  const title = TITLES[normalizedPath] ?? "Admin";

  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <div className="flex h-screen w-screen max-w-[100vw] overflow-hidden bg-background">
        <SidebarProvider
          defaultOpen={defaultOpen}
          defaultWidth={defaultWidth}
          className="h-full min-h-0 w-full overflow-hidden"
        >
          <AppSidebar user={user} />
          <SidebarInset className="overflow-hidden bg-background">
            <div className="flex h-full min-h-0 flex-col bg-background">
              <header className="relative z-10 flex h-12 items-center gap-3 border-b px-4">
                <SidebarTrigger className="text-muted-foreground bg-muted/40" />
                <Separator orientation="vertical" className="h-6" />
                <span className="truncate text-sm font-medium text-foreground">{title}</span>
              </header>
              <div className="min-h-0 flex-1 overflow-hidden p-3">
                <div className="h-full w-full overflow-auto">{children}</div>
              </div>
            </div>
          </SidebarInset>
        </SidebarProvider>
      </div>
    </TooltipProvider>
  );
}
