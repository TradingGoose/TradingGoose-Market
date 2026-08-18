"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChevronDown, ChevronLeft, ChevronRight, Columns3, FileClock, RefreshCw } from "lucide-react";

import { AccountPageHeader } from "@/components/account/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMarketResource } from "@/hooks/use-market-resource";
import type { LogsResponse, UsageLogRow } from "@/lib/account/contracts";
import { applicationLabel, formatUtc } from "@/lib/account/format";
import {
  advanceUsageCursorPagination,
  initialUsageCursorPagination,
  retreatUsageCursorPagination,
} from "@/lib/account/usage-pagination";
import { buildCustomerLogsQuery } from "@/lib/account/usage-query";
import { cn } from "@/lib/ui/utils";

const optionalColumns = ["application", "method", "key", "version", "completed"] as const;
type OptionalColumn = typeof optionalColumns[number];

function statusBadge(row: UsageLogRow) {
  if (row.completionStatus === "pending") return <Badge variant="outline">Pending</Badge>;
  if (row.completionStatus === "success") return <Badge>Success {row.httpStatus}</Badge>;
  return <Badge variant="destructive">{row.completionStatus === "client_error" ? "Client error" : "Server error"} {row.httpStatus}</Badge>;
}

export function LogsPage() {
  const searchParams = useSearchParams();
  const [range, setRange] = useState("7d");
  const [keyId, setKeyId] = useState(searchParams.get("key") ?? "all");
  const [resourceId, setResourceId] = useState("all");
  const [status, setStatus] = useState("all");
  const [application, setApplication] = useState("all");
  const [endpoint, setEndpoint] = useState("all");
  const [pagination, setPagination] = useState(initialUsageCursorPagination);
  const [histogramOpen, setHistogramOpen] = useState(true);
  const [density, setDensity] = useState<"comfortable" | "compact">("compact");
  const [columns, setColumns] = useState<Record<OptionalColumn, boolean>>({ application: true, method: true, key: true, version: true, completed: true });
  const query = useMemo(
    () => buildCustomerLogsQuery({
      range,
      keyId,
      appUrl: application,
      resourceId,
      routeId: endpoint,
      completion: status,
      cursor: pagination.cursor,
    }),
    [application, endpoint, keyId, pagination.cursor, range, resourceId, status],
  );
  const resource = useMarketResource<LogsResponse>(`/api/account/logs?${query}`);
  const rows = useMemo(() => resource.data?.rows ?? [], [resource.data?.rows]);

  function resetPagination() {
    setPagination(initialUsageCursorPagination());
  }

  function nextPage() {
    if (!resource.data?.nextCursor) return;
    setPagination((current) =>
      advanceUsageCursorPagination(current, resource.data?.nextCursor ?? null)
    );
  }

  function previousPage() {
    setPagination(retreatUsageCursorPagination);
  }

  return (
    <div className="mx-auto flex w-full max-w-[1700px] flex-col gap-6">
      <AccountPageHeader title="Logs" description="Request-level Market admissions and completion outcomes. Logs show stored metadata, never request or response payloads." actions={<Button variant="outline" onClick={() => void resource.refresh()} disabled={resource.isLoading}><RefreshCw className={resource.isLoading ? "animate-spin" : ""} />Refresh</Button>} />
      <div className="flex flex-wrap gap-2">
        <Select value={range} onValueChange={(value) => { setRange(value); resetPagination(); }}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["24h", "7d", "30d", "90d"].map((value) => (
              <SelectItem key={value} value={value}>{value} UTC</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={keyId} onValueChange={(value) => { setKeyId(value); resetPagination(); }}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All API keys</SelectItem>
            {resource.data?.facets.keys.map((item) => (
              <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={application} onValueChange={(value) => { setApplication(value); resetPagination(); }}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All applications</SelectItem>
            {resource.data?.facets.applications.map((item) => (
              <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={resourceId} onValueChange={(value) => { setResourceId(value); resetPagination(); }}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All requested resources</SelectItem>
            {resource.data?.facets.resources.map((item) => (
              <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={endpoint} onValueChange={(value) => { setEndpoint(value); resetPagination(); }}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All endpoints</SelectItem>
            {resource.data?.facets.endpoints.map((item) => (
              <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(value) => { setStatus(value); resetPagination(); }}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All outcomes</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="client_error">Client error</SelectItem>
            <SelectItem value="server_error">Server error</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
        <Select value={density} onValueChange={(value) => setDensity(value as "comfortable" | "compact")}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="compact">Compact</SelectItem>
            <SelectItem value="comfortable">Comfortable</SelectItem>
          </SelectContent>
        </Select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline"><Columns3 />Columns</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {optionalColumns.map((column) => (
              <DropdownMenuCheckboxItem
                key={column}
                checked={columns[column]}
                onCheckedChange={(checked) =>
                  setColumns((current) => ({ ...current, [column]: Boolean(checked) }))
                }
              >
                {column[0].toUpperCase() + column.slice(1)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Collapsible open={histogramOpen} onOpenChange={setHistogramOpen} className="rounded-lg border bg-background"><CollapsibleTrigger asChild><Button variant="ghost" className="h-12 w-full justify-between rounded-none px-4"><span>UTC request volume</span><ChevronDown className={cn("transition-transform", histogramOpen && "rotate-180")} /></Button></CollapsibleTrigger><CollapsibleContent className="border-t p-4"><ChartContainer config={{ requests: { label: "Requests", color: "hsl(var(--primary))" } }} className="h-44 w-full aspect-auto"><AreaChart data={resource.data?.histogram ?? []}><defs><linearGradient id="logs-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--color-requests)" stopOpacity={0.35} /><stop offset="95%" stopColor="var(--color-requests)" stopOpacity={0.03} /></linearGradient></defs><CartesianGrid vertical={false} /><XAxis dataKey="timestamp" tickLine={false} axisLine={false} minTickGap={36} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} /><ChartTooltip content={<ChartTooltipContent />} /><Area type="monotone" dataKey="requests" stroke="var(--color-requests)" fill="url(#logs-fill)" /></AreaChart></ChartContainer></CollapsibleContent></Collapsible>

      <Card className="overflow-hidden rounded-lg shadow-none">
        <CardContent className="p-0">
          {resource.isLoading ? <div className="space-y-2 p-4">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-10 w-full" />)}</div> : resource.error ? <div className="p-6"><Alert variant="destructive"><AlertDescription>Request logs could not be loaded.</AlertDescription></Alert></div> : rows.length === 0 ? <Empty className="min-h-80 border-0"><EmptyHeader><EmptyMedia variant="icon"><FileClock /></EmptyMedia><EmptyTitle>No logs in this period</EmptyTitle><EmptyDescription>Admitted customer-key requests appear here, including retained history from revoked keys.</EmptyDescription></EmptyHeader></Empty> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Requested</TableHead>{columns.application ? <TableHead>Application</TableHead> : null}<TableHead>Endpoint</TableHead>{columns.method ? <TableHead>Method</TableHead> : null}<TableHead>Status</TableHead>{columns.key ? <TableHead>API Key</TableHead> : null}{columns.version ? <TableHead>Version</TableHead> : null}{columns.completed ? <TableHead>Completed</TableHead> : null}</TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.id} className={density === "compact" ? "[&_td]:py-2" : "[&_td]:py-4"}><TableCell className="whitespace-nowrap text-xs">{formatUtc(row.admittedAt)}</TableCell><TableCell><p className="font-medium">{row.requestedResourceLabel}</p><p className="font-mono text-xs text-muted-foreground">{row.requestedResourceId}</p></TableCell>{columns.application ? <TableCell><p>{applicationLabel(row.applicationTitle, row.applicationUrl)}</p>{row.applicationUrl ? <p className="max-w-56 truncate text-xs text-muted-foreground">{row.applicationUrl}</p> : null}</TableCell> : null}<TableCell><p className="font-mono text-xs">{row.routeId}</p><p className="text-xs text-muted-foreground">{row.category}</p></TableCell>{columns.method ? <TableCell><Badge variant="outline">{row.method}</Badge></TableCell> : null}<TableCell>{statusBadge(row)}</TableCell>{columns.key ? <TableCell><p className="font-medium">{row.keyName}</p><p className="font-mono text-xs text-muted-foreground">{row.keyDisplayValue}</p></TableCell> : null}{columns.version ? <TableCell>{row.version}</TableCell> : null}{columns.completed ? <TableCell className="whitespace-nowrap text-xs">{formatUtc(row.completedAt)}</TableCell> : null}</TableRow>)}</TableBody></Table></div>}
        </CardContent>
        {!resource.isLoading && !resource.error ? <CardFooter className="justify-between border-t px-4 py-3"><p className="text-xs text-muted-foreground">{rows.length} request occurrences</p><div className="flex gap-2"><Button variant="outline" size="sm" onClick={previousPage} disabled={!pagination.history.length}><ChevronLeft />Previous</Button><Button variant="outline" size="sm" onClick={nextPage} disabled={!resource.data?.nextCursor}>Next<ChevronRight /></Button></div></CardFooter> : null}
      </Card>
    </div>
  );
}
