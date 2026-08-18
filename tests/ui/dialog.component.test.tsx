// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "../../components/ui/sheet";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function DialogFixture({ hideCloseButton = false }: { hideCloseButton?: boolean }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button">Open settings</button>
      </DialogTrigger>
      <DialogContent hideCloseButton={hideCloseButton} aria-describedby={undefined}>
        <DialogTitle>Settings</DialogTitle>
        <button type="button">Focusable content</button>
      </DialogContent>
    </Dialog>
  );
}

function SheetFixture() {
  return (
    <Sheet defaultOpen>
      <SheetContent aria-describedby={undefined}>
        <SheetTitle>Navigation</SheetTitle>
      </SheetContent>
    </Sheet>
  );
}

function overlayWithBlur(value: string): HTMLElement {
  const overlay = Array.from(document.querySelectorAll<HTMLElement>("[data-state='open']"))
    .find((element) => element.style.backdropFilter === value);
  if (!overlay) throw new Error(`Missing overlay with backdrop-filter ${value}.`);
  return overlay;
}

describe("TradingGoose Dialog behavior", () => {
  it("guards initial Escape, then closes and returns focus to its trigger", async () => {
    vi.useFakeTimers();
    render(<DialogFixture />);
    const trigger = screen.getByRole("button", { name: "Open settings" });

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.keyDown(document, { key: "Escape" });

    await act(async () => {
      vi.runAllTimers();
    });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("supports the Studio hide-close-button contract", () => {
    render(<DialogFixture hideCloseButton />);
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));

    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(screen.getByRole("button", { name: "Focusable content" })).toBeTruthy();
  });

  it("makes Close keyboard reachable after readiness with canonical focus styling", async () => {
    const interaction = userEvent.setup();
    render(<DialogFixture />);
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));

    const close = screen.getByRole("button", { name: "Close" }) as HTMLButtonElement;
    expect(close.disabled).toBe(true);
    expect(close.getAttribute("tabindex")).toBeNull();
    for (const className of [
      "focus-visible:ring-2",
      "focus-visible:ring-ring",
      "focus-visible:ring-offset-2",
      "focus-visible:ring-offset-background",
    ]) {
      expect(close.classList.contains(className)).toBe(true);
    }

    await waitFor(() => {
      expect(close.disabled).toBe(false);
    });

    screen.getByRole("button", { name: "Focusable content" }).focus();
    await interaction.tab();
    expect(document.activeElement).toBe(close);
    await interaction.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("uses valid backdrop utilities for Dialog and Sheet overlays", () => {
    const dialog = render(<DialogFixture />);
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    const dialogOverlay = overlayWithBlur("blur(1.5px)");
    expect(dialogOverlay.classList.contains("bg-black/50")).toBe(true);
    expect(dialogOverlay.classList.contains("/50")).toBe(false);
    dialog.unmount();

    render(<SheetFixture />);
    const sheetOverlay = overlayWithBlur("blur(4.8px)");
    expect(sheetOverlay.classList.contains("bg-black/50")).toBe(true);
    expect(sheetOverlay.classList.contains("/50")).toBe(false);
  });
});
