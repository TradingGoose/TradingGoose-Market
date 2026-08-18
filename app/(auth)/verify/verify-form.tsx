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
      <div className="space-y-8">
        <AuthPageHeader eyebrow="Email verification" title="Start from sign in" description="Your verification address is no longer available in this browser session." />
        <Button asChild className="w-full"><Link href="/login">Return to sign in</Link></Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <AuthPageHeader eyebrow="Email verification" title="Enter your code" description={<>We sent a six-digit code to <span className="font-medium text-foreground">{email}</span>.</>} />
      <div className="space-y-6">
        <div className="flex justify-center">
          <InputOTP
            maxLength={6}
            pattern={REGEXP_ONLY_DIGITS}
            value={otp}
            onChange={(value) => { setOtp(value); setError(null); }}
            onComplete={(value) => void verify(value)}
            disabled={busy}
            aria-label="Six-digit verification code"
          >
            <InputOTPGroup className="gap-2">
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <InputOTPSlot key={index} index={index} className="size-12 rounded-md border text-lg first:rounded-md first:border last:rounded-md" />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
        <Button className="w-full" disabled={busy || otp.length !== 6} onClick={() => void verify()}>
          {busy ? "Verifying…" : "Verify and sign in"}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Didn&apos;t receive it?{" "}
          <button type="button" className="font-medium text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-60" disabled={busy || seconds > 0} onClick={() => void resend()}>
            {seconds > 0 ? `Resend in ${seconds}s` : "Resend code"}
          </button>
        </p>
        <p className="text-center text-sm"><Link className="font-medium hover:underline" href="/login" onClick={clearEmailVerification}>Back to sign in</Link></p>
      </div>
    </div>
  );
}
