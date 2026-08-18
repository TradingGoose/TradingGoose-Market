"use client";

import { useState } from "react";
import { ArrowUpRight, CreditCard, Gauge, Loader2, ReceiptText } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { marketApiRequest, useMarketResource } from "@/hooks/use-market-resource";
import type { BillingSummary } from "@/lib/account/contracts";
import { formatCount, formatUsd } from "@/lib/account/format";

export function SubscriptionSettings({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { data, error, isLoading, refresh } = useMarketResource<BillingSummary>("/api/account/billing");
  const [pending, setPending] = useState<"activate" | "portal" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function activate() {
    setPending("activate");
    setActionError(null);
    try {
      await marketApiRequest("/api/account/billing/payg/activate", { method: "POST", body: "{}" });
      await refresh();
    } catch {
      setActionError("PAYG could not be activated. If billing is already bound, use Manage Billing for payment recovery.");
    } finally {
      setPending(null);
    }
  }

  async function openPortal() {
    setPending("portal");
    setActionError(null);
    try {
      const result = await marketApiRequest<{ url: string }>("/api/account/billing/portal", { method: "POST", body: "{}" });
      onOpenChange(false);
      window.location.assign(result.url);
    } catch {
      setActionError("The billing portal is unavailable right now.");
      setPending(null);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading subscription">
        <Card className="rounded-md bg-background shadow-xs">
          <CardContent className="p-3">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-16 rounded-sm" />
            </div>
            <Skeleton className="mt-3 h-4 w-2/3" />
          </CardContent>
        </Card>
        <div className="grid gap-2 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Card key={index} className="rounded-md shadow-none">
              <CardContent className="p-4">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-3 h-6 w-28" />
              </CardContent>
            </Card>
          ))}
        </div>
        <span className="sr-only">Loading subscription information…</span>
      </div>
    );
  }
  if (error || !data) {
    return (
      <Alert variant="destructive" appearance="light">
        <AlertDescription>
          <span className="font-medium">Subscription information is unavailable.</span>{" "}
          Try reopening this panel. Your keys and recorded usage are unchanged.
        </AlertDescription>
      </Alert>
    );
  }

  if (!data.billingEnabled) {
    return (
      <div className="space-y-3">
        <Alert variant="info" appearance="light">
          <AlertDescription>
            <span className="font-medium">Billing is disabled for this Market deployment.</span>{" "}
            API keys and non-billable usage remain available.
          </AlertDescription>
        </Alert>
        <Card className="rounded-md shadow-none">
          <CardHeader className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <CardTitle className="text-sm font-semibold">PAYG</CardTitle>
                <CardDescription>Billing actions will appear here when this deployment enables billing.</CardDescription>
              </div>
              <Badge variant="secondary">Unavailable</Badge>
            </div>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const normalizedStatus = data.status?.replaceAll("_", " ") ?? "inactive";
  const hasBillingAction = data.activationAvailable || data.portalAvailable;

  return (
    <div className="flex flex-col gap-3" aria-busy={pending !== null}>
      <Card className="rounded-md shadow-xs">
        <CardHeader className="p-4 pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-base font-semibold">PAYG</CardTitle>
              <CardDescription>One uniform rate for all billable customer-key public reads.</CardDescription>
            </div>
            <Badge variant={data.status === "active" ? "default" : "secondary"} className="shrink-0 capitalize">
              {normalizedStatus}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid border-t sm:grid-cols-3">
            <div className="space-y-1 p-4 sm:border-r">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                <ReceiptText className="size-3.5" aria-hidden="true" />Rate
              </div>
              <p className="font-medium">${data.rateUsdPer1000Reads} / 1,000 reads</p>
            </div>
            <div className="space-y-1 border-t p-4 sm:border-r sm:border-t-0">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                <Gauge className="size-3.5" aria-hidden="true" />Current requests
              </div>
              <p className="font-medium tabular-nums">{formatCount(data.currentPeriodRequestQuantity)}</p>
            </div>
            <div className="space-y-1 border-t p-4 sm:border-t-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Accrued usage</p>
              <p className="font-medium tabular-nums">{formatUsd(data.currentPeriodCostUsd)}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      {data.customerRecoveryState === "settlement_pending" ? <Alert variant="warning" appearance="light"><AlertDescription>The prior billing Customer remains locked until subscription settlement completes. Activation and Billing stay unavailable until Stripe retries the final settlement event.</AlertDescription></Alert> : null}
      {data.customerRecoveryState === "unavailable" ? <Alert variant="destructive"><AlertDescription>Billing Customer recovery is temporarily unavailable. Your existing Market usage and keys are unchanged.</AlertDescription></Alert> : null}
      {data.cancelAtPeriodEnd ? <Alert variant="warning" appearance="light"><AlertDescription>Your subscription is scheduled to cancel at period end. Restore it through Manage Billing while it remains active.</AlertDescription></Alert> : null}
      {actionError ? <Alert variant="destructive"><AlertDescription>{actionError}</AlertDescription></Alert> : null}
      <Card className="rounded-md shadow-none">
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {data.cancelAtPeriodEnd ? "Cancellation scheduled" : data.status === "active" ? "Subscription active" : "Activate usage billing"}
            </p>
            <p className="max-w-xl text-xs text-muted-foreground">
              Stripe Customer Portal is the sole place to view invoices, payments, payment methods, cancellation, and restoration.
            </p>
          </div>
          {hasBillingAction ? (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              {data.activationAvailable ? (
                <Button className="w-full sm:w-auto" onClick={activate} disabled={pending !== null}>
                  {pending === "activate" ? <><Loader2 className="animate-spin" />Activating…</> : "Activate PAYG"}
                </Button>
              ) : null}
              {data.portalAvailable ? (
                <Button className="w-full sm:w-auto" variant="outline" onClick={openPortal} disabled={pending !== null}>
                  {pending === "portal" ? <><Loader2 className="animate-spin" />Opening…</> : <><CreditCard />Manage Billing<ArrowUpRight /></>}
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No billing action is currently available.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
