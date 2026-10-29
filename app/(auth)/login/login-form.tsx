"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { AuthPageHeader } from "@/components/auth/auth-page-header";
import { PasswordField } from "@/components/auth/password-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth/client";
import { beginEmailVerification, markVerificationCodeSent } from "@/lib/auth/verification";

function requiresEmailVerification(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  const value = `${String(candidate.code ?? "")} ${String(candidate.message ?? "")}`.toLowerCase();
  return value.includes("email_not_verified") || value.includes("email not verified");
}

function safeCallback(value: string | null): string {
  if (!value) return "/account/api-keys";
  let callback: URL;
  try {
    callback = new URL(value, "https://market.invalid");
  } catch {
    return "/account/api-keys";
  }
  if (callback.origin !== "https://market.invalid") return "/account/api-keys";
  const localPath = `${callback.pathname}${callback.search}${callback.hash}`;
  if (callback.pathname === "/admin" || callback.pathname.startsWith("/admin/")) return localPath;
  if (callback.pathname === "/account" || callback.pathname.startsWith("/account/")) return localPath;
  return "/account/api-keys";
}

export default function LoginForm({ registrationOpen }: { registrationOpen: boolean }) {
  const searchParams = useSearchParams();
  const callbackUrl = useMemo(() => safeCallback(searchParams.get("callbackUrl")), [searchParams]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const result = await authClient.signIn.email({ email: normalizedEmail, password });
      if (result.error) {
        if (requiresEmailVerification(result.error)) {
          beginEmailVerification(normalizedEmail, callbackUrl);
          try {
            const otpResult = await authClient.emailOtp.sendVerificationOtp({
              email: normalizedEmail,
              type: "sign-in",
            });
            if (!otpResult.error) markVerificationCodeSent();
          } catch {
            // The verification screen keeps resend recovery available.
          }
          window.location.assign("/verify");
          return;
        }
        setError("The email or password is incorrect.");
        return;
      }
      window.location.assign(callbackUrl);
    } catch {
      setError("Unable to sign in. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <AuthPageHeader eyebrow="TradingGoose Market" title="Welcome back" description="Sign in to manage API keys and inspect Market usage." />
      <form className="mt-8 space-y-8 font-sans" onSubmit={handleSubmit}>
        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className="rounded-md shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100" disabled={isSubmitting} required autoFocus />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="password">Password</Label>
              <Link href="/forgot-password" className="text-xs font-medium text-muted-foreground transition hover:text-foreground">Forgot password?</Link>
            </div>
            <PasswordField id="password" value={password} onChange={setPassword} autoComplete="current-password" disabled={isSubmitting} />
          </div>
          {error ? <Alert variant="destructive" appearance="stroke" className="rounded-none border-0 p-0 text-red-400"><AlertDescription className="text-xs">{error}</AlertDescription></Alert> : null}
        </div>
        <Button type="submit" className="w-full rounded-md border border-transparent bg-primary text-[15px] font-medium text-primary-foreground transition-all duration-200" disabled={isSubmitting} aria-busy={isSubmitting}>{isSubmitting ? "Signing in…" : "Sign in"}</Button>
      </form>
      <p className="pt-6 text-center font-sans text-[14px] font-light">
        {registrationOpen ? <><span className="font-normal">New to Market? </span><Link className="font-medium text-primary underline-offset-4 transition hover:text-primary-hover hover:underline" href="/signup">Create an account</Link></> : "Public registration is currently closed."}
      </p>
    </>
  );
}
