"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, Loader2, MoreHorizontal, Plus, Trash2 } from "lucide-react";

import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { marketApiRequest, useMarketResource } from "@/hooks/use-market-resource";
import type {
  AdminApiKeySummary,
  ApiKeyRevocationOutcome,
} from "@/lib/account/contracts";
import { formatCount, formatUtc } from "@/lib/account/format";

export function AdminApiKeysPage() {
  const resource = useMarketResource<{ keys: AdminApiKeySummary[] }>("/api/admin/api-keys");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageMessage, setPageMessage] = useState<{
    kind: "success" | "warning" | "error";
    text: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<AdminApiKeySummary | null>(null);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) { setError("Enter a key name."); return; }
    setPending(true); setError(null);
    try { const result = await marketApiRequest<{ key: AdminApiKeySummary; secret: string }>("/api/admin/api-keys", { method: "POST", body: JSON.stringify({ name: name.trim() }) }); setSecret(result.secret); setCreateOpen(false); setName(""); await resource.refresh(); } catch { setError("Unable to create the private key."); } finally { setPending(false); }
  }
  async function revoke() {
    if (!revokeTarget) return;
    setPending(true);
    setPageMessage(null);
    try {
      const outcome = await marketApiRequest<ApiKeyRevocationOutcome>(
        `/api/admin/api-keys/${encodeURIComponent(revokeTarget.id)}`,
        { method: "DELETE" },
      );
      setPageMessage(
        outcome.status === "revoked"
          ? {
              kind: "success",
              text: "The private API key is revoked. Its historical usage remains visible.",
            }
          : {
              kind: "warning",
              text: "Market is already denying this private key. Provider confirmation is pending; retrying revocation is safe.",
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

  return <AdminPageShell title="Admin API Keys" description="Mint private update credentials bound to your current admin grant, or revoke any admin's private key system-wide. Membership remains database-provisioned." actions={<Button onClick={() => setCreateOpen(true)}><Plus />New private key</Button>}>
    {pageMessage ? <Alert variant={pageMessage.kind === "error" ? "destructive" : pageMessage.kind}><AlertDescription>{pageMessage.text}</AlertDescription></Alert> : null}
    <Card className="overflow-hidden rounded-lg shadow-none"><CardContent className="p-0">{resource.isLoading ? <div className="space-y-2 p-4">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-12" />)}</div> : resource.error ? <div className="p-6"><Alert variant="destructive"><AlertDescription>Private API keys could not be loaded.</AlertDescription></Alert></div> : !resource.data?.keys.length ? <Empty className="min-h-72 border-0"><EmptyHeader><EmptyMedia variant="icon"><KeyRound /></EmptyMedia><EmptyTitle>No private API keys</EmptyTitle><EmptyDescription>Current admins can create private keys for Market update endpoints.</EmptyDescription></EmptyHeader></Empty> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Key</TableHead><TableHead>Status</TableHead><TableHead>Originating admin</TableHead><TableHead>Grant</TableHead><TableHead>Created</TableHead><TableHead>Last Used</TableHead><TableHead className="text-right">Requests</TableHead><TableHead className="w-12"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader><TableBody>{resource.data.keys.map((key) => <TableRow key={key.id}><TableCell><p className="font-medium">{key.name}</p><p className="font-mono text-xs text-muted-foreground">{key.displayValue}</p></TableCell><TableCell><Badge variant={key.status === "available" ? "default" : "secondary"}>{key.status.replace("_", " ")}</Badge></TableCell><TableCell><p>{key.originatingAdminName}</p><p className="text-xs text-muted-foreground">{key.originatingAdminEmail}</p></TableCell><TableCell><Badge variant="outline">{key.grantStatus}</Badge></TableCell><TableCell>{formatUtc(key.createdAt)}</TableCell><TableCell>{formatUtc(key.lastUsedAt)}</TableCell><TableCell className="text-right tabular-nums">{formatCount(key.totalRequestCount)}</TableCell><TableCell>{key.status !== "revoked" ? <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${key.name}`}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setRevokeTarget(key)}><Trash2 />{key.status === "revocation_pending" ? "Retry revocation" : "Revoke"}</DropdownMenuItem></DropdownMenuContent></DropdownMenu> : null}</TableCell></TableRow>)}</TableBody></Table></div>}</CardContent></Card>
    <Dialog open={createOpen} onOpenChange={(open) => { if (!pending) setCreateOpen(open); }}><DialogContent><DialogHeader><DialogTitle>New private API key</DialogTitle><DialogDescription>This key can access only Market private update endpoints and has no PAYG or spend limit.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={create}><div className="space-y-2"><Label htmlFor="private-key-name">Name</Label><Input id="private-key-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus /></div>{error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}<DialogFooter><Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? <><Loader2 className="animate-spin" />Creating…</> : "Create private key"}</Button></DialogFooter></form></DialogContent></Dialog>
    <Dialog open={Boolean(secret)} onOpenChange={(open) => { if (!open) { setSecret(null); setCopied(false); } }}><DialogContent><DialogHeader><DialogTitle>Copy the private key now</DialogTitle><DialogDescription>The raw secret is shown once and is never stored by Market.</DialogDescription></DialogHeader><Card className="rounded-md bg-muted/50 shadow-none"><CardContent className="p-3 font-mono text-sm break-all">{secret}</CardContent></Card><DialogFooter><Button onClick={() => { if (secret) void navigator.clipboard.writeText(secret).then(() => setCopied(true)); }}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy secret"}</Button><Button variant="outline" onClick={() => { setSecret(null); setCopied(false); }}>I saved it</Button></DialogFooter></DialogContent></Dialog>
    <AlertDialog open={Boolean(revokeTarget)} onOpenChange={(open) => { if (!open && !pending) setRevokeTarget(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{revokeTarget?.status === "revocation_pending" ? "Retry revocation for" : "Revoke"} {revokeTarget?.name}?</AlertDialogTitle><AlertDialogDescription>{revokeTarget?.status === "revocation_pending" ? "Market is already denying this private key. Retry provider confirmation while retaining historical usage." : "Private authorization stops immediately. Historical usage remains visible to every current admin."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={(event) => { event.preventDefault(); void revoke(); }} disabled={pending}>{pending ? "Revoking…" : revokeTarget?.status === "revocation_pending" ? "Retry revocation" : "Revoke key"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </AdminPageShell>;
}
