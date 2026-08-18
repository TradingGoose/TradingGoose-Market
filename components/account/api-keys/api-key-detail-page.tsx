"use client";

import { useState } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, FileClock, Info, Loader2, ShieldAlert, Trash2 } from "lucide-react";

import { AccountPageHeader } from "@/components/account/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { MarketApiError, marketApiRequest, useMarketResource } from "@/hooks/use-market-resource";
import type {
  ApiKeyRevocationOutcome,
  MarketApiKeyDetail,
} from "@/lib/account/contracts";
import { formatCount, formatUsd, formatUtc } from "@/lib/account/format";

function Stat({ label, value, description }: { label: string; value: string; description?: string }) {
  return <Card className="rounded-md shadow-none"><CardContent className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 text-lg font-semibold tabular-nums">{value}</p>{description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}</CardContent></Card>;
}

function decimalUsdExceedsWholeDollar(value: string, wholeDollars: string): boolean {
  if (!/^\d+(?:\.\d+)?$/.test(value) || !/^\d+$/.test(wholeDollars)) return false;
  const [integerPart, fractionalPart = ""] = value.split(".");
  const normalizedValue = integerPart.replace(/^0+(?=\d)/, "");
  const normalizedLimit = wholeDollars.replace(/^0+(?=\d)/, "");
  if (normalizedValue.length !== normalizedLimit.length) return normalizedValue.length > normalizedLimit.length;
  if (normalizedValue !== normalizedLimit) return normalizedValue > normalizedLimit;
  return /[1-9]/.test(fractionalPart);
}

