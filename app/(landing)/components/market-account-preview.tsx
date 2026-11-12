"use client";

import { Fragment, useState } from "react";
import { Activity, ChevronDown, CircleAlert, CircleCheck, Clock, FileClock, KeyRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MarketApiKeySummary, UsageLogRow } from "@/lib/account/contracts";
import { formatUtc } from "@/lib/account/format";
import { cn } from "@/lib/ui/utils";

import styles from "./market-account-preview.module.css";

const keys: Pick<MarketApiKeySummary, "name" | "displayValue" | "spendLimitUsd" | "spendWindowDays">[] = [
  { name: "Production", displayValue: "•••• •••• 8f2a", spendLimitUsd: null, spendWindowDays: null },
  { name: "Research", displayValue: "•••• •••• 3b7c", spendLimitUsd: "50", spendWindowDays: 7 },
];

type RequestEvent = {
  id: string;
  time: string;
  endpoint: string;
  key: string;
  application: string;
  httpStatus: number | null;
  completionStatus: UsageLogRow["completionStatus"];
};

const events: RequestEvent[] = [
  { id: "r1", time: "2026-10-30T14:31:08Z", endpoint: "/api/search/listings", key: "Production", application: "Market terminal", httpStatus: 200, completionStatus: "success" },
  { id: "r2", time: "2026-10-30T14:30:52Z", endpoint: "/api/get/listing", key: "Production", application: "Market terminal", httpStatus: 200, completionStatus: "success" },
  { id: "r3", time: "2026-10-30T14:30:36Z", endpoint: "/api/get/market-hours", key: "Production", application: "Market terminal", httpStatus: 200, completionStatus: "success" },
  { id: "r4", time: "2026-10-30T14:29:54Z", endpoint: "/api/get/listing", key: "Research", application: "Research notebook", httpStatus: 404, completionStatus: "client_error" },
  { id: "r5", time: "2026-10-29T16:00:12Z", endpoint: "/api/get/listing", key: "Research", application: "Research notebook", httpStatus: 500, completionStatus: "server_error" },
  { id: "r6", time: "2026-10-29T15:59:40Z", endpoint: "/api/get/market-hours", key: "Production", application: "Market terminal", httpStatus: 200, completionStatus: "success" },
  { id: "r7", time: "2026-10-29T15:58:10Z", endpoint: "/api/search/listings", key: "Production", application: "Market terminal", httpStatus: 200, completionStatus: "success" },
  { id: "r8", time: "2026-10-29T15:57:12Z", endpoint: "/api/get/listing", key: "Research", application: "Research notebook", httpStatus: null, completionStatus: "pending" },
];

function Outcome({ event }: { event: RequestEvent }) {
  const pending = event.completionStatus === "pending";
  const success = event.completionStatus === "success";
  const Icon = pending ? Clock : success ? CircleCheck : CircleAlert;
  const label = pending ? "Pending" : success ? "Success" : event.completionStatus === "client_error" ? "Client error" : "Server error";

  return (
    <Badge variant="outline" className={cn(styles.status, pending ? styles.pending : success ? styles.success : styles.error)}>
      <Icon aria-hidden="true" size={13} />
      {event.httpStatus ? <><span className="sr-only">{label} </span>{event.httpStatus}</> : label}
    </Badge>
  );
}

