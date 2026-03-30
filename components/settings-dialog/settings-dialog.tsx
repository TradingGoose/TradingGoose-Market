"use client";

import { SettingsModal } from "./settings-modal";
import { TeamManagement } from "./team-management";

export type SettingsSection = "team";

interface SettingsDialogProps {
  open: boolean;
  section: SettingsSection;
  onOpenChange: (open: boolean) => void;
  currentUserEmail: string;
}

const SECTION_CONFIG: Record<SettingsSection, { title: string }> = {
  team: { title: "Team Management" }
};

export function SettingsDialog({
  open,
  section,
  onOpenChange,
  currentUserEmail
}: SettingsDialogProps) {
  const config = SECTION_CONFIG[section];

  return (
    <SettingsModal open={open} onOpenChange={onOpenChange} title={config.title}>
      {section === "team" && (
        <TeamManagement currentUserEmail={currentUserEmail} />
      )}
    </SettingsModal>
  );
}
