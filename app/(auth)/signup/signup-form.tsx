"use client";

import { useState } from "react";
import Link from "next/link";

import { AuthPageHeader } from "@/components/auth/auth-page-header";
import { PasswordField } from "@/components/auth/password-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth/client";
import { beginEmailVerification, clearEmailVerification, markVerificationCodeSent } from "@/lib/auth/verification";

export default function SignupForm({ emailVerificationEnabled }: { emailVerificationEnabled: boolean }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter your name.");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const result = await authClient.signUp.email({ name: trimmedName, email: normalizedEmail, password });
      if (result.error) {
        setError(result.error.message ?? "Unable to create your account.");
        return;
      }
      if (!emailVerificationEnabled) {
        clearEmailVerification();
        window.location.assign("/account/api-keys");
        return;
      }
      beginEmailVerification(normalizedEmail);
      try {
        const otpResult = await authClient.emailOtp.sendVerificationOtp({
          email: normalizedEmail,
          type: "sign-in",
        });
        if (!otpResult.error) markVerificationCodeSent();
      } catch {
        // The verification screen retains the address and offers a retry.
      }
      window.location.assign("/verify");
    } catch {
      setError("Unable to create your account. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <AuthPageHeader eyebrow="TradingGoose Market" title="Create your account" description="Start with PAYG and mint Market API keys when you are ready." />
      <form className="mt-8 space-y-8 font-sans" onSubmit={handleSubmit} aria-busy={isSubmitting}>
        <div className="space-y-6">
          <div className="space-y-2"><Label htmlFor="name">Name</Label><Input id="name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" className="rounded-md shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100" disabled={isSubmitting} required autoFocus /></div>
          <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className="rounded-md shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100" disabled={isSubmitting} required /></div>
          <div className="space-y-2"><Label htmlFor="password">Password</Label><PasswordField id="password" value={password} onChange={setPassword} autoComplete="new-password" disabled={isSubmitting} /><p className="text-xs text-muted-foreground">Use at least 8 characters.</p></div>
          {error ? <Alert variant="destructive" appearance="stroke" className="rounded-none border-0 p-0 text-red-400"><AlertDescription className="text-xs">{error}</AlertDescription></Alert> : null}
        </div>
        <Button type="submit" className="w-full rounded-md border border-transparent bg-primary text-[15px] font-medium text-primary-foreground transition-all duration-200" disabled={isSubmitting}>{isSubmitting ? "Creating account…" : "Create account"}</Button>
      </form>
      <p className="pt-6 text-center font-sans text-[14px] font-light"><span className="font-normal">Already have an account? </span><Link className="font-medium text-primary underline-offset-4 transition hover:text-primary-hover hover:underline" href="/login">Sign in</Link></p>
    </>
  );
}