export function MarketAccountPreview({ className }: { className?: string }) {
  const [period, setPeriod] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const activity = events.filter((event) => period === "all" || event.time.startsWith(period));
  const successes = activity.filter((event) => event.completionStatus === "success").length;
  const failures = activity.filter((event) => event.completionStatus.endsWith("error")).length;
  const pending = activity.filter((event) => event.completionStatus === "pending").length;
  const endpoints = [...new Set(events.map((event) => event.endpoint))];
  const logs = events.filter((event) => outcome === "all" || event.completionStatus === outcome);

  return (
    <Card className={cn(styles.preview, "rounded-lg bg-background/50 shadow-none backdrop-blur-sm", className)} role="region" aria-label="Market account preview">
      <CardHeader className={cn(styles.header, "space-y-0")}>
        <h3>Account preview</h3>
        <span className="text-xs font-normal text-muted-foreground">Oct 29–30, 2026</span>
      </CardHeader>
      <Tabs defaultValue="keys" className={styles.account}>
        <TabsList aria-label="Market account" className={cn(styles.tabs, "h-auto w-full justify-start gap-0 rounded-none bg-transparent p-0")}>
          {[
            { value: "keys", label: "API Keys", icon: KeyRound },
            { value: "activity", label: "Activity", icon: Activity },
            { value: "logs", label: "Logs", icon: FileClock },
          ].map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} className={cn(styles.tab, "gap-2 rounded-none hover:bg-muted/50 focus-visible:ring-foreground focus-visible:ring-inset focus-visible:ring-offset-0 data-[state=active]:bg-muted data-[state=active]:text-foreground data-[state=active]:shadow-none")}>
              <Icon aria-hidden="true" className="size-4" />{label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="keys" className={cn(styles.panel, "mt-0 focus-visible:ring-foreground focus-visible:ring-inset focus-visible:ring-offset-0")}>
          <ScrollArea className="h-full">
            <CardContent className={styles.body}>
              <Table className={styles.table} aria-label="API keys">
                <TableHeader><TableRow><TableHead>Key</TableHead><TableHead>API spending limit</TableHead></TableRow></TableHeader>
                <TableBody>{keys.map((key) => (
                  <TableRow key={key.name}>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <span className="font-medium">{key.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">{key.displayValue}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <span className="font-medium">{key.spendLimitUsd ? `$${key.spendLimitUsd}` : "No limit"}</span>
                        {key.spendWindowDays && <span className="text-xs text-muted-foreground">Over the past {key.spendWindowDays} days</span>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </CardContent>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="activity" className={cn(styles.panel, "mt-0 focus-visible:ring-foreground focus-visible:ring-inset focus-visible:ring-offset-0")}>
          <ScrollArea className="h-full">
            <CardContent className={styles.body}>
              <div className={styles.toolbar}>
                <h3 className="text-sm font-medium">Request activity</h3>
                <Select value={period} onValueChange={setPeriod}>
                  <SelectTrigger aria-label="Activity period" className="h-9 w-36 text-xs focus:ring-0 focus:ring-offset-0 focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="all">Oct 29–30 UTC</SelectItem><SelectItem value="2026-10-30">Oct 30 UTC</SelectItem><SelectItem value="2026-10-29">Oct 29 UTC</SelectItem></SelectContent>
                </Select>
              </div>
              <dl className={styles.metrics} aria-live="polite">
                <div><dt>Requests</dt><dd>{activity.length}</dd></div>
                <div><dt>Successes</dt><dd>{successes}</dd></div>
                <div><dt>Errors</dt><dd>{failures}</dd></div>
              </dl>
              <p className="mb-5 text-xs text-muted-foreground" aria-live="polite">
                {pending} pending {pending === 1 ? "outcome" : "outcomes"}
              </p>
              <p className="mb-3 text-xs font-medium">Requests by endpoint</p>
              <ul className={styles.ranking} aria-label="Requests by endpoint">
                {endpoints.map((endpoint) => {
                  const count = activity.filter((event) => event.endpoint === endpoint).length;
                  return <li key={endpoint}><div className="flex items-center justify-between gap-3"><code>{endpoint}</code><span className="tabular-nums">{count}</span></div><div className={styles.track} aria-hidden="true"><span style={{ width: `${count / Math.max(activity.length, 1) * 100}%` }} /></div></li>;
                })}
              </ul>
            </CardContent>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="logs" className={cn(styles.panel, "mt-0 focus-visible:ring-foreground focus-visible:ring-inset focus-visible:ring-offset-0")}>
          <ScrollArea className="h-full">
            <CardContent className={styles.body}>
              <div className={styles.toolbar}>
                <h3 className="text-sm font-medium">Request logs</h3>
                <Select value={outcome} onValueChange={(value) => { setOutcome(value); setExpanded(null); }}>
                  <SelectTrigger aria-label="Log outcome" className="h-9 w-36 text-xs focus:ring-0 focus:ring-offset-0 focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All outcomes</SelectItem><SelectItem value="success">Success</SelectItem><SelectItem value="client_error">Client error</SelectItem><SelectItem value="server_error">Server error</SelectItem><SelectItem value="pending">Pending</SelectItem></SelectContent>
                </Select>
              </div>
              <Table className={cn(styles.table, styles.logs)} aria-label="Request logs">
                <TableHeader><TableRow><TableHead>Endpoint / UTC</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Details</span></TableHead></TableRow></TableHeader>
                <TableBody>{logs.map((event) => {
                  const lastSegment = event.endpoint.lastIndexOf("/") + 1;
                  return (
                  <Fragment key={event.id}>
                    <TableRow>
                      <TableCell><div className="flex flex-col items-start gap-1"><code>{event.endpoint.slice(0, lastSegment)}<wbr />{event.endpoint.slice(lastSegment)}</code><time dateTime={event.time} className="text-xs text-muted-foreground">{event.time.slice(5, 10)} {event.time.slice(11, 19)}</time></div></TableCell>
                      <TableCell><Outcome event={event} /></TableCell>
                      <TableCell><Button variant="ghost" size="icon" className="size-9 bg-transparent focus-visible:ring-foreground" aria-label={`Request details ${event.time.slice(11, 19)}`} aria-expanded={expanded === event.id} aria-controls={`account-log-${event.id}`} onClick={() => setExpanded(expanded === event.id ? null : event.id)}><ChevronDown aria-hidden="true" className={expanded === event.id ? "rotate-180" : undefined} /></Button></TableCell>
                    </TableRow>
                    {expanded === event.id ? <TableRow id={`account-log-${event.id}`}><TableCell colSpan={3}><dl className={styles.logDetail}><div><dt>Time</dt><dd>{formatUtc(event.time)}</dd></div><div><dt>Application</dt><dd>{event.application}</dd></div><div><dt>API key</dt><dd>{event.key}</dd></div><div><dt>Method</dt><dd>GET</dd></div></dl></TableCell></TableRow> : null}
                  </Fragment>
                );})}</TableBody>
              </Table>
              <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">{logs.length} {logs.length === 1 ? "request" : "requests"}</p>
            </CardContent>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </Card>
  );
}
