"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  FileClock,
  RefreshCw
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis
} from "recharts";

import { AdminPageShell } from "@/components/admin/admin-page-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent
} from "@/components/ui/chart";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "@/components/ui/tabs";
import { useMarketResource } from "@/hooks/use-market-resource";
import type {
  ActivityResponse,
  AdminUsageResponse,
  LogsResponse,
  UsageBreakdown,
  UsageLogRow
} from "@/lib/account/contracts";
import {
  applicationLabel,
  formatCount,
  formatUtc
} from "@/lib/account/format";
import {
  advanceUsageCursorPagination,
  initialUsageCursorPagination,
  retreatUsageCursorPagination
} from "@/lib/account/usage-pagination";
import { buildAdminUsageQuery } from "@/lib/account/usage-query";

type View = "activity" | "logs";

function Ranking({
  title,
  rows
}: {
  title: string;
  rows: UsageBreakdown[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length ? (
          rows.slice(0, 8).map((row) => (
            <div key={row.id} className="flex justify-between gap-4 text-sm">
              <span className="truncate">{row.label}</span>
              <span className="font-mono text-muted-foreground">
                {formatCount(row.requests)}
              </span>
            </div>
          ))
        ) : (
          <Empty className="min-h-24 border-0 p-2">
            <EmptyHeader className="gap-1">
              <EmptyTitle className="text-sm text-muted-foreground">No data in this period.</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}

function completionBadge(row: UsageLogRow) {
  if (row.completionStatus === "pending") {
    return <Badge variant="outline">Pending</Badge>;
  }
  if (row.completionStatus === "success") {
    return <Badge>Success {row.httpStatus}</Badge>;
  }
  return (
    <Badge variant="destructive">
      {row.completionStatus === "client_error" ? "Client error" : "Server error"}{" "}
      {row.httpStatus}
    </Badge>
  );
}

export function AdminApiUsagePage() {
  const [view, setView] = useState<View>("activity");
  const [range, setRange] = useState("7d");
  const [keyId, setKeyId] = useState("all");
  const [appUrl, setAppUrl] = useState("all");
  const [resourceId, setResourceId] = useState("all");
  const [routeId, setRouteId] = useState("all");
  const [completion, setCompletion] = useState("all");
  const [pagination, setPagination] = useState(initialUsageCursorPagination);

  const query = useMemo(
    () => buildAdminUsageQuery({
      view,
      range,
      keyId,
      appUrl,
      resourceId,
      routeId,
      completion,
      cursor: pagination.cursor
    }),
    [
      appUrl,
      completion,
      keyId,
      pagination.cursor,
      range,
      resourceId,
      routeId,
      view
    ]
  );

  const resource = useMarketResource<AdminUsageResponse>(
    `/api/admin/api-usage?${query}`
  );
  const activity: ActivityResponse | null =
    view === "activity" && resource.data?.view === "activity"
      ? resource.data.data
      : null;
  const logs: LogsResponse | null =
    view === "logs" && resource.data?.view === "logs"
      ? resource.data.data
      : null;

  const applicationOptions = useMemo(() => {
    const facets = activity?.facets ?? logs?.facets;
    return facets?.applications ?? [];
  }, [activity, logs]);

  const resourceOptions = useMemo(() => {
    const facets = activity?.facets ?? logs?.facets;
    return facets?.resources ?? [];
  }, [activity, logs]);

  const routeOptions = useMemo(() => {
    const facets = activity?.facets ?? logs?.facets;
    return facets?.endpoints ?? [];
  }, [activity, logs]);

  function resetCursor() {
    setPagination(initialUsageCursorPagination());
  }

  function nextPage() {
    if (!logs?.nextCursor) return;
    setPagination((current) =>
      advanceUsageCursorPagination(current, logs.nextCursor)
    );
  }

  function previousPage() {
    setPagination(retreatUsageCursorPagination);
  }

  const filters = (
    <div className="flex flex-wrap gap-2">
      <Select
        value={range}
        onValueChange={(value) => {
          setRange(value);
          resetCursor();
        }}
      >
        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
        <SelectContent>
          {["24h", "7d", "30d", "90d"].map((value) => (
            <SelectItem key={value} value={value}>{value} UTC</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={keyId}
        onValueChange={(value) => {
          setKeyId(value);
          resetCursor();
        }}
      >
        <SelectTrigger className="w-48"><SelectValue placeholder="Private key" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All private keys</SelectItem>
          {(activity?.facets ?? logs?.facets)?.keys.map((item) => (
            <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={appUrl}
        onValueChange={(value) => {
          setAppUrl(value);
          resetCursor();
        }}
      >
        <SelectTrigger className="w-52"><SelectValue placeholder="Application" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All applications</SelectItem>
          {applicationOptions.map((item) => (
            <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={resourceId}
        onValueChange={(value) => {
          setResourceId(value);
          resetCursor();
        }}
      >
        <SelectTrigger className="w-52"><SelectValue placeholder="Requested resource" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All requested resources</SelectItem>
          {resourceOptions.map((item) => (
            <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={routeId}
        onValueChange={(value) => {
          setRouteId(value);
          resetCursor();
        }}
      >
        <SelectTrigger className="w-52"><SelectValue placeholder="Endpoint" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All endpoints</SelectItem>
          {routeOptions.map((item) => (
            <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={completion}
        onValueChange={(value) => {
          setCompletion(value);
          resetCursor();
        }}
      >
        <SelectTrigger className="w-44"><SelectValue placeholder="Completion" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All outcomes</SelectItem>
          <SelectItem value="success">Success</SelectItem>
          <SelectItem value="client_error">Client error</SelectItem>
          <SelectItem value="server_error">Server error</SelectItem>
          <SelectItem value="pending">Pending</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <AdminPageShell
      title="Private API Usage"
      description="System-wide Market request history for private admin keys, including revoked keys and retained history from removed admin grants. No billing or spend data is shown."
      actions={(
        <Button
          variant="outline"
          onClick={() => void resource.refresh()}
          disabled={resource.isLoading}
        >
          <RefreshCw className={resource.isLoading ? "animate-spin" : ""} />
          Refresh
        </Button>
      )}
    >
      {filters}
      <Tabs
        value={view}
        onValueChange={(value) => {
          setView(value as View);
          resetCursor();
        }}
      >
        <TabsList>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>
        <TabsContent value="activity" className="space-y-4">
          {resource.isLoading ? (
            <Skeleton className="h-80" />
          ) : resource.error ? (
            <Alert variant="destructive">
              <AlertDescription>Private activity could not be loaded.</AlertDescription>
            </Alert>
          ) : !activity || activity.totalRequests === 0 ? (
            <Empty className="min-h-72">
              <EmptyHeader>
                <EmptyMedia variant="icon"><Activity /></EmptyMedia>
                <EmptyTitle>No private activity</EmptyTitle>
                <EmptyDescription>
                  Admitted admin-key update requests appear here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { label: "Admissions", value: activity.totalRequests },
                  { label: "Successes", value: activity.completedSuccessCount },
                  { label: "Errors", value: activity.completedErrorCount },
                  { label: "Pending", value: activity.pendingCount }
                ].map((summary) => (
                  <Card key={summary.label}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">{summary.label}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-2xl font-semibold tabular-nums">
                        {formatCount(summary.value)}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <Card>
                <CardHeader><CardTitle>Private request volume</CardTitle></CardHeader>
                <CardContent>
                  <ChartContainer
                    config={{ requests: { label: "Requests", color: "hsl(var(--primary))" } }}
                    className="h-72 w-full aspect-auto"
                  >
                    <BarChart data={activity.buckets}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="timestamp" tickLine={false} axisLine={false} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="requests" fill="var(--color-requests)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
              <div className="grid gap-4 lg:grid-cols-4">
                <Ranking title="Top private keys" rows={activity.topKeys} />
                <Ranking title="Top applications" rows={activity.topApplications} />
                <Ranking title="Top resources" rows={activity.topResources} />
                <Ranking title="Top endpoints" rows={activity.topEndpoints} />
              </div>
            </>
          )}
        </TabsContent>
        <TabsContent value="logs" className="space-y-4">
          {resource.isLoading ? (
            <Skeleton className="h-80" />
          ) : resource.error ? (
            <Alert variant="destructive">
              <AlertDescription>Private logs could not be loaded.</AlertDescription>
            </Alert>
          ) : !logs?.rows.length ? (
            <Empty className="min-h-72">
              <EmptyHeader>
                <EmptyMedia variant="icon"><FileClock /></EmptyMedia>
                <EmptyTitle>No private logs</EmptyTitle>
                <EmptyDescription>
                  Request-level private-key history appears here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <Card>
                <CardContent className="pt-6">
                  <ChartContainer
                    config={{ requests: { label: "Requests", color: "hsl(var(--primary))" } }}
                    className="h-40 w-full aspect-auto"
                  >
                    <AreaChart data={logs.histogram}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="timestamp" tickLine={false} axisLine={false} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area
                        dataKey="requests"
                        stroke="var(--color-requests)"
                        fill="var(--color-requests)"
                        fillOpacity={0.15}
                      />
                    </AreaChart>
                  </ChartContainer>
                </CardContent>
              </Card>
              <Card className="overflow-hidden rounded-lg shadow-none">
                <CardContent className="overflow-x-auto p-0">
                  <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Requested</TableHead>
                      <TableHead>Application</TableHead>
                      <TableHead>Endpoint</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Private key</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap text-xs">
                          {formatUtc(row.admittedAt)}
                        </TableCell>
                        <TableCell>{row.requestedResourceLabel}</TableCell>
                        <TableCell>
                          {applicationLabel(row.applicationTitle, row.applicationUrl)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{row.routeId}</TableCell>
                        <TableCell>{completionBadge(row)}</TableCell>
                        <TableCell>
                          {row.keyName}
                          <p className="font-mono text-xs text-muted-foreground">
                            {row.keyDisplayValue}
                          </p>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  </Table>
                </CardContent>
              </Card>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {logs.rows.length} private request occurrences
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={previousPage}
                    disabled={!pagination.history.length}
                  >
                    <ChevronLeft />Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={nextPage}
                    disabled={!logs.nextCursor}
                  >
                    Next<ChevronRight />
                  </Button>
                </div>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </AdminPageShell>
  );
}
