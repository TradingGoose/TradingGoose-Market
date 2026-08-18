"use client";

import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Bitcoin, Clock3, Coins, Database, FileClock, Flag, KeyRound, Landmark, Layers, MapPin, Network } from "lucide-react";

import type { SettingsSection } from "@/components/settings-dialog/settings-dialog";
import { SidebarUsageIndicator } from "@/components/sidebar-usage-indicator";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail } from "@/components/ui/sidebar";
import { UserMenu, type UserMenuUser } from "@/components/user-menu";

type NavItem = { title: string; href: Route; icon: typeof KeyRound };

const accountItems: NavItem[] = [
  { title: "API Keys", href: "/account/api-keys" as Route, icon: KeyRound },
  { title: "Activity", href: "/account/activity" as Route, icon: Activity },
  { title: "Logs", href: "/account/logs" as Route, icon: FileClock }
];

const adminItems: NavItem[] = [
  { title: "Admin API Keys", href: "/admin/api-keys" as Route, icon: KeyRound },
  { title: "Private API Usage", href: "/admin/api-usage" as Route, icon: Activity },
  { title: "Listings", href: "/admin/listings" as Route, icon: Layers },
  { title: "Cryptocurrencies", href: "/admin/cryptos" as Route, icon: Bitcoin },
  { title: "Chains", href: "/admin/chains" as Route, icon: Network },
  { title: "Exchanges", href: "/admin/exchanges" as Route, icon: Database },
  { title: "Markets", href: "/admin/markets" as Route, icon: Landmark },
  { title: "Countries", href: "/admin/countries" as Route, icon: Flag },
  { title: "Cities", href: "/admin/cities" as Route, icon: MapPin },
  { title: "Currencies", href: "/admin/currencies" as Route, icon: Coins },
  { title: "Timezones", href: "/admin/timezones" as Route, icon: Clock3 },
  { title: "Market Hours", href: "/admin/market-hours" as Route, icon: Clock3 }
];

export function AppSidebar({ user, mode, onOpenSettings, ...props }: React.ComponentProps<typeof Sidebar> & { user: UserMenuUser; mode: "account" | "admin"; onOpenSettings: (section: SettingsSection) => void }) {
  const pathname = usePathname() ?? "/";
  const items = mode === "account" ? accountItems : adminItems;
  return (
    <Sidebar collapsible="icon" variant="sidebar" {...props}>
      <SidebarHeader>
        <SidebarMenu><SidebarMenuItem><SidebarMenuButton asChild size="lg"><Link href={(mode === "account" ? "/account/api-keys" : "/admin") as Route}><Image src="/icon.png" alt="" width={32} height={32} className="size-8 rounded-md" /><div className="grid flex-1 text-left text-sm leading-tight"><span className="truncate font-semibold">TradingGoose</span><span className="truncate text-xs">{mode === "account" ? "Market" : "Market Admin"}</span></div></Link></SidebarMenuButton></SidebarMenuItem></SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{mode === "account" ? "Market" : "Administration"}</SidebarGroupLabel>
          <SidebarMenu>{items.map((item) => <SidebarMenuItem key={item.href}><SidebarMenuButton asChild isActive={pathname === item.href || pathname.startsWith(`${item.href}/`)} tooltip={item.title}><Link href={item.href}><item.icon /><span>{item.title}</span></Link></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="gap-2">
        <SidebarUsageIndicator onOpenSubscription={() => onOpenSettings("subscription")} />
        <UserMenu user={user} mode={mode} onOpenSettings={onOpenSettings} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

export { accountItems, adminItems };
