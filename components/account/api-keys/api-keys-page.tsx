"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, Copy, ExternalLink, Info, KeyRound, Loader2, MoreHorizontal, Plus, Search, Trash2 } from "lucide-react";

import { AccountPageHeader } from "@/components/account/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { marketApiRequest, useMarketResource } from "@/hooks/use-market-resource";
import type {
  ApiKeyRevocationOutcome,
  BillingSummary,
  MarketApiKeySummary,
} from "@/lib/account/contracts";
import { formatCount, formatUsd, formatUtc } from "@/lib/account/format";

function statusBadge(status: MarketApiKeySummary["status"]) {
  if (status === "available") return <Badge>Available</Badge>;
  if (status === "revocation_pending") return <Badge variant="outline">Revocation pending</Badge>;
  return <Badge variant="secondary">Revoked</Badge>;
}

export function ApiKeysPage() {
  const resource = useMarketResource<{ keys: MarketApiKeySummary[] }>("/api/account/api-keys");
  const billing = useMarketResource<BillingSummary>("/api/account/billing");
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<MarketApiKeySummary | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<MarketApiKeySummary | null>(null);
  const [name, setName] = useState("");
  const [limited, setLimited] = useState(false);
  const [limitUsd, setLimitUsd] = useState("");
  const [windowDays, setWindowDays] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pageMessage, setPageMessage] = useState<{
    kind: "success" | "warning" | "error";
    text: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const keys = useMemo(() => resource.data?.keys ?? [], [resource.data?.keys]);
  const filtered = useMemo(() => keys.filter((key) => `${key.name} ${key.displayValue}`.toLowerCase().includes(query.trim().toLowerCase())), [keys, query]);

  function validateLimit(): { limitUsd: string; windowDays: number } | null {
    if (!/^[1-9]\d*$/.test(limitUsd)) { setFormError("Spend limit must be a positive whole-dollar integer such as 1, 2, or 3."); return null; }
    if (!/^\d+$/.test(windowDays)) { setFormError("Rolling window must be a whole number from 1 through 30 days."); return null; }
    const days = Number(windowDays);
    if (!Number.isSafeInteger(days) || days < 1 || days > 30) { setFormError("Rolling window must be from 1 through 30 days."); return null; }
    return { limitUsd, windowDays: days };
  }

  async function createKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) { setFormError("Enter a key name."); return; }
    const limit = limited ? validateLimit() : null;
    if (limited && !limit) return;
    setPending(true); setFormError(null);
    try {
      const result = await marketApiRequest<{ key: MarketApiKeySummary; secret: string }>("/api/account/api-keys", { method: "POST", body: JSON.stringify({ name: trimmedName, limitUsd: limit?.limitUsd ?? null, windowDays: limit?.windowDays ?? null }) });
      setCreateOpen(false); setCreatedKey(result.key); setSecret(result.secret); setName(""); setLimited(false); setLimitUsd(""); setWindowDays("");
      await resource.refresh();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to create the key.");
    } finally { setPending(false); }
  }

  async function revoke() {
    if (!revokeTarget) return;
    setPending(true); setPageMessage(null);
    try {
      const outcome = await marketApiRequest<ApiKeyRevocationOutcome>(
        `/api/account/api-keys/${encodeURIComponent(revokeTarget.id)}`,
        { method: "DELETE" },
      );
      setPageMessage(
        outcome.status === "revoked"
          ? {
              kind: "success",
              text: "The API key is revoked. Its historical usage remains available.",
            }
          : {
              kind: "warning",
              text: "Market is already denying this API key. Provider confirmation is pending; retrying revocation is safe.",
            },
      );
    } catch {
      setPageMessage({
        kind: "error",
        text: "The revocation attempt could not be completed. The refreshed list shows Market's current revocation workflow state.",
      });
    } finally {
      setRevokeTarget(null);
      await resource.refresh();
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6">
      <AccountPageHeader title="API Keys" description="Create and manage Market public API keys. Keys can be minted even before PAYG is active; billing gates use when enabled." actions={<Button onClick={() => setCreateOpen(true)}><Plus />New Key</Button>} />
      {!billing.isLoading && billing.data && !billing.data.billingEnabled ? <Alert variant="info" appearance="light"><AlertDescription>Billing is disabled. Saved per-key spend limits remain editable but are not enforced or consumed while requests are non-billable.</AlertDescription></Alert> : null}
      {pageMessage ? <Alert variant={pageMessage.kind === "error" ? "destructive" : pageMessage.kind}><AlertDescription>{pageMessage.text}</AlertDescription></Alert> : null}
      <div className="flex items-center gap-3"><div className="relative w-full max-w-sm"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search API keys" className="pl-9" /></div><Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="About API keys"><Info /></Button></TooltipTrigger><TooltipContent>Secrets are shown once. Market stores only safe display metadata.</TooltipContent></Tooltip></div>
      <Card className="overflow-hidden rounded-lg shadow-none">
        <CardContent className="p-0">
          {resource.isLoading ? <div className="space-y-2 p-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}</div> : resource.error ? <div className="p-6"><Alert variant="destructive"><AlertDescription>API keys could not be loaded. <Button variant="link" onClick={() => void resource.refresh()}>Retry</Button></AlertDescription></Alert></div> : filtered.length === 0 ? <Empty className="min-h-72 border-0"><EmptyHeader><EmptyMedia variant="icon"><KeyRound /></EmptyMedia><EmptyTitle>{keys.length ? "No matching keys" : "No API keys yet"}</EmptyTitle><EmptyDescription>{keys.length ? "Change your search to see more results." : "Create a key for public Market read access."}</EmptyDescription></EmptyHeader>{!keys.length ? <EmptyContent><Button onClick={() => setCreateOpen(true)}><Plus />New Key</Button></EmptyContent> : null}</Empty> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Key</TableHead><TableHead>Status</TableHead><TableHead>Usage</TableHead><TableHead>Limit</TableHead><TableHead>Window</TableHead><TableHead>Last Used</TableHead><TableHead className="text-right">Requests</TableHead><TableHead className="w-12"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader><TableBody>{filtered.map((key) => <TableRow key={key.id}><TableCell><Link href={`/account/api-keys/${key.id}`} className="font-medium hover:underline">{key.name}</Link><p className="font-mono text-xs text-muted-foreground">{key.displayValue}</p></TableCell><TableCell>{statusBadge(key.status)}</TableCell><TableCell className="tabular-nums">{formatUsd(key.rollingBillableCostUsd)}</TableCell><TableCell className="tabular-nums">{key.spendLimitUsd ? `$${key.spendLimitUsd}` : "Unlimited"}</TableCell><TableCell>{key.spendWindowDays ? `${key.spendWindowDays} rolling days` : "N/A"}</TableCell><TableCell>{formatUtc(key.lastUsedAt)}</TableCell><TableCell className="text-right tabular-nums">{formatCount(key.totalRequestCount)}</TableCell><TableCell><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${key.name}`}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem asChild><Link href={`/account/api-keys/${key.id}`}><ExternalLink />View details</Link></DropdownMenuItem>{key.status !== "revoked" ? <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setRevokeTarget(key)}><Trash2 />{key.status === "revocation_pending" ? "Retry revocation" : "Revoke"}</DropdownMenuItem> : null}</DropdownMenuContent></DropdownMenu></TableCell></TableRow>)}</TableBody></Table></div>}
        </CardContent>
        {!resource.isLoading && !resource.error ? <CardFooter className="border-t px-4 py-3 text-xs text-muted-foreground">{filtered.length} of {keys.length} keys</CardFooter> : null}
      </Card>

      <Dialog open={createOpen} onOpenChange={(open) => { if (!pending) { setCreateOpen(open); setFormError(null); } }}><DialogContent><DialogHeader><DialogTitle>New API key</DialogTitle><DialogDescription>Create an unlimited key or configure one whole-dollar budget over the preceding X × 24 hours.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={createKey}><div className="space-y-2"><Label htmlFor="key-name">Name</Label><Input id="key-name" value={name} onChange={(event) => setName(event.target.value)} disabled={pending} autoFocus /></div><div className="flex items-center justify-between rounded-md border p-3"><div><Label htmlFor="key-limit">Spend limit</Label><p className="text-xs text-muted-foreground">Optional per-key PAYG guardrail</p></div><Switch id="key-limit" checked={limited} onCheckedChange={setLimited} disabled={pending} /></div>{limited ? <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="limit-usd">Spend limit (whole USD)</Label><Input id="limit-usd" inputMode="numeric" pattern="[1-9][0-9]*" value={limitUsd} onChange={(event) => setLimitUsd(event.target.value)} placeholder="5" disabled={pending} /></div><div className="space-y-2"><Label htmlFor="window-days">Rolling window (days)</Label><Input id="window-days" inputMode="numeric" pattern="[0-9]*" value={windowDays} onChange={(event) => setWindowDays(event.target.value)} placeholder="7" disabled={pending} /><p className="text-xs text-muted-foreground">1–30 days; not a calendar reset.</p></div></div> : null}{formError ? <Alert variant="destructive"><AlertDescription>{formError}</AlertDescription></Alert> : null}<DialogFooter><Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={pending}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? <><Loader2 className="animate-spin" />Creating…</> : "Create key"}</Button></DialogFooter></form></DialogContent></Dialog>

      <Dialog open={Boolean(secret)} onOpenChange={(open) => { if (!open) { setSecret(null); setCreatedKey(null); setCopied(false); } }}><DialogContent><DialogHeader><DialogTitle>Copy {createdKey?.name ?? "your key"} now</DialogTitle><DialogDescription>This secret is shown once and cannot be recovered later.</DialogDescription></DialogHeader><Card className="rounded-md bg-muted/50 shadow-none"><CardContent className="p-3 font-mono text-sm break-all">{secret}</CardContent></Card><DialogFooter><Button onClick={() => { if (secret) void navigator.clipboard.writeText(secret).then(() => setCopied(true)); }}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy secret"}</Button><Button variant="outline" onClick={() => { setSecret(null); setCreatedKey(null); setCopied(false); }}>I saved it</Button></DialogFooter></DialogContent></Dialog>

      <AlertDialog open={Boolean(revokeTarget)} onOpenChange={(open) => { if (!open && !pending) setRevokeTarget(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{revokeTarget?.status === "revocation_pending" ? "Retry revocation for" : "Revoke"} {revokeTarget?.name}?</AlertDialogTitle><AlertDialogDescription>{revokeTarget?.status === "revocation_pending" ? "Market is already denying this key. Retry the provider-confirmation step while retaining its usage history." : "The key stops authorizing immediately. Its Market usage history is retained."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={(event) => { event.preventDefault(); void revoke(); }} disabled={pending}>{pending ? "Revoking…" : revokeTarget?.status === "revocation_pending" ? "Retry revocation" : "Revoke key"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
  );
}
