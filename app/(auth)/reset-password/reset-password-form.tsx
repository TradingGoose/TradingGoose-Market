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
    <>
      <AuthPageHeader eyebrow="Account recovery" title="Choose a new password" description="A reset link can be used only once." />
      {invalidToken ? (
        <div className="mt-8 space-y-8 font-sans"><Alert variant="destructive" appearance="stroke" className="rounded-none border-0 p-0 text-red-400"><AlertDescription className="text-xs">{tokenMessage}</AlertDescription></Alert><Button asChild className="w-full rounded-md border border-transparent text-[15px] font-medium transition-all duration-200"><Link href="/forgot-password">Request another link</Link></Button></div>
      ) : (
        <form className="mt-8 space-y-8 font-sans" onSubmit={handleSubmit}>
          <div className="space-y-6">
            <div className="space-y-2"><Label htmlFor="new-password">New password</Label><PasswordField id="new-password" value={password} onChange={setPassword} autoComplete="new-password" disabled={isSubmitting || complete} /></div>
            <div className="space-y-2"><Label htmlFor="confirm-password">Confirm password</Label><PasswordField id="confirm-password" value={confirmation} onChange={setConfirmation} autoComplete="new-password" disabled={isSubmitting || complete} /></div>
            {status ? <Alert variant={status.kind === "error" ? "destructive" : "success"} appearance="stroke" className="rounded-none border-0 p-0"><AlertDescription className="text-xs">{status.message}</AlertDescription></Alert> : null}
          </div>
          {complete ? <Button asChild className="w-full rounded-md border border-transparent text-[15px] font-medium transition-all duration-200"><Link href="/login">Continue to sign in</Link></Button> : <Button type="submit" className="w-full rounded-md border border-transparent bg-primary text-[15px] font-medium text-primary-foreground transition-all duration-200" disabled={isSubmitting} aria-busy={isSubmitting}>{isSubmitting ? "Resetting…" : "Reset password"}</Button>}
        </form>
      )}
    </>
  );
}
