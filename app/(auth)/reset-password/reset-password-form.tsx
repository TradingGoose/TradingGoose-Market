"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { AuthPageHeader } from "@/components/auth/auth-page-header";
import { PasswordField } from "@/components/auth/password-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth/client";

export default function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const callbackError = searchParams.get("error");
  const invalidToken = !token || callbackError !== null;
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState<{ kind: "error" | "success"; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const complete = status?.kind === "success";
  const tokenMessage = useMemo(() => callbackError ? "This reset link is invalid or has expired." : "This reset link is missing its one-time token.", [callbackError]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || isSubmitting) return;
    if (password.length < 8) {
      setStatus({ kind: "error", message: "Use at least 8 characters for your password." });
      return;
    }
    if (password !== confirmation) {
      setStatus({ kind: "error", message: "The passwords do not match." });
      return;
    }
    setStatus(null);
    setIsSubmitting(true);
    try {
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (result.error) {
        setStatus({ kind: "error", message: "This reset link is invalid or has expired." });
        return;
      }
      setStatus({ kind: "success", message: "Your password has been reset. You can now sign in." });
    } catch {
      setStatus({ kind: "error", message: "Unable to reset your password. Please request a new link." });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <AuthPageHeader eyebrow="Account recovery" title="Choose a new password" description="A reset link can be used only once." />
      {invalidToken ? (
        <div className="space-y-6"><Alert variant="destructive"><AlertDescription>{tokenMessage}</AlertDescription></Alert><Button asChild className="w-full"><Link href="/forgot-password">Request another link</Link></Button></div>
      ) : (
        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-2"><Label htmlFor="new-password">New password</Label><PasswordField id="new-password" value={password} onChange={setPassword} autoComplete="new-password" disabled={isSubmitting || complete} /></div>
          <div className="space-y-2"><Label htmlFor="confirm-password">Confirm password</Label><PasswordField id="confirm-password" value={confirmation} onChange={setConfirmation} autoComplete="new-password" disabled={isSubmitting || complete} /></div>
          {status ? <Alert variant={status.kind === "error" ? "destructive" : "success"}><AlertDescription>{status.message}</AlertDescription></Alert> : null}
          {complete ? <Button asChild className="w-full"><Link href="/login">Continue to sign in</Link></Button> : <Button type="submit" className="w-full" disabled={isSubmitting}>{isSubmitting ? "Resetting…" : "Reset password"}</Button>}
        </form>
      )}
    </div>
  );
}
