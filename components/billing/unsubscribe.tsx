"use client";

import { useEffect, useState } from "react";
import { CheckCircle, LoaderCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const endpoint = "/api/billing/notifications/unsubscribe";
type Preferences = { unsubscribeAll?: boolean; unsubscribeNotifications?: boolean };

export function Unsubscribe({ email, token }: { email: string; token: string }) {
  const [preferences, setPreferences] = useState<Preferences>();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"all" | "notifications" | null>(null);
  const [success, setSuccess] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${endpoint}?${new URLSearchParams({ email, token })}`, { headers: { accept: "application/json" }, signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!controller.signal.aborted) setPreferences(data.currentPreferences);
      }).catch(() => { if (!controller.signal.aborted) setError("Invalid Unsubscribe Link"); });
    return () => controller.abort();
  }, [email, token]);

  async function unsubscribe(type: "all" | "notifications") {
    if (pending) return;
    setPending(type);
    setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, token, type }) });
      if (!response.ok) throw new Error();
      setSuccess(true);
    } catch { setError("Failed to process unsubscribe request"); }
    finally { setPending(null); }
  }
  return <main className="flex min-h-screen items-center justify-center bg-background p-4">
    <Card className="w-full max-w-md text-center">
      {error && !preferences ? <CardHeader role="alert"><XCircle className="mx-auto text-destructive" /><CardTitle>{error}</CardTitle></CardHeader>
        : success ? <CardHeader role="status"><CheckCircle className="mx-auto text-green-600" /><CardTitle>Successfully Unsubscribed</CardTitle></CardHeader>
        : !preferences ? <CardContent role="status" className="p-8"><LoaderCircle aria-hidden="true" className="mx-auto animate-spin" /><span className="sr-only">Loading email preferences...</span></CardContent>
        : <><CardHeader><CardTitle>We&apos;re sorry to see you go!</CardTitle>
          <p>Choose which emails you&apos;d like to stop receiving from TradingGoose.</p></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p>{email}</p>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button disabled={pending !== null || preferences.unsubscribeAll} aria-busy={pending === "all"} onClick={() => unsubscribe("all")}>
              {pending === "all" && <LoaderCircle aria-hidden="true" className="animate-spin" />}
              {preferences.unsubscribeAll ? "Unsubscribed from All Emails" : "Unsubscribe from All Marketing Emails"}
            </Button>
            <Button variant="outline" disabled={pending !== null || preferences.unsubscribeAll || preferences.unsubscribeNotifications}
              aria-busy={pending === "notifications"} onClick={() => unsubscribe("notifications")}>
              {pending === "notifications" && <LoaderCircle aria-hidden="true" className="animate-spin" />}
              {preferences.unsubscribeNotifications || preferences.unsubscribeAll ? "Unsubscribed from Notifications" : "Unsubscribe from Notifications"}
            </Button>
          </CardContent></>}
    </Card>
  </main>;
}
