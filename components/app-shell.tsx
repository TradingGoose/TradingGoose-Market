"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import { SettingsDialog, type SettingsSection } from "@/components/settings-dialog/settings-dialog";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { UserMenuUser } from "@/components/user-menu";
import { authClient } from "@/lib/auth/client";
import {
  parseEmailChangeCallback,
  type EmailChangeCallbackState,
  withoutEmailChangeCallback,
} from "@/lib/auth/email-change-callback";

const TITLES: Record<string, string> = {
  "/account/api-keys": "API Keys",
  "/account/activity": "Activity",
  "/account/logs": "Logs",
  "/admin": "Administration",
  "/admin/api-keys": "Admin API Keys",
  "/admin/api-usage": "Private API Usage",
  "/admin/listings": "Listings",
  "/admin/cryptos": "Cryptocurrencies",
  "/admin/chains": "Chains",
  "/admin/exchanges": "Exchanges",
  "/admin/markets": "Markets",
  "/admin/countries": "Countries",
  "/admin/cities": "Cities",
  "/admin/currencies": "Currencies",
  "/admin/timezones": "Timezones",
  "/admin/market-hours": "Market Hours"
};

function titleForPath(pathname: string, mode: "account" | "admin") {
  if (pathname.startsWith("/account/api-keys/")) return "API Key Detail";
  return TITLES[pathname.replace(/\/+$/, "") || "/"] ?? (mode === "account" ? "Market" : "Administration");
}

export function AppShell({ children, defaultOpen, defaultWidth, user, mode }: { children: React.ReactNode; defaultOpen?: boolean; defaultWidth?: string; user: UserMenuUser; mode: "account" | "admin" }) {
  const pathname = usePathname() ?? "/";
  const [currentUser, setCurrentUser] = useState(user);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("profile");
  const [emailChangeState, setEmailChangeState] = useState<EmailChangeCallbackState>({ kind: "none" });
  const consumedEmailCallback = useRef(false);
  const openSettings = (section: SettingsSection) => { setSettingsSection(section); setSettingsOpen(true); };

  const refreshUser = useCallback(async (): Promise<UserMenuUser | null> => {
    try {
      const result = await authClient.getSession({
        query: { disableCookieCache: true },
      });
      const sessionUser = result.data?.user;
      if (result.error || !sessionUser || sessionUser.id !== user.id) return null;

      const refreshed: UserMenuUser = {
        id: sessionUser.id,
        name: sessionUser.name,
        email: sessionUser.email,
        image: sessionUser.image ?? null,
        isAdmin: user.isAdmin,
      };
      setCurrentUser(refreshed);
      return refreshed;
    } catch {
      return null;
    }
  }, [user.id, user.isAdmin]);

  const refreshVerifiedEmail = useCallback(async () => {
    setEmailChangeState({ kind: "refreshing" });
    const refreshed = await refreshUser();
    setEmailChangeState(refreshed ? { kind: "verified" } : { kind: "refresh-error" });
  }, [refreshUser]);

  useEffect(() => {
    if (consumedEmailCallback.current) return;
    consumedEmailCallback.current = true;

    const callback = parseEmailChangeCallback(new URLSearchParams(window.location.search));
    if (callback.kind === "none") return;

    window.history.replaceState(
      window.history.state,
      "",
      withoutEmailChangeCallback(new URL(window.location.href)),
    );

    queueMicrotask(() => {
      setSettingsSection("profile");
      setSettingsOpen(true);
      if (callback.kind === "verified") {
        void refreshVerifiedEmail();
        return;
      }
      setEmailChangeState(callback);
    });
  }, [refreshVerifiedEmail]);

  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <div className="flex h-screen w-screen max-w-[100vw] overflow-hidden bg-background">
        <SidebarProvider defaultOpen={defaultOpen} defaultWidth={defaultWidth} className="h-full min-h-0 w-full overflow-hidden">
          <AppSidebar user={currentUser} mode={mode} onOpenSettings={openSettings} />
          <SidebarInset className="overflow-hidden bg-background">
            <div className="flex h-full min-h-0 flex-col">
              <header className="relative z-10 flex h-12 shrink-0 items-center gap-3 border-b px-4"><SidebarTrigger className="bg-muted/40 text-muted-foreground" /><Separator orientation="vertical" className="h-6" /><span className="truncate text-sm font-medium">{titleForPath(pathname, mode)}</span></header>
              <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-5 lg:p-6">{children}</div>
            </div>
          </SidebarInset>
        </SidebarProvider>
      </div>
      <SettingsDialog
        open={settingsOpen}
        section={settingsSection}
        onOpenChange={setSettingsOpen}
        user={{ id: currentUser.id, name: currentUser.name, email: currentUser.email, image: currentUser.image ?? null }}
        emailChangeState={emailChangeState}
        onRetryEmailChange={refreshVerifiedEmail}
        onRefreshUser={refreshUser}
      />
    </TooltipProvider>
  );
}