export function ApiKeyDetailPage({ id }: { id: string }) {
  const resource = useMarketResource<{ key: MarketApiKeyDetail }>(`/api/account/api-keys/${encodeURIComponent(id)}`);
  const key = resource.data?.key ?? null;
  const [limitDraft, setLimitDraft] = useState<{
    limited: boolean;
    limitUsd: string;
    windowDays: string;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{
    kind: "success" | "warning" | "error";
    text: string;
  } | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const limited = limitDraft?.limited ?? Boolean(key && key.spendLimitUsd !== null);
  const limitUsd = limitDraft?.limitUsd ?? key?.spendLimitUsd ?? "";
  const windowDays = limitDraft?.windowDays ?? key?.spendWindowDays?.toString() ?? "";

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!key) return;
    let payload: { expectedRevision: number; limitUsd: string | null; windowDays: number | null };
    if (limited) {
      if (!/^[1-9]\d*$/.test(limitUsd)) { setMessage({ kind: "error", text: "Spend limit must be a positive whole-dollar integer." }); return; }
      if (!/^\d+$/.test(windowDays)) { setMessage({ kind: "error", text: "Window must be a whole number from 1 through 30." }); return; }
      const days = Number(windowDays);
      if (!Number.isSafeInteger(days) || days < 1 || days > 30) { setMessage({ kind: "error", text: "Window must be from 1 through 30 days." }); return; }
      payload = { expectedRevision: key.spendLimitRevision, limitUsd, windowDays: days };
    } else {
      payload = { expectedRevision: key.spendLimitRevision, limitUsd: null, windowDays: null };
    }
    setPending(true); setMessage(null);
    try {
      await marketApiRequest(`/api/account/api-keys/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) });
      setMessage({ kind: "success", text: "Key limit updated. Existing usage was not reset; enforcement refreshes on the next enabled capped request." });
      await resource.refresh();
      setLimitDraft(null);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof MarketApiError && error.status === 409 ? "This key changed in another session. Reloaded the latest settings." : "Unable to update this key." });
      if (error instanceof MarketApiError && error.status === 409) await resource.refresh();
    } finally { setPending(false); }
  }

  async function revoke() {
    setPending(true);
    setMessage(null);
    try {
      const outcome = await marketApiRequest<ApiKeyRevocationOutcome>(
        `/api/account/api-keys/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      setMessage(
        outcome.status === "revoked"
          ? {
              kind: "success",
              text: "The API key is revoked. Its historical Activity and Logs remain available.",
            }
          : {
              kind: "warning",
              text: "Market is already denying this API key. Provider confirmation is pending; retrying revocation is safe.",
            },
      );
    } catch {
      setMessage({
        kind: "error",
        text: "The revocation attempt could not be completed. The refreshed detail shows Market's current revocation workflow state.",
      });
    } finally {
      setRevokeOpen(false);
      await resource.refresh();
      setPending(false);
    }
  }

  if (resource.isLoading) return <div className="mx-auto max-w-6xl space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-36 w-full" /><Skeleton className="h-72 w-full" /></div>;
  if (resource.error || !key) return <div className="mx-auto max-w-6xl"><Alert variant="destructive"><AlertDescription>This API key could not be loaded. <Button variant="link" onClick={() => void resource.refresh()}>Retry</Button></AlertDescription></Alert></div>;

  const finite = key.spendLimitUsd !== null && key.spendWindowDays !== null;
  const enforcement = key.providerEnforcement;
  const loweringBelowUsage = limited && key.rollingBillableCostUsd !== null && decimalUsdExceedsWholeDollar(key.rollingBillableCostUsd, limitUsd);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink asChild><Link href="/account/api-keys">API Keys</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>{key.name}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>
      <AccountPageHeader title={key.name} description={`${key.displayValue} · Created ${formatUtc(key.createdAt)}`} actions={<><Button variant="outline" asChild><Link href={`/account/activity?key=${encodeURIComponent(key.id)}`}><Activity />Activity</Link></Button><Button variant="outline" asChild><Link href={`/account/logs?key=${encodeURIComponent(key.id)}`}><FileClock />Logs</Link></Button></>} />
      <div className="flex items-center gap-2"><Badge variant={key.status === "available" ? "default" : "secondary"}>{key.status.replace("_", " ")}</Badge><span className="text-xs text-muted-foreground">Last used {formatUtc(key.lastUsedAt)}</span></div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="All-time requests" value={formatCount(key.totalRequestCount)} />
        <Stat label="Window requests" value={finite && key.rollingWindowRequestCount !== null ? formatCount(key.rollingWindowRequestCount) : "N/A"} />
        <Stat label="Recorded usage" value={formatUsd(key.rollingBillableCostUsd)} description="Exact Market ledger" />
        <Stat label="Ledger remaining" value={formatUsd(key.ledgerRemainingUsd)} description="Analytical, not an admission promise" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Spend limit</CardTitle><CardDescription>One optional whole-dollar allowance over the preceding X × 24 hours. Editing never resets prior usage.</CardDescription></CardHeader>
          <CardContent><form className="space-y-4" onSubmit={save}><div className="flex items-center justify-between rounded-md border p-3"><div><Label htmlFor="detail-limited">Limit this key</Label><p className="text-xs text-muted-foreground">Unlimited keys have no rolling window.</p></div><Switch id="detail-limited" checked={limited} onCheckedChange={(checked) => setLimitDraft({ limited: checked, limitUsd, windowDays })} disabled={pending || key.status !== "available"} /></div>{limited ? <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="detail-limit">Spend limit (whole USD)</Label><Input id="detail-limit" inputMode="numeric" pattern="[1-9][0-9]*" value={limitUsd} onChange={(event) => setLimitDraft({ limited, limitUsd: event.target.value, windowDays })} disabled={pending} /></div><div className="space-y-2"><Label htmlFor="detail-window">Rolling window (days)</Label><Input id="detail-window" inputMode="numeric" pattern="[0-9]*" value={windowDays} onChange={(event) => setLimitDraft({ limited, limitUsd, windowDays: event.target.value })} disabled={pending} /><p className="text-xs text-muted-foreground">Whole number from 1 to 30.</p></div></div> : null}{loweringBelowUsage ? <Alert variant="warning" appearance="light"><AlertDescription>The new limit is below current rolling usage. Saving is allowed, but this key will remain blocked until enough billed requests age out.</AlertDescription></Alert> : null}{message ? <Alert variant={message.kind === "error" ? "destructive" : message.kind}><AlertDescription>{message.text}</AlertDescription></Alert> : null}<Button type="submit" disabled={pending || key.status !== "available"}>{pending ? <><Loader2 className="animate-spin" />Saving…</> : "Save limit"}</Button></form></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="size-5" />Enforcement</CardTitle><CardDescription>Conservative provider-hidden guardrail state is separate from exact Market-recorded usage.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {!finite ? <Alert variant="info" appearance="light"><AlertDescription>Unlimited key: rolling enforcement, remaining capacity, reset, and provider observation are N/A.</AlertDescription></Alert> : <><div className="grid gap-3 sm:grid-cols-2"><Stat label="State" value={enforcement.status} /><Stat label="Remaining upper bound" value={formatUsd(enforcement.remainingUsdUpperBound)} /><Stat label="Observed decision" value={enforcement.decision ?? "N/A"} /><Stat label="Reset" value={formatUtc(enforcement.resetAt)} /><Stat label="Last observed" value={formatUtc(enforcement.observedAt)} /><Stat label="Observed revision" value={enforcement.observedRevision?.toString() ?? "N/A"} /></div>{enforcement.mayBeMoreRestrictive ? <Alert variant="warning" appearance="light"><AlertDescription>Conservative rounding and reservations may make enforcement stricter than the exact ledger remainder.</AlertDescription></Alert> : null}</>}
            <div className="flex items-start gap-2 text-xs text-muted-foreground"><Info className="mt-0.5 size-4 shrink-0" /><p>Ledger eligibility: {finite ? formatUtc(key.ledgerNextCostEligibleAt) : "N/A"}. This timestamp cannot guarantee the next request will be admitted.</p></div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-destructive/40"><CardHeader><CardTitle className="text-base">Revoke API key</CardTitle><CardDescription>{key.status === "revocation_pending" ? "Market authorization is already blocked while provider confirmation remains pending." : "Authorization stops immediately while historical usage and this key tombstone remain retained."}</CardDescription></CardHeader><CardContent><Button variant="destructive" onClick={() => setRevokeOpen(true)} disabled={key.status === "revoked"}><Trash2 />{key.status === "revocation_pending" ? "Retry revocation" : "Revoke key"}</Button></CardContent></Card>
      <AlertDialog open={revokeOpen} onOpenChange={(open) => { if (!pending) setRevokeOpen(open); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{key.status === "revocation_pending" ? "Retry revocation for" : "Revoke"} {key.name}?</AlertDialogTitle><AlertDialogDescription>{key.status === "revocation_pending" ? "Market is already denying this key. Retry provider confirmation without deleting its history." : "This cannot be undone. Historical Activity and Logs remain available."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={(event) => { event.preventDefault(); void revoke(); }} disabled={pending}>{pending ? "Revoking…" : key.status === "revocation_pending" ? "Retry revocation" : "Revoke key"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      <Button variant="ghost" asChild className="self-start"><Link href="/account/api-keys"><ArrowLeft />Back to API Keys</Link></Button>
    </div>
  );
}
