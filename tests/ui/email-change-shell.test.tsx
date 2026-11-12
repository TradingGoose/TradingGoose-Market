// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("next/navigation", () => ({ usePathname: () => "/account/api-keys" }));
vi.mock("@/lib/auth/client", () => ({ authClient: { getSession } }));
vi.mock("@/components/app-sidebar", () => ({
  AppSidebar: ({ user }: { user: { name: string; email: string } }) => (
    <div data-testid="sidebar-user">{user.name}|{user.email}</div>
  ),
}));
vi.mock("@/components/settings-dialog/settings-dialog", () => ({
  SettingsDialog: ({ open, section, user, emailChangeState, onRetryEmailChange }: {
    open: boolean;
    section: string;
    user: { name: string; email: string };
    emailChangeState: { kind: string };
    onRetryEmailChange: () => Promise<void>;
  }) => (
    <div data-testid="settings">
      {String(open)}|{section}|{user.name}|{user.email}|{emailChangeState.kind}
      <button type="button" onClick={() => void onRetryEmailChange()}>retry</button>
    </div>
  ),
}));
vi.mock("@/components/ui/separator", () => ({ Separator: () => <span /> }));
vi.mock("@/components/ui/sidebar", () => ({
  SidebarInset: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarTrigger: () => <button type="button">sidebar</button>,
}));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { AppShell } from "../../components/app-shell";

const originalUser = {
  id: "user_1",
  name: "Ada",
  email: "old@example.com",
  image: null,
  isAdmin: true,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  window.history.replaceState({}, "", "/account/api-keys");
});

describe("email-change account-shell consumption", () => {
  it("opens Profile, cleans only owned URL state, and publishes one authoritative snapshot", async () => {
    window.history.replaceState(
      { retained: true },
      "",
      "/account/api-keys?range=30d&emailChange=verified&key=key_1#usage",
    );
    getSession.mockResolvedValue({
      data: {
        user: {
          id: "user_1",
          name: "Ada Lovelace",
          email: "new@example.com",
          image: null,
        },
      },
      error: null,
    });

    render(<AppShell mode="account" user={originalUser}>content</AppShell>);

    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      "/account/api-keys?range=30d&key=key_1#usage",
    );
    expect(window.history.state).toEqual({ retained: true });
    await waitFor(() => {
      expect(screen.getByTestId("settings").textContent).toContain(
        "true|profile|Ada Lovelace|new@example.com|verified",
      );
    });
    expect(screen.getByTestId("sidebar-user").textContent).toBe(
      "Ada Lovelace|new@example.com",
    );
    expect(getSession).toHaveBeenCalledWith({
      query: { disableCookieCache: true },
    });
  });

  it("fails closed on a different identity and supports an authoritative retry", async () => {
    window.history.replaceState({}, "", "/account/api-keys?emailChange=verified");
    getSession
      .mockResolvedValueOnce({
        data: { user: { id: "user_2", name: "Other", email: "other@example.com" } },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { user: { id: "user_1", name: "Ada", email: "new@example.com" } },
        error: null,
      });

    render(<AppShell mode="account" user={originalUser}>content</AppShell>);

    await waitFor(() => {
      expect(screen.getByTestId("settings").textContent).toContain("refresh-error");
    });
    expect(screen.getByTestId("sidebar-user").textContent).toBe("Ada|old@example.com");

    await act(async () => {
      screen.getByRole("button", { name: "retry" }).click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("settings").textContent).toContain(
        "Ada|new@example.com|verified",
      );
    });
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("shows a provider error without refreshing the session", async () => {
    window.history.replaceState(
      {},
      "",
      "/account/activity?range=7d&emailChange=verified&error=token_expired#chart",
    );

    render(<AppShell mode="account" user={originalUser}>content</AppShell>);

    await waitFor(() => {
      expect(screen.getByTestId("settings").textContent).toContain(
        "true|profile|Ada|old@example.com|expired",
      );
    });
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      "/account/activity?range=7d#chart",
    );
    expect(getSession).not.toHaveBeenCalled();
  });
});
