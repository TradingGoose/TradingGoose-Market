// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ params: new URLSearchParams() }));
const auth = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  sendVerificationOtp: vi.fn(),
  signInEmailOtp: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => navigation.params,
}));
vi.mock("@/lib/auth/client", () => ({
  authClient: {
    signIn: { email: auth.signIn, emailOtp: auth.signInEmailOtp },
    signUp: { email: auth.signUp },
    emailOtp: { sendVerificationOtp: auth.sendVerificationOtp },
    requestPasswordReset: auth.requestPasswordReset,
    resetPassword: auth.resetPassword,
  },
}));
vi.mock("@/app/fonts/soehne/soehne", () => ({
  soehne: { className: "soehne" },
}));
vi.mock("@/app/(landing)/components/nav/landing-nav", () => ({
  LandingNav: () => <nav aria-label="Primary navigation">Market nav</nav>,
}));
vi.mock("@/components/auth/auth-background", () => ({
  AuthBackground: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="auth-background">{children}</div>
  ),
}));

import AuthLayout from "../../app/(auth)/layout";
import ForgotPasswordForm from "../../app/(auth)/forgot-password/forgot-password-form";
import LoginForm from "../../app/(auth)/login/login-form";
import ResetPasswordForm from "../../app/(auth)/reset-password/reset-password-form";
import SignupForm from "../../app/(auth)/signup/signup-form";

beforeEach(() => {
  navigation.params = new URLSearchParams();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Studio-shaped Market auth surface", () => {
  it("uses the full-page nav/background/canvas hierarchy without a divergent card", () => {
    const { container } = render(
      <AuthLayout>
        <p>Auth form</p>
      </AuthLayout>,
    );

    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeTruthy();
    expect(screen.getByTestId("auth-background")).toBeTruthy();
    expect(container.querySelector("main")?.className).toContain("min-h-screen");
    expect(screen.getByText("Auth form").parentElement?.className).toContain("max-w-lg");
    expect(container.querySelector(".rounded-lg.border.shadow-lg")).toBeNull();
  });

  it("renders registration-open and registration-closed login states", () => {
    const { rerender } = render(<LoginForm registrationOpen />);
    expect(screen.getByRole("link", { name: "Create an account" })).toBeTruthy();

    rerender(<LoginForm registrationOpen={false} />);
    expect(screen.queryByRole("link", { name: "Create an account" })).toBeNull();
    expect(screen.getByText("Public registration is currently closed.")).toBeTruthy();
  });

  it("normalizes login identity and keeps provider failure finite", async () => {
    const interaction = userEvent.setup();
    auth.signIn.mockResolvedValue({ data: null, error: { message: "no" } });
    render(<LoginForm registrationOpen />);

    await interaction.type(screen.getByLabelText("Email"), " ADA@EXAMPLE.COM ");
    await interaction.type(screen.getByLabelText("Password"), "not-the-password");
    await interaction.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("The email or password is incorrect.")).toBeTruthy();
    expect(auth.signIn).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: "not-the-password",
    });
  });

  it("validates signup locally and renders a bounded provider error", async () => {
    const interaction = userEvent.setup();
    auth.signUp.mockResolvedValue({
      data: null,
      error: { message: "That account cannot be created." },
    });
    render(<SignupForm />);

    await interaction.type(screen.getByLabelText("Name"), "Ada");
    await interaction.type(screen.getByLabelText("Email"), "ada@example.com");
    await interaction.type(screen.getByLabelText("Password"), "short");
    await interaction.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText("Use at least 8 characters for your password.")).toBeTruthy();
    expect(auth.signUp).not.toHaveBeenCalled();

    await interaction.type(screen.getByLabelText("Password"), "-enough");
    await interaction.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("That account cannot be created.")).toBeTruthy();
  });

  it("keeps provider failure retryable while preserving missing-account privacy", async () => {
    const interaction = userEvent.setup();
    navigation.params = new URLSearchParams("email=ada%40example.com");
    auth.requestPasswordReset.mockRejectedValue(new Error("provider unavailable"));
    render(<ForgotPasswordForm />);

    await interaction.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByText("The reset email could not be sent. Please try again.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Send reset link" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("gives callback errors precedence and completes one valid reset", async () => {
    navigation.params = new URLSearchParams("token=token_1&error=token_expired");
    const { rerender } = render(<ResetPasswordForm />);
    expect(screen.getByText("This reset link is invalid or has expired.")).toBeTruthy();
    expect(auth.resetPassword).not.toHaveBeenCalled();

    navigation.params = new URLSearchParams("token=token_2");
    rerender(<ResetPasswordForm />);
    const interaction = userEvent.setup();
    await interaction.type(screen.getByLabelText("New password"), "long-password");
    await interaction.type(screen.getByLabelText("Confirm password"), "long-password");
    auth.resetPassword.mockResolvedValue({ data: { status: true }, error: null });
    await interaction.click(screen.getByRole("button", { name: "Reset password" }));

    await waitFor(() => {
      expect(screen.getByText("Your password has been reset. You can now sign in.")).toBeTruthy();
    });
    expect(auth.resetPassword).toHaveBeenCalledWith({
      newPassword: "long-password",
      token: "token_2",
    });
  });
});
