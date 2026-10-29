"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { AuthPageHeader } from "@/components/auth/auth-page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth/client";

const GENERIC_SUCCESS = "If an account exists for that email, a password reset link has been sent.";

export default function ForgotPasswordForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await authClient.requestPasswordReset({
        email: email.trim().toLowerCase(),
        redirectTo: `${window.location.origin}/reset-password`
      });
      if (result.error) {
        setError("The reset email could not be sent. Please try again.");
        return;
      }
      setSubmitted(true);
    } catch {
      setError("The reset email could not be sent. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <AuthPageHeader eyebrow="Account recovery" title="Reset your password" description="Enter the email attached to your Market account." />
      <form className="mt-8 space-y-8 font-sans" onSubmit={handleSubmit}>
        <div className="space-y-6">
          <div className="space-y-2"><Label htmlFor="reset-email">Email</Label><Input id="reset-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="rounded-md shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100" disabled={isSubmitting || submitted} required autoFocus /><p className="text-xs text-muted-foreground">For privacy, the response is the same for every address.</p></div>
          {submitted ? <Alert appearance="stroke" className="rounded-none border-0 p-0"><AlertDescription className="text-xs">{GENERIC_SUCCESS}</AlertDescription></Alert> : null}
          {error ? <Alert variant="destructive" appearance="stroke" className="rounded-none border-0 p-0 text-red-400"><AlertDescription className="text-xs">{error}</AlertDescription></Alert> : null}
        </div>
        <Button type="submit" className="w-full rounded-md border border-transparent bg-primary text-[15px] font-medium text-primary-foreground transition-all duration-200" disabled={isSubmitting || submitted} aria-busy={isSubmitting}>{isSubmitting ? "Sending…" : submitted ? "Email requested" : "Send reset link"}</Button>
      </form>
      <p className="pt-6 text-center font-sans text-[14px] font-light"><Link className="font-medium text-primary underline-offset-4 transition hover:text-primary-hover hover:underline" href="/login">Back to sign in</Link></p>
    </>
  );
}
