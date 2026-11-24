// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ verify: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/auth/client", () => ({
  authClient: {
    signIn: { emailOtp: auth.verify },
    emailOtp: { sendVerificationOtp: auth.send },
  },
}));
vi.mock("@/app/fonts/soehne/soehne", () => ({ soehne: { className: "soehne" } }));

import VerifyForm from "../../app/(auth)/verify/verify-form";
import { beginEmailVerification } from "../../lib/auth/verification";

beforeEach(() => {
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => null),
  });
  sessionStorage.clear();
  auth.verify.mockReset();
  auth.send.mockReset();
});

afterEach(() => cleanup());

describe("email OTP verification", () => {
  it("shows finite recovery when transient verification state is absent", () => {
    render(<VerifyForm />);
    expect(screen.getByRole("link", { name: "Return to sign in" }).getAttribute("href")).toBe("/login");
  });

  it("submits one exact six-digit OTP and maps an invalid response", async () => {
    beginEmailVerification("ADA@EXAMPLE.COM");
    auth.verify.mockResolvedValue({ data: null, error: { code: "INVALID_OTP" } });
    const interaction = userEvent.setup();
    render(<VerifyForm />);

    const input = await screen.findByLabelText("Six-digit verification code");
    await interaction.type(input, "012345");
    await waitFor(() => expect(auth.verify).toHaveBeenCalledOnce());
    expect(auth.verify).toHaveBeenCalledWith({ email: "ada@example.com", otp: "012345" });
    expect(await screen.findByText("That code is invalid. Check it and try again.")).toBeTruthy();
  });

  it("resends only the literal sign-in OTP purpose", async () => {
    beginEmailVerification("ada@example.com");
    auth.send.mockResolvedValue({ data: { success: true }, error: null });
    const interaction = userEvent.setup();
    render(<VerifyForm />);
    await interaction.click(await screen.findByRole("button", { name: "Resend code" }));
    expect(auth.send).toHaveBeenCalledWith({ email: "ada@example.com", type: "sign-in" });
    expect(await screen.findByText(/Resend in 30s/)).toBeTruthy();
  });
});
