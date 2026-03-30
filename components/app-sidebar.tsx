"use client";

import type { Route } from "next";
import {
  Bitcoin,
  ChevronsUpDown,
  Clock3,
  Coins,
  Database,
  Flag,
  Landmark,
  Layers,
  MapPin,
  Network,
  Users
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail
} from "@/components/ui/sidebar";
import type { SettingsSection } from "@/components/settings-dialog/settings-dialog";
import { UserMenu, type UserMenuUser } from "@/components/user-menu";

type NavItem = { title: string; href: Route; icon: typeof Database };

const navItems: NavItem[] = [
  { title: "Listings", href: "/admin/listings" as Route, icon: Layers },
  { title: "Cryptos", href: "/admin/cryptos" as Route, icon: Bitcoin },
  { title: "Chains", href: "/admin/chains" as Route, icon: Network },
  { title: "Exchanges", href: "/admin/exchanges" as Route, icon: Database },
  { title: "Markets", href: "/admin/markets" as Route, icon: Landmark },
  { title: "Countries", href: "/admin/countries" as Route, icon: Flag },
  { title: "Cities", href: "/admin/cities" as Route, icon: MapPin },
  { title: "Currencies", href: "/admin/currencies" as Route, icon: Coins },
  { title: "Timezones", href: "/admin/timezones" as Route, icon: Clock3 },
  { title: "MarketHours", href: "/admin/market-hours" as Route, icon: Layers }
];

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  user: UserMenuUser;
  onOpenSettings?: (section: SettingsSection) => void;
};

export function AppSidebar({ user, onOpenSettings, ...props }: AppSidebarProps) {
  const pathname = usePathname() ?? "/";
  const isAdmin = user.role === "admin";

  return (
    <Sidebar collapsible="icon" variant="sidebar" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            {isAdmin ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    size="lg"
                    className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                  >
                    <div className="flex aspect-square size-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
                      <Layers className="size-4" />
                    </div>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">TradingGoose</span>
                      <span className="truncate text-xs">Market</span>
                    </div>
                    <ChevronsUpDown className="ml-auto" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-md"
                  side="bottom"
                  sideOffset={4}
                  align="start"
                >
                  <DropdownMenuItem asChild>
                    <Link href={"/admin" as Route}>
                      <Layers className="mr-2 size-4" />
                      Dashboard
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      onOpenSettings?.("team");
                    }}
                  >
                    <Users className="mr-2 size-4" />
                    Team Management
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <SidebarMenuButton asChild size="lg">
                <Link href={"/admin" as Route}>
                  <div className="flex aspect-square size-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
                    <Layers className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">TradingGoose</span>
                    <span className="truncate text-xs">Market</span>
                  </div>
                </Link>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarMenu>
            {navItems.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === item.href || pathname.startsWith(`${item.href}/`)}
                >
                  <Link href={item.href}>
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <UserMenu user={user} onOpenSettings={onOpenSettings} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
