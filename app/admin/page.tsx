import { ArrowRight, Database, LayoutDashboard, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDbStatus } from "@/lib/db/status";

export const runtime = "nodejs";

export default async function HomePage() {
  const status = await getDbStatus();

  return (
    <main className="container flex min-h-0 flex-col gap-20 pt-12">
      <section className="grid gap-10 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-14">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1 text-sm text-muted-foreground shadow-sm">
            <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
            TradingGoose-Market admin pannel
          </div>
          <div className="space-y-10">
            <h1 className="text-balance text-4xl font-semibold leading-tight md:text-5xl">
              Market data cockpit, prewired to your Postgres stack.
            </h1>
            <p className="max-w-2xl text-lg text-muted-foreground">
              A lean Next.js App Router setup with Tailwind and shadcn/ui. Database connectivity is driven by
              <code className="ml-1 rounded bg-muted px-1.5 py-0.5 text-sm">DATABASE_POOL_URL</code> (pooler) or
              <code className="ml-1 rounded bg-muted px-1.5 py-0.5 text-sm">DATABASE_URL</code> from <code className="ml-1 rounded bg-muted px-1.5 py-0.5 text-sm">.env</code> so you can ship features instead of wiring scaffolding.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <a href="#connection">
                Check DB status
                <ArrowRight className="h-4 w-4" />
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href="/api/health" target="_blank" rel="noreferrer">
                API health JSON
              </a>
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="bg-gradient-to-br from-primary/10 via-transparent to-accent/10">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm text-muted-foreground">App Router</CardTitle>
                <CardDescription className="text-base text-foreground">
                  Server components, edge-friendly by default.
                </CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm text-muted-foreground">Design system</CardTitle>
                <CardDescription className="text-base text-foreground">
                  shadcn/ui + Tailwind with cohesive tokens.
                </CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm text-muted-foreground">Data layer</CardTitle>
                <CardDescription className="text-base text-foreground">
                  Drizzle ORM with Postgres tuned for Timescale.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>

        <Card id="connection" className="h-full border-primary/30 shadow-lg shadow-primary/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Database className="h-5 w-5 text-primary" /> Database connectivity
            </CardTitle>
            <CardDescription>Live check using <code className="rounded bg-muted px-1">db</code> from <code className="rounded bg-muted px-1">/packages/db/index.ts</code>.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Status</p>
              </div>
              <div className="flex items-center gap-2 text-sm">
                {status.ok ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-3 py-1 text-emerald-600">
                    <ShieldCheck className="h-4 w-4" /> Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-3 py-1 text-destructive">
                    Issue
                  </span>
                )}
              </div>
            </div>
            <div className="rounded-lg bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>Status</span>
                <span className={status.ok ? "text-emerald-600" : "text-destructive"}>{status.message}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span>Latency</span>
                <span>{status.durationMs ? `${status.durationMs.toFixed(1)} ms` : "–"}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              This query is executed server-side during render via <code className="rounded bg-card px-1">db.execute(sql`select 1`)</code>. Update <code className="rounded bg-card px-1">.env</code> and restart dev server if you change credentials.
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        {[{
          title: "App shell",
          description: "Routing, fonts, theming, and global styles wired up.",
          icon: <LayoutDashboard className="h-5 w-5 text-primary" />
        }, {
          title: "Database ready",
          description: "Drizzle client uses DATABASE_POOL_URL or DATABASE_URL from your environment.",
          icon: <Database className="h-5 w-5 text-primary" />
        }, {
          title: "Security aware",
          description: "Env vars kept server-side; client only sees NEXT_PUBLIC_* keys.",
          icon: <ShieldCheck className="h-5 w-5 text-primary" />
        }].map((item) => (
          <Card key={item.title} className="border-dashed">
            <CardHeader className="flex-row items-center gap-3 space-y-0">
              <div className="rounded-lg bg-primary/10 p-2">
                {item.icon}
              </div>
              <div>
                <CardTitle className="text-base">{item.title}</CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </div>
            </CardHeader>
          </Card>
        ))}
      </section>
    </main>
  );
}
