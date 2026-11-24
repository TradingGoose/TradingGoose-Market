"use client";

import { useEffect } from "react";

import { ProfileSettings } from "./profile-settings";
import { SettingsModal } from "./settings-modal";
import { SubscriptionSettings } from "./subscription-settings";
import type { EmailChangeCallbackState } from "@/lib/auth/email-change-callback";

export type SettingsSection = "profile" | "subscription";

type SettingsUser = { id: string; name: string; email: string; image?: string | null };

export function SettingsDialog({ open, section, onOpenChange, user, emailChangeState, onRetryEmailChange, onRefreshUser }: {
  open: boolean;
  section: SettingsSection;
  onOpenChange: (open: boolean) => void;
  user: SettingsUser;
  emailChangeState: EmailChangeCallbackState;
  onRetryEmailChange: () => Promise<void>;
  onRefreshUser: () => Promise<SettingsUser | null>;
}) {
  useEffect(() => {
    if (open && section === "profile") {
      void onRefreshUser();
    }
  }, [onRefreshUser, open, section]);

  return (
    <SettingsModal
      open={open}
      onOpenChange={onOpenChange}
      title={section === "profile" ? "Profile" : "Subscription"}
      contentClassName="p-6"
    >
      {section === "profile" ? (
        <ProfileSettings
          key={user.email}
          user={user}
          emailChangeState={emailChangeState}
          onRetryEmailChange={onRetryEmailChange}
          onRefreshUser={onRefreshUser}
        />
      ) : <SubscriptionSettings onOpenChange={onOpenChange} />}
    </SettingsModal>
  );
}
