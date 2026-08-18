// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { updateUser, changeEmail } = vi.hoisted(() => ({
  updateUser: vi.fn(),
  changeEmail: vi.fn(),
}));

vi.mock("@/lib/auth/client", () => ({
  authClient: { updateUser, changeEmail },
}));

import { ProfileSettings } from "../../components/settings-dialog/profile-settings";
import { SettingsDialog } from "../../components/settings-dialog/settings-dialog";

const user = { id: "user_1", name: "Ada", email: "old@example.com", image: null };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockImageObjectUrls() {
  const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
  const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  return { createObjectURL, revokeObjectURL };
}

function renderProfile(overrides: Partial<React.ComponentProps<typeof ProfileSettings>> = {}) {
  return render(
    <ProfileSettings
      user={user}
      emailChangeState={{ kind: "none" }}
      onRetryEmailChange={vi.fn(async () => undefined)}
      onRefreshUser={vi.fn(async () => user)}
      {...overrides}
    />,
  );
}

describe("Profile settings lifecycle", () => {
  it("refreshes the authoritative profile whenever the footer modal opens", async () => {
    const onRefreshUser = vi.fn(async () => user);
    const props = {
      section: "profile" as const,
      onOpenChange: vi.fn(),
      user,
      emailChangeState: { kind: "none" as const },
      onRetryEmailChange: vi.fn(async () => undefined),
      onRefreshUser,
    };
    const view = render(<SettingsDialog {...props} open={false} />);

    expect(onRefreshUser).not.toHaveBeenCalled();
    view.rerender(<SettingsDialog {...props} open />);
    await waitFor(() => expect(onRefreshUser).toHaveBeenCalledOnce());

    view.rerender(<SettingsDialog {...props} open={false} />);
    view.rerender(<SettingsDialog {...props} open />);
    await waitFor(() => expect(onRefreshUser).toHaveBeenCalledTimes(2));
  });

  it("publishes a same-email authoritative name refresh into a pristine open form", async () => {
    const refreshedUser = { ...user, name: "Ada Lovelace" };
    const onRefreshUser = vi.fn(async () => refreshedUser);
    const shared = {
      section: "profile" as const,
      onOpenChange: vi.fn(),
      emailChangeState: { kind: "none" as const },
      onRetryEmailChange: vi.fn(async () => undefined),
      onRefreshUser,
    };
    const view = render(<SettingsDialog {...shared} open={false} user={user} />);

    view.rerender(<SettingsDialog {...shared} open user={user} />);
    await waitFor(() => expect(onRefreshUser).toHaveBeenCalledOnce());
    view.rerender(<SettingsDialog {...shared} open user={refreshedUser} />);

    await waitFor(() => expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Ada Lovelace"));
    expect((screen.getByRole("button", { name: "Save name" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("preserves a dirty name draft while advancing its authoritative baseline", async () => {
    const interaction = userEvent.setup();
    const refreshedUser = { ...user, name: "Remote name" };
    const onRefreshUser = vi.fn(async () => user);
    const shared = {
      emailChangeState: { kind: "none" as const },
      onRetryEmailChange: vi.fn(async () => undefined),
      onRefreshUser,
    };
    const view = render(<ProfileSettings {...shared} user={user} />);
    const nameInput = screen.getByLabelText("Name");

    await interaction.clear(nameInput);
    await interaction.type(nameInput, "Local draft");
    view.rerender(<ProfileSettings {...shared} user={refreshedUser} />);

    await waitFor(() => expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Local draft"));
    expect((screen.getByRole("button", { name: "Save name" }) as HTMLButtonElement).disabled).toBe(false);
    await interaction.clear(screen.getByLabelText("Name"));
    await interaction.type(screen.getByLabelText("Name"), "Remote name");
    expect((screen.getByRole("button", { name: "Save name" }) as HTMLButtonElement).disabled).toBe(true);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("uploads a selected picture and publishes it only after session refresh", async () => {
    mockImageObjectUrls();
    const image = "/api/files/serve/profile-pictures/user_1/avatar.png";
    const fetchMock = vi.fn(async () => Response.json({ image }));
    vi.stubGlobal("fetch", fetchMock);
    const onRefreshUser = vi.fn(async () => ({ ...user, image }));
    const interaction = userEvent.setup();
    const { container } = renderProfile({ onRefreshUser });
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await interaction.upload(fileInput, new File(["image"], "avatar.png", { type: "image/png" }));
    await interaction.click(screen.getByRole("button", { name: "Upload picture" }));

    await waitFor(() => expect(onRefreshUser).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe("/api/account/profile/image");
    expect(await screen.findByText("Your profile picture was updated.")).toBeTruthy();
  });

  it("retries only session refresh after an accepted picture mutation", async () => {
    mockImageObjectUrls();
    const image = "/api/files/serve/profile-pictures/user_1/avatar.png";
    const fetchMock = vi.fn(async () => Response.json({ image }));
    vi.stubGlobal("fetch", fetchMock);
    const onRefreshUser = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...user, image });
    const interaction = userEvent.setup();
    const { container } = renderProfile({ onRefreshUser });
    await interaction.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      new File(["image"], "avatar.png", { type: "image/png" }),
    );
    await interaction.click(screen.getByRole("button", { name: "Upload picture" }));
    await interaction.click(await screen.findByRole("button", { name: "Retry account refresh" }));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(onRefreshUser).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("Your profile picture was updated.")).toBeTruthy();
  });

  it("rolls a rejected picture response back to the authoritative image without refreshing", async () => {
    const { revokeObjectURL } = mockImageObjectUrls();
    const authoritativeImage = "/api/files/serve/profile-pictures/user_1/current.png";
    const currentUser = { ...user, image: authoritativeImage };
    const fetchMock = vi.fn(async () => Response.json({ error: "rejected" }, { status: 422 }));
    vi.stubGlobal("fetch", fetchMock);
    const onRefreshUser = vi.fn(async () => currentUser);
    const interaction = userEvent.setup();
    const { container } = renderProfile({ user: currentUser, onRefreshUser });
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

    await interaction.upload(fileInput, new File(["image"], "replacement.png", { type: "image/png" }));
    expect(screen.getByText("Ready to upload: replacement.png")).toBeTruthy();
    await interaction.click(screen.getByRole("button", { name: "Replace picture" }));

    expect(await screen.findByText("Unable to upload that profile picture. Try again.")).toBeTruthy();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview");
    expect(fileInput.value).toBe("");
    expect(fileInput.files).toHaveLength(0);
    expect(screen.queryByText(/Ready to upload:/)).toBeNull();
    expect(screen.getByRole("button", { name: "Choose picture" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry account refresh" })).toBeNull();
    expect(onRefreshUser).not.toHaveBeenCalled();
  });

  it("rolls a picture network error back to the authoritative image without refreshing", async () => {
    const { revokeObjectURL } = mockImageObjectUrls();
    const currentUser = { ...user, image: "/api/files/serve/profile-pictures/user_1/current.png" };
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network unavailable"); }));
    const onRefreshUser = vi.fn(async () => currentUser);
    const interaction = userEvent.setup();
    const { container } = renderProfile({ user: currentUser, onRefreshUser });
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

    await interaction.upload(fileInput, new File(["image"], "replacement.jpg", { type: "image/jpeg" }));
    await interaction.click(screen.getByRole("button", { name: "Replace picture" }));

    expect(await screen.findByText("Unable to upload that profile picture. Try again.")).toBeTruthy();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview");
    expect(fileInput.value).toBe("");
    expect(fileInput.files).toHaveLength(0);
    expect(screen.queryByText(/Ready to upload:/)).toBeNull();
    expect(screen.getByRole("button", { name: "Choose picture" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry account refresh" })).toBeNull();
    expect(onRefreshUser).not.toHaveBeenCalled();
  });

  it("keeps the finite Market profile contract in Studio focus order", async () => {
    renderProfile();

    expect(screen.getByText("Profile details")).toBeTruthy();
    expect(screen.getByText("old@example.com")).toBeTruthy();
    expect(screen.queryByText(/delete account/i)).toBeNull();
    expect(screen.getByText("Profile picture")).toBeTruthy();
    expect(screen.queryByText(/workspace|organization|team/i)).toBeNull();

    expect(screen.getByRole("button", { name: "Choose a profile picture" })).toBeTruthy();
    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(screen.getByLabelText("New email")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset password" })).toBeTruthy();
  });

  it("publishes a name only after an authoritative same-user refresh", async () => {
    const interaction = userEvent.setup();
    const onRefreshUser = vi.fn(async () => ({ ...user, name: "Ada Lovelace" }));
    updateUser.mockResolvedValue({ data: { status: true }, error: null });
    renderProfile({ onRefreshUser });

    const name = screen.getByLabelText("Name");
    await interaction.clear(name);
    await interaction.type(name, "Ada Lovelace");
    await interaction.click(screen.getByRole("button", { name: "Save name" }));

    expect(updateUser).toHaveBeenCalledWith({ name: "Ada Lovelace" });
    await waitFor(() => expect(onRefreshUser).toHaveBeenCalledOnce());
    expect(await screen.findByText("Your name was updated.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save name" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps an accepted name refresh retryable without submitting the mutation twice", async () => {
    const interaction = userEvent.setup();
    const onRefreshUser = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...user, name: "Ada Lovelace" });
    updateUser.mockResolvedValue({ data: { status: true }, error: null });
    renderProfile({ onRefreshUser });

    const name = screen.getByLabelText("Name");
    await interaction.clear(name);
    await interaction.type(name, "Ada Lovelace");
    await interaction.click(screen.getByRole("button", { name: "Save name" }));

    const retry = await screen.findByRole("button", { name: /Retry account refresh/i });
    expect(screen.getByText(/update was accepted/i)).toBeTruthy();
    await interaction.click(retry);

    expect(await screen.findByText("Your name was updated.")).toBeTruthy();
    expect(updateUser).toHaveBeenCalledOnce();
    expect(onRefreshUser).toHaveBeenCalledTimes(2);
  });

  it("uses finite invalid, duplicate, pending, and sent delivery states", async () => {
    const interaction = userEvent.setup();
    changeEmail
      .mockResolvedValueOnce({ data: null, error: { status: 422, message: "Email already exists" } })
      .mockResolvedValueOnce({ data: { status: true }, error: null });
    renderProfile();

    const email = screen.getByLabelText("New email");
    await interaction.clear(email);
    await interaction.type(email, "not-an-email");
    await interaction.click(screen.getByRole("button", { name: "Verify new email" }));
    expect(screen.getByText("Enter a different valid email address.")).toBeTruthy();
    expect(changeEmail).not.toHaveBeenCalled();

    await interaction.clear(email);
    await interaction.type(email, "taken@example.com");
    await interaction.click(screen.getByRole("button", { name: "Verify new email" }));
    expect(await screen.findByText("That email address already belongs to an account.")).toBeTruthy();

    await interaction.clear(email);
    await interaction.type(email, "new@example.com");
    await interaction.click(screen.getByRole("button", { name: "Verify new email" }));
    expect(await screen.findByText(/Verification sent to the new address/)).toBeTruthy();
    expect(changeEmail).toHaveBeenLastCalledWith({
      newEmail: "new@example.com",
      callbackURL: "http://localhost:3000/account/api-keys?emailChange=verified",
    });
  });

  it.each([
    [{ kind: "refreshing" } as const, /Refreshing your account email/i],
    [{ kind: "verified" } as const, /verified account email is now old@example.com/i],
    [{ kind: "expired" } as const, /verification link has expired/i],
    [{ kind: "unauthorized" } as const, /does not belong to this signed-in account/i],
    [{ kind: "invalid" } as const, /verification link is invalid/i],
  ])("renders the finite callback state %#", (emailChangeState, message) => {
    renderProfile({ emailChangeState });
    expect(screen.getByText(message)).toBeTruthy();
  });

  it("exposes retry only for an authoritative callback refresh failure", async () => {
    const interaction = userEvent.setup();
    const onRetryEmailChange = vi.fn(async () => undefined);
    renderProfile({ emailChangeState: { kind: "refresh-error" }, onRetryEmailChange });

    await interaction.click(screen.getByRole("button", { name: "Retry account refresh" }));
    expect(onRetryEmailChange).toHaveBeenCalledOnce();
  });
});
