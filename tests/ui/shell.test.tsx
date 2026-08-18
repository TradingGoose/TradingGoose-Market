// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type BillingFixture = {
  billingEnabled: boolean;
  plan: "payg";
  rateUsdPer1000Reads: string;
  currentPeriodRequestQuantity: number;
  currentPeriodCostUsd: string;
  status: "active";
  cancelAtPeriodEnd: boolean;
  customerRecoveryState: "ready";
  activationAvailable: boolean;
  portalAvailable: boolean;
};

const shell = vi.hoisted(() => ({
  pathname: "/account/activity",
  setTheme: vi.fn(),
  signOut: vi.fn(),
  marketApiRequest: vi.fn(),
  resource: {
    data: null as BillingFixture | null,
    isLoading: false,
    error: null as string | null,
  },
}));

vi.mock("next/navigation", () => ({ usePathname: () => shell.pathname }));
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", setTheme: shell.setTheme }),
}));
vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span aria-label={alt} />,
}));
vi.mock("@/lib/auth/client", () => ({
  authClient: { signOut: shell.signOut },
}));
vi.mock("@/hooks/use-market-resource", () => ({
  useMarketResource: () => shell.resource,
  marketApiRequest: shell.marketApiRequest,
}));

import { AppSidebar } from "../../components/app-sidebar";
import { SidebarMenuSkeleton, SidebarProvider, SidebarTrigger } from "../../components/ui/sidebar";

const billing: BillingFixture = {
  billingEnabled: true,
  plan: "payg",
  rateUsdPer1000Reads: "1",
  currentPeriodRequestQuantity: 42,
  currentPeriodCostUsd: "0.042",
  status: "active",
  cancelAtPeriodEnd: false,
  customerRecoveryState: "ready",
  activationAvailable: false,
  portalAvailable: true,
};

const user = {
  id: "user_1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  image: null,
  isAdmin: true,
};

const viewportListeners = new Set<() => void>();

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  viewportListeners.forEach((listener) => listener());
}

function renderSidebar({ defaultOpen = true, withTrigger = false, onOpenSettings = vi.fn() } = {}) {
  return render(
    <SidebarProvider defaultOpen={defaultOpen}>
      {withTrigger ? <SidebarTrigger /> : null}
      <AppSidebar user={user} mode="account" onOpenSettings={onOpenSettings} />
    </SidebarProvider>,
  );
}

beforeEach(() => {
  shell.pathname = "/account/activity";
  shell.resource = { data: billing, isLoading: false, error: null };
  shell.signOut.mockReset();
  shell.marketApiRequest.mockReset();
  shell.setTheme.mockReset();
  viewportListeners.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: window.innerWidth < 768,
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => viewportListeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => viewportListeners.delete(listener),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })),
  });
  setViewport(1024);
});

afterEach(() => {
  cleanup();
  viewportListeners.clear();
});

