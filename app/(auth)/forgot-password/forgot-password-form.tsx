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
    <div className="space-y-8">
      <AuthPageHeader eyebrow="Account recovery" title="Reset your password" description="Enter the email attached to your Market account." />
      <form className="space-y-6" onSubmit={handleSubmit}>
        <div className="space-y-2"><Label htmlFor="reset-email">Email</Label><Input id="reset-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={isSubmitting || submitted} required autoFocus /><p className="text-xs text-muted-foreground">For privacy, the response is the same for every address.</p></div>
        {submitted ? <Alert><AlertDescription>{GENERIC_SUCCESS}</AlertDescription></Alert> : null}
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
        <Button type="submit" className="w-full" disabled={isSubmitting || submitted}>{isSubmitting ? "Sending…" : submitted ? "Email requested" : "Send reset link"}</Button>
      </form>
      <p className="text-center text-sm text-muted-foreground"><Link className="font-medium text-foreground hover:underline" href="/login">Back to sign in</Link></p>
    </div>
  );
}
