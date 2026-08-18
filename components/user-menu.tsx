"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { Check, ChevronsUpDown, CreditCard, Loader2, LogOut, Monitor, Moon, ShieldCheck, Star, Sun, UserRound } from "lucide-react";

import type { SettingsSection } from "@/components/settings-dialog/settings-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { useMarketResource, marketApiRequest } from "@/hooks/use-market-resource";
import type { BillingSummary } from "@/lib/account/contracts";
import { authClient } from "@/lib/auth/client";

export type UserMenuUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  isAdmin: boolean;
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export function UserMenu({ user, mode, onOpenSettings }: { user: UserMenuUser; mode: "account" | "admin"; onOpenSettings: (section: SettingsSection) => void }) {
  const { theme, setTheme } = useTheme();
  const { data: billing, isLoading: isBillingLoading } = useMarketResource<BillingSummary>("/api/account/billing");
  const [signingOut, setSigningOut] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);
  const billingEnabled = billing?.billingEnabled !== false;
  const portalUnavailable = billing?.portalAvailable === false;

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const result = await authClient.signOut();
      if (!result.error && result.data.success) window.location.assign("/login");
    } catch {
      // Keep the current shell available when the sign-out request fails.
    } finally {
      setSigningOut(false);
    }
  }

  async function openPortal() {
    if (openingPortal || isBillingLoading || !billingEnabled || portalUnavailable) return;
    setOpeningPortal(true);
    try {
      const result = await marketApiRequest<{ url: string }>("/api/account/billing/portal", { method: "POST", body: "{}" });
      window.location.assign(result.url);
    } catch {
      // Leave the menu usable so a transient portal failure can be retried.
    } finally {
      setOpeningPortal(false);
    }
  }

  const themes = [{ value: "light", label: "Light", icon: Sun }, { value: "system", label: "System", icon: Monitor }, { value: "dark", label: "Dark", icon: Moon }];

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><SidebarMenuButton size="lg" aria-label={`${user.name} profile menu`} className="data-[state=open]:bg-sidebar-accent"><Avatar className="size-8 rounded-md">{user.image ? <AvatarImage src={user.image} alt={user.name} /> : null}<AvatarFallback className="rounded-md text-xs">{initials(user.name)}</AvatarFallback></Avatar><div className="grid flex-1 text-left text-sm leading-tight"><span className="truncate font-semibold">{user.name}</span><span className="truncate text-xs">{user.email}</span></div><ChevronsUpDown className="ml-auto size-4" /></SidebarMenuButton></DropdownMenuTrigger>
          <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[min(15rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] rounded-md" side="top" align="start" sideOffset={6}>
            <DropdownMenuGroup>
              <div className="grid grid-cols-3 gap-1 p-2">
                {themes.map(({ value, label, icon: Icon }) => <Button key={value} type="button" variant={theme === value ? "secondary" : "ghost"} size="sm" className="h-8 px-2" onClick={() => setTheme(value)} aria-label={`${label} theme`}><Icon className="size-3.5" />{theme === value ? <Check className="size-3" /> : null}</Button>)}
              </div>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={(event) => { event.preventDefault(); onOpenSettings("profile"); }}><UserRound />Profile</DropdownMenuItem>
            </DropdownMenuGroup>
            {billingEnabled ? <><DropdownMenuSeparator /><DropdownMenuGroup><DropdownMenuItem onSelect={(event) => { event.preventDefault(); onOpenSettings("subscription"); }}><Star />Subscription</DropdownMenuItem><DropdownMenuItem disabled={openingPortal || isBillingLoading || portalUnavailable} onSelect={(event) => { event.preventDefault(); void openPortal(); }}>{openingPortal ? <Loader2 className="animate-spin" /> : <CreditCard />}{openingPortal ? "Opening Billing…" : "Manage Billing"}</DropdownMenuItem></DropdownMenuGroup></> : null}
            {user.isAdmin ? <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => window.location.assign(mode === "admin" ? "/account/api-keys" : "/admin")}><ShieldCheck />{mode === "admin" ? "Customer account" : "Admin"}</DropdownMenuItem></> : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" disabled={signingOut} onSelect={(event) => { event.preventDefault(); void signOut(); }}>{signingOut ? <Loader2 className="animate-spin" /> : <LogOut />}{signingOut ? "Signing out…" : "Sign out"}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