describe("Studio-shaped Market shell", () => {
  it("renders exactly the ordered customer destinations and marks the active route", () => {
    const { container } = renderSidebar();

    const primaryLinks = ["API Keys", "Activity", "Logs"].map((name) =>
      screen.getByRole("link", { name }),
    );
    expect(primaryLinks.map((link) => link.getAttribute("href"))).toEqual([
      "/account/api-keys",
      "/account/activity",
      "/account/logs",
    ]);
    expect(
      primaryLinks[1]
        .closest("[data-sidebar=menu-button]")
        ?.getAttribute("data-active"),
    ).toBe("true");
    expect(screen.queryByRole("link", { name: "Admin API Keys" })).toBeNull();
    expect(container.querySelector("[data-state=expanded]")).toBeTruthy();
  });

  it("opens the expanded usage preview from keyboard focus", async () => {
    const interaction = userEvent.setup();
    const openSettings = vi.fn();
    renderSidebar({ onOpenSettings: openSettings });

    const usagePreview = screen.getByRole("button", { name: /PAYG usage/i });
    usagePreview.focus();
    expect(document.activeElement).toBe(usagePreview);
    await interaction.keyboard("{Enter}");

    expect(openSettings).toHaveBeenCalledWith("subscription");
  });

  it("keeps the complete profile dropdown in the footer and constrains it to the viewport", async () => {
    const interaction = userEvent.setup();
    const openSettings = vi.fn();
    renderSidebar({ onOpenSettings: openSettings });

    const trigger = screen.getByRole("button", { name: "Ada Lovelace profile menu" });
    trigger.focus();
    await interaction.keyboard("{Enter}");

    for (const item of ["Profile", "Subscription", "Manage Billing", "Admin", "Sign out"]) {
      expect(screen.getByRole("menuitem", { name: item })).toBeTruthy();
    }
    for (const theme of ["Light theme", "System theme", "Dark theme"]) {
      expect(screen.getByRole("button", { name: theme })).toBeTruthy();
    }
    expect(screen.getByRole("menu").className).toContain("max-w-[calc(100vw-2rem)]");

    await interaction.click(screen.getByRole("menuitem", { name: "Profile" }));
    expect(openSettings).toHaveBeenCalledWith("profile");
  });

  it("defaults billing on while loading and keeps a stable expanded usage skeleton", async () => {
    shell.resource = { data: null, isLoading: true, error: null };
    const interaction = userEvent.setup();
    const view = renderSidebar();

    const loadingSkeleton = screen.getByLabelText("Billing usage preview");
    const loadingMarkup = loadingSkeleton.innerHTML;
    await interaction.click(screen.getByRole("button", { name: "Ada Lovelace profile menu" }));
    expect(screen.getByRole("menuitem", { name: "Subscription" }).hasAttribute("data-disabled")).toBe(false);
    expect(screen.getByRole("menuitem", { name: "Manage Billing" }).hasAttribute("data-disabled")).toBe(true);

    await interaction.keyboard("{Escape}");
    shell.resource = { data: null, isLoading: false, error: "REQUEST_FAILED" };
    view.rerender(
      <SidebarProvider defaultOpen>
        <AppSidebar user={user} mode="account" onOpenSettings={vi.fn()} />
      </SidebarProvider>,
    );
    expect(screen.getByLabelText("Billing usage preview").innerHTML).toBe(loadingMarkup);
  });

  it("allows a billing portal retry from the error state and contains request failures", async () => {
    shell.resource = { data: null, isLoading: false, error: "REQUEST_FAILED" };
    shell.marketApiRequest.mockRejectedValueOnce(new Error("portal unavailable"));
    const interaction = userEvent.setup();
    renderSidebar();

    await interaction.click(screen.getByRole("button", { name: "Ada Lovelace profile menu" }));
    const manageBilling = screen.getByRole("menuitem", { name: "Manage Billing" });
    expect(manageBilling.hasAttribute("data-disabled")).toBe(false);
    await interaction.click(manageBilling);

    await waitFor(() => expect(shell.marketApiRequest).toHaveBeenCalledWith(
      "/api/account/billing/portal",
      { method: "POST", body: "{}" },
    ));
    expect(screen.getByRole("menuitem", { name: "Manage Billing" }).hasAttribute("data-disabled")).toBe(false);
  });

  it("keeps Subscription available while disabling an explicitly unavailable portal", async () => {
    shell.resource = { data: { ...billing, portalAvailable: false }, isLoading: false, error: null };
    const interaction = userEvent.setup();
    renderSidebar();

    await interaction.click(screen.getByRole("button", { name: "Ada Lovelace profile menu" }));
    expect(screen.getByRole("menuitem", { name: "Subscription" }).hasAttribute("data-disabled")).toBe(false);
    expect(screen.getByRole("menuitem", { name: "Manage Billing" }).hasAttribute("data-disabled")).toBe(true);
  });

  it("omits billing actions and the usage preview only for explicit disabled billing", async () => {
    shell.resource = { data: { ...billing, billingEnabled: false, portalAvailable: false }, isLoading: false, error: null };
    const interaction = userEvent.setup();
    renderSidebar();

    expect(screen.queryByLabelText("Billing usage preview")).toBeNull();
    expect(screen.queryByRole("button", { name: /PAYG usage/i })).toBeNull();
    await interaction.click(screen.getByRole("button", { name: "Ada Lovelace profile menu" }));
    expect(screen.queryByRole("menuitem", { name: "Subscription" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Manage Billing" })).toBeNull();
  });

  it("omits the loading preview while collapsed and restores it with the keyboard shortcut", () => {
    shell.resource = { data: null, isLoading: true, error: null };
    const { container } = renderSidebar({ defaultOpen: false });

    expect(container.querySelector("[data-state=collapsed]")).toBeTruthy();
    expect(screen.queryByLabelText("Billing usage preview")).toBeNull();

    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(container.querySelector("[data-state=expanded]")).toBeTruthy();
    expect(screen.getByLabelText("Billing usage preview")).toBeTruthy();
  });

  it("renders and keyboard-opens the error-state shell on mobile", async () => {
    shell.resource = { data: null, isLoading: false, error: "REQUEST_FAILED" };
    setViewport(390);
    const interaction = userEvent.setup();
    renderSidebar({ withTrigger: true });

    expect(screen.queryByLabelText("Billing usage preview")).toBeNull();
    await interaction.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    expect(await screen.findByLabelText("Billing usage preview")).toBeTruthy();

    const profileTrigger = screen.getByRole("button", { name: "Ada Lovelace profile menu" });
    profileTrigger.focus();
    expect(document.activeElement).toBe(profileTrigger);
    await interaction.keyboard("{Enter}");
    expect(screen.getByRole("menuitem", { name: "Subscription" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Manage Billing" }).hasAttribute("data-disabled")).toBe(false);
    expect(screen.getByRole("menu").className).toContain("max-w-[calc(100vw-2rem)]");
  });

  it.each([
    ["thrown", () => shell.signOut.mockRejectedValueOnce(new Error("offline"))],
    ["resolved", () => shell.signOut.mockResolvedValueOnce({ data: null, error: { status: 500 } })],
  ])("retains the shell when sign-out returns a %s error", async (_kind, arrangeFailure) => {
    arrangeFailure();
    const interaction = userEvent.setup();
    const href = window.location.href;
    renderSidebar();

    await interaction.click(screen.getByRole("button", { name: "Ada Lovelace profile menu" }));
    await interaction.click(screen.getByRole("menuitem", { name: "Sign out" }));

    await waitFor(() => expect(shell.signOut).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("menuitem", { name: "Sign out" })).toBeTruthy();
    expect(window.location.href).toBe(href);
    await interaction.keyboard("{Escape}");
    const trigger = screen.getByRole("button", { name: "Ada Lovelace profile menu" });
    expect(document.activeElement).toBe(trigger);
  });

  it("renders deterministic menu skeleton widths", () => {
    const { container } = render(
      <>
        <SidebarMenuSkeleton showIcon />
        <SidebarMenuSkeleton showIcon />
        <SidebarMenuSkeleton />
      </>,
    );
    const widths = Array.from(container.querySelectorAll<HTMLElement>("[data-sidebar=menu-skeleton-text]"))
      .map((element) => element.style.getPropertyValue("--skeleton-width"));
    expect(widths).toEqual(["70%", "70%", "85%"]);
  });

  it("renders the finite admin navigation without changing customer membership", () => {
    shell.pathname = "/admin/api-usage";
    const { container } = render(
      <SidebarProvider defaultOpen={false} defaultWidth="20rem">
        <AppSidebar user={user} mode="admin" onOpenSettings={vi.fn()} />
      </SidebarProvider>,
    );

    expect(screen.getByRole("link", { name: "Admin API Keys" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Private API Usage" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Market Hours" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "API Keys" })).toBeNull();
    expect(document.querySelector("[data-state=collapsed]")).toBeTruthy();
    expect((container.firstElementChild as HTMLElement).style.getPropertyValue("--sidebar-width")).toBe("20rem");
  });
});
