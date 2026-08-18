import Link from "next/link";
import { Activity, Database, KeyRound } from "lucide-react";

import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function AdminHomePage() {
  return (
    <AdminPageShell title="Market Administration" description="Database-provisioned administration for private API access and Market data entities. Customer PAYG and public keys remain available through your additive customer account.">
      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="size-5" />Admin API Keys</CardTitle><CardDescription>Mint private update keys and revoke system-wide private credentials.</CardDescription></CardHeader><CardContent><Button asChild><Link href="/admin/api-keys">Manage private keys</Link></Button></CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><Activity className="size-5" />Private API Usage</CardTitle><CardDescription>Inspect retained private request activity and request-level logs.</CardDescription></CardHeader><CardContent><Button asChild variant="outline"><Link href="/admin/api-usage">View private usage</Link></Button></CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><Database className="size-5" />Market Data</CardTitle><CardDescription>Use the navigation to manage retained entity data and Market Hours list/export/delete.</CardDescription></CardHeader><CardContent><Button asChild variant="outline"><Link href="/admin/listings">Open listings</Link></Button></CardContent></Card>
      </div>
    </AdminPageShell>
  );
}
