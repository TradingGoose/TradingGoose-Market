"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { REGEXP_ONLY_DIGITS } from "input-otp";

import { AuthPageHeader } from "@/components/auth/auth-page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { authClient } from "@/lib/auth/client";
import {
  clearEmailVerification,
  markVerificationCodeSent,
  readEmailVerification,
} from "@/lib/auth/verification";

const RESEND_SECONDS = 30;

function verificationError(error: unknown): string {
  if (!error || typeof error !== "object") return "That code could not be verified. Try again.";
  const candidate = error as { code?: unknown; message?: unknown };
  const value = `${String(candidate.code ?? "")} ${String(candidate.message ?? "")}`.toLowerCase();
  if (value.includes("expired")) return "That code has expired. Request a new code.";
  if (value.includes("too_many") || value.includes("too many")) return "Too many attempts. Request a new code.";
  if (value.includes("invalid")) return "That code is invalid. Check it and try again.";
  return "That code could not be verified. Try again.";
}

export default function VerifyForm() {
  const [{ email, redirectTo }, setVerification] = useState({ email: "", redirectTo: "/account/api-keys", sentAt: 0 });
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const submittedCode = useRef<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      const stored = readEmailVerification();
      setVerification(stored);
      setSeconds(stored.sentAt
        ? Math.max(0, RESEND_SECONDS - Math.floor((Date.now() - stored.sentAt) / 1000))
        : 0);
    });
  }, []);
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setTimeout(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [seconds]);

  async function verify(code = otp) {
    if (!email || !/^\d{6}$/.test(code) || busy || submittedCode.current === code) return;
    submittedCode.current = code;
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.signIn.emailOtp({ email, otp: code });
      if (result.error) {
        setError(verificationError(result.error));
        setOtp("");
        submittedCode.current = null;
        return;
      }
      clearEmailVerification();
      window.location.assign(redirectTo);
    } catch (caught) {
      setError(verificationError(caught));
      setOtp("");
      submittedCode.current = null;
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!email || busy || seconds > 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
      if (result.error) {
        setError("A new code could not be sent. Please try again.");
        return;
      }
      markVerificationCodeSent();
      const stored = readEmailVerification();
      setVerification(stored);
      setSeconds(RESEND_SECONDS);
      submittedCode.current = null;
    } catch {
      setError("A new code could not be sent. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!email) {
    return (
      <>
        <AuthPageHeader eyebrow="Email verification" title="Start from sign in" description="Your verification address is no longer available in this browser session." />
        <Button asChild className="mt-8 w-full rounded-md border border-transparent text-[15px] font-medium transition-all duration-200"><Link href="/login">Return to sign in</Link></Button>
      </>
    );
  }

  return (
    <>
      <AuthPageHeader eyebrow="Email verification" title="Enter your code" description={<>We sent a six-digit code to <span className="font-medium text-foreground">{email}</span>.</>} />
      <div className="mt-8 space-y-8 font-sans">
        <div className="flex justify-center">
          <InputOTP
            maxLength={6}
            pattern={REGEXP_ONLY_DIGITS}
            value={otp}
            onChange={(value) => { setOtp(value); setError(null); }}
            onComplete={(value) => void verify(value)}
            disabled={busy}
            aria-label="Six-digit verification code"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "verification-code-error" : undefined}
          >
            <InputOTPGroup className="gap-2 [&>div]:!rounded-md">
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <InputOTPSlot key={index} index={index} className="!rounded-md size-12 border border-gray-300 text-center text-lg font-medium shadow-sm transition-all duration-200 hover:border-gray-400 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-100 first:border" />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>
        {error ? <Alert id="verification-code-error" variant="destructive" appearance="stroke" className="rounded-none border-0 p-0 text-center text-red-400"><AlertDescription className="text-xs">{error}</AlertDescription></Alert> : null}
        <Button className="w-full rounded-md border border-transparent bg-primary text-[15px] font-medium text-primary-foreground transition-all duration-200" disabled={busy || otp.length !== 6} onClick={() => void verify()} aria-busy={busy}>
          {busy ? "Verifying…" : "Verify and sign in"}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Didn&apos;t receive it?{" "}
          <button type="button" className="font-medium text-primary underline-offset-4 transition hover:text-primary-hover hover:underline disabled:cursor-not-allowed disabled:opacity-60" disabled={busy || seconds > 0} onClick={() => void resend()}>
            {seconds > 0 ? `Resend in ${seconds}s` : "Resend code"}
          </button>
        </p>
        <p className="text-center text-[14px] font-light"><Link className="font-medium text-primary underline-offset-4 transition hover:text-primary-hover hover:underline" href="/login" onClick={clearEmailVerification}>Back to sign in</Link></p>
      </div>
    </>
  );
}
