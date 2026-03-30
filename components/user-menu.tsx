"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import {
  ChevronsUpDown,
  LogOut,
  Moon,
  Monitor,
  Sun,
  Users
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { authClient } from "@/lib/auth/client";
import type { SettingsSection } from "@/components/settings-dialog/settings-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from "@/components/ui/sidebar";

export type UserMenuUser = {
  name: string;
  email: string;
  image?: string | null;
  role?: string;
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

type ThemeOption = {
  value: "light" | "system" | "dark";
  label: string;
  Icon: LucideIcon;
};

const THEME_OPTIONS: ThemeOption[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "system", label: "System", Icon: Monitor },
  { value: "dark", label: "Dark", Icon: Moon }
];

const THEME_ITEM_BASE =
  "relative flex h-9 flex-1 items-center justify-center gap-0 rounded-md border px-0 py-0 text-sm transition-colors focus:bg-accent focus:text-accent-foreground";
const THEME_ITEM_ACTIVE = "border-border bg-accent text-accent-foreground shadow-sm";
const THEME_ITEM_INACTIVE =
  "border-transparent text-muted-foreground hover:bg-card hover:text-foreground";

interface UserMenuProps {
  user: UserMenuUser;
  onOpenSettings?: (section: SettingsSection) => void;
}

export function UserMenu({ user, onOpenSettings }: UserMenuProps) {
  const { theme, setTheme } = useTheme();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const currentThemeLabel =
    THEME_OPTIONS.find((o) => o.value === theme)?.label ?? "Theme";

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await authClient.signOut();
    } finally {
      window.location.assign("/login");
    }
  };

  const isAdmin = user.role === "admin";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-md">
                {user.image && <AvatarImage src={user.image} alt={user.name} />}
                <AvatarFallback className="rounded-md text-xs">
                  {getInitials(user.name)}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{user.name}</span>
                <span className="truncate text-xs">{user.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            sideOffset={4}
            align="start"
          >
            {/* Theme toggle row */}
            <DropdownMenuGroup>
              <div className="flex items-center gap-1.5 px-2 pb-1.5 pt-0.5">
                <DropdownMenuItem className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  {currentThemeLabel}
                </DropdownMenuItem>
                {THEME_OPTIONS.map(({ value, label, Icon }) => {
                  const isActive = theme === value;
                  return (
                    <DropdownMenuItem
                      key={value}
                      aria-label={`${label} theme`}
                      className={`${THEME_ITEM_BASE} ${isActive ? THEME_ITEM_ACTIVE : THEME_ITEM_INACTIVE}`}
                      onSelect={(e) => {
                        if (isActive) {
                          e.preventDefault();
                          return;
                        }
                        setTheme(value);
                      }}
                      title={label}
                    >
                      <Icon className="size-4" />
                    </DropdownMenuItem>
                  );
                })}
              </div>
            </DropdownMenuGroup>

            {/* Team management (admin only) */}
            {isAdmin && onOpenSettings && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      onOpenSettings("team");
                    }}
                  >
                    <Users />
                    Team Management
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </>
            )}

            {/* Logout */}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={isSigningOut}
              onSelect={(e) => {
                e.preventDefault();
                handleSignOut();
              }}
              className="text-destructive focus:text-destructive"
            >
              <LogOut className="text-destructive" />
              {isSigningOut ? "Logging out..." : "Log out"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
