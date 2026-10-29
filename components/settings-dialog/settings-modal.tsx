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
  sidebar?: ReactNode;
  sidebarClassName?: string;
  contentClassName?: string;
  headerAction?: ReactNode;
  dialogContentClassName?: string;
  headerClassName?: string;
  titleClassName?: string;
}

export function SettingsModal({
  open,
  onOpenChange,
  title,
  children,
  sidebar,
  sidebarClassName,
  contentClassName,
  headerAction,
  dialogContentClassName,
  headerClassName,
  titleClassName
}: SettingsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex max-h-[90%] max-h-[90dvh] w-[calc(100%-2rem)] min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-[90%] md:max-w-[75%] lg:max-w-[50%]",
          dialogContentClassName
        )}
      >
        <DialogHeader className={cn("shrink-0 border-b px-6 py-4 pr-12", headerClassName)}>
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className={cn("font-medium text-lg", titleClassName)}>
              {title}
            </DialogTitle>
            {headerAction}
          </div>
        </DialogHeader>
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          {sidebar ? (
            <div className={cn("w-[180px] flex-shrink-0 border-r", sidebarClassName)}>
              {sidebar}
            </div>
          ) : null}
          <div className={cn("min-w-0 flex-1 overflow-y-auto overscroll-contain", contentClassName)}>{children}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
