"use client";

import type { ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { cn } from "@/lib/ui/utils";

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}

export function SettingsModal({
  open,
  onOpenChange,
  title,
  children
}: SettingsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex max-h-[90%] flex-col gap-0 p-0",
          "lg:max-w-[50%] md:max-w-[75%] sm:max-w-[90%]"
        )}
      >
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="text-lg font-medium">{title}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto">{children}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
