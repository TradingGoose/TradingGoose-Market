"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  CheckCircle2,
  Clock3,
  KeyRound,
  RefreshCw,
  TriangleAlert
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis
} from "recharts";

import { AccountPageHeader } from "@/components/account/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "@/components/ui/tabs";
import { useMarketResource } from "@/hooks/use-market-resource";
import type {
  ActivityResponse,
  UsageBreakdown,
  UsageSeriesPoint
} from "@/lib/account/contracts";
import { formatCount } from "@/lib/account/format";

type Metric = "requests" | "successes" | "errors";
type Group = "app" | "resource" | "endpoint" | "key";

const SERIES_COLORS = [
  "hsl(221 83% 53%)",
  "hsl(142 71% 45%)",
  "hsl(38 92% 50%)",
  "hsl(262 83% 58%)",
  "hsl(189 94% 43%)",
  "hsl(346 77% 50%)",
  "hsl(24 95% 53%)",
  "hsl(173 80% 40%)"
];

function SummaryCard({
  title,
  value,
  description,
  icon: Icon
}: {
  title: string;
  value: string;
  description: string;
  icon: typeof Activity;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function Ranking({ title, rows }: { title: string; rows: UsageBreakdown[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        {rows.length ? (
          <div className="space-y-3">
            {rows.slice(0, 8).map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-4">
                <span className="truncate text-sm">{row.label}</span>
                <span className="font-mono text-sm tabular-nums text-muted-foreground">
                  {formatCount(row.requests)}
                </span>
              </div>
            ))}
          </div>
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

function groupLabel(group: Group) {
  if (group === "app") return "application";
  if (group === "resource") return "requested resource";
  if (group === "endpoint") return "endpoint";
  return "API key";
}

function pivotSeries(series: UsageSeriesPoint[], metric: Metric) {
  const totals = new Map<string, { label: string; value: number }>();
  for (const point of series) {
    const total = totals.get(point.seriesId) ?? { label: point.seriesLabel, value: 0 };
    total.label = point.seriesLabel;
    total.value += point[metric];
    totals.set(point.seriesId, total);
  }

  const selected = [...totals.entries()]
    .sort((left, right) => right[1].value - left[1].value || left[1].label.localeCompare(right[1].label))
    .slice(0, SERIES_COLORS.length)
    .map(([id, total], index) => ({
      id,
      dataKey: `series${index}`,
      label: total.label,
      color: SERIES_COLORS[index]
    }));
  const selectedById = new Map(selected.map((item) => [item.id, item]));
  const byTimestamp = new Map<string, Record<string, string | number>>();
  for (const point of series) {
    const selectedSeries = selectedById.get(point.seriesId);
    if (!selectedSeries) continue;
    const row = byTimestamp.get(point.timestamp) ?? { timestamp: point.timestamp };
    row[selectedSeries.dataKey] = point[metric];
    byTimestamp.set(point.timestamp, row);
  }

  const points = [...byTimestamp.values()].sort((left, right) =>
    String(left.timestamp).localeCompare(String(right.timestamp))
  );
  const config = Object.fromEntries(
    selected.map((item) => [item.dataKey, { label: item.label, color: item.color }])
  ) as ChartConfig;
  const breakdown = selected.map((item) => ({
    id: item.id,
    label: item.label,
    requests: totals.get(item.id)?.value ?? 0
  }));

  return { points, lines: selected, config, breakdown };
}

export function ActivityPage() {
  const searchParams = useSearchParams();
  const [range, setRange] = useState("7d");
  const [keyId, setKeyId] = useState(searchParams.get("key") ?? "all");
  const [completion, setCompletion] = useState("all");
  const [resourceId, setResourceId] = useState("all");
  const [appUrl, setAppUrl] = useState("all");
  const [routeId, setRouteId] = useState("all");
  const [group, setGroup] = useState<Group>("app");
  const [metric, setMetric] = useState<Metric>("requests");

  const query = useMemo(() => {
    const params = new URLSearchParams({
      range,
      granularity: range === "24h" ? "hour" : "day",
      group,
      metric
    });
    if (keyId !== "all") params.set("key", keyId);
    if (completion !== "all") params.set("completion", completion);
    if (resourceId !== "all") params.set("resource", resourceId);
    if (appUrl !== "all") params.set("app", appUrl);
    if (routeId !== "all") params.set("route", routeId);
    return params.toString();
  }, [appUrl, completion, group, keyId, metric, range, resourceId, routeId]);

  const resource = useMarketResource<ActivityResponse>(`/api/account/activity?${query}`);
  const data = resource.data;
  const trendSeries = useMemo(
    () => pivotSeries(data?.series ?? [], "requests"),
    [data?.series]
  );
  const exploreSeries = useMemo(
    () => pivotSeries(data?.series ?? [], metric),
    [data?.series, metric]
  );
  const statusBuckets = useMemo(
    () => (data?.buckets ?? []).map((bucket) => ({
      ...bucket,
      pending: Math.max(0, bucket.requests - bucket.successes - bucket.errors)
    })),
    [data?.buckets]
  );

  const groupSelect = (
    <Select value={group} onValueChange={(value) => setGroup(value as Group)}>
      <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="app">Application</SelectItem>
        <SelectItem value="resource">Requested resource</SelectItem>
        <SelectItem value="endpoint">Endpoint</SelectItem>
        <SelectItem value="key">API key</SelectItem>
      </SelectContent>
    </Select>
  );

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6">
      <AccountPageHeader
        title="Activity"
        description="Aggregate Market request admissions and handler outcomes. All periods and timestamps use UTC."
        actions={(
          <>
            <Badge variant="outline" className="h-10 rounded-md px-3 text-sm font-normal text-muted-foreground">
              <Clock3 className="mr-2 size-4" />UTC
            </Badge>
            <Button
              variant="outline"
              onClick={() => void resource.refresh()}
              disabled={resource.isLoading}
            >
              <RefreshCw className={resource.isLoading ? "animate-spin" : ""} />
              Refresh
            </Button>
          </>
        )}
      />

      <div className="flex flex-wrap gap-2">
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["24h", "7d", "30d", "90d"].map((value) => (
              <SelectItem key={value} value={value}>{value} UTC</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={keyId} onValueChange={setKeyId}>
          <SelectTrigger className="w-44"><SelectValue placeholder="API key" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All API keys</SelectItem>
            {data?.facets.keys.map((item) => (
              <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={appUrl} onValueChange={setAppUrl}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Application" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All applications</SelectItem>
            {data?.facets.applications.map((item) => (
              <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={resourceId} onValueChange={setResourceId}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Requested resource" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All resources</SelectItem>
            {data?.facets.resources.map((item) => (
              <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={routeId} onValueChange={setRouteId}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Endpoint" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All endpoints</SelectItem>
            {data?.facets.endpoints.map((item) => (
              <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={completion} onValueChange={setCompletion}>
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

      {resource.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-32" />
          ))}
        </div>
      ) : resource.error ? (
        <Alert variant="destructive">
          <AlertDescription>Activity could not be loaded.</AlertDescription>
        </Alert>
      ) : !data || data.totalRequests === 0 ? (
        <Empty className="min-h-80">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Activity /></EmptyMedia>
            <EmptyTitle>No activity in this period</EmptyTitle>
            <EmptyDescription>
              Admitted customer-key requests appear here. Anonymous reads are not keyed usage.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="trends">Trends</TabsTrigger>
            <TabsTrigger value="explore">Explore</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryCard
                title="Request admissions"
                value={formatCount(data.totalRequests)}
                description={data.comparisonDeltaPercent === null
                  ? "No comparison period"
                  : `${data.comparisonDeltaPercent >= 0 ? "+" : ""}${data.comparisonDeltaPercent.toFixed(1)}% vs prior period`}
                icon={Activity}
              />
              <SummaryCard
                title="Completed successes"
                value={formatCount(data.completedSuccessCount)}
                description={`${data.totalRequests ? ((data.completedSuccessCount / data.totalRequests) * 100).toFixed(1) : "0.0"}% of admissions`}
                icon={CheckCircle2}
              />
              <SummaryCard
                title="Completed errors"
                value={formatCount(data.completedErrorCount)}
                description={`${formatCount(data.pendingCount)} pending outcomes`}
                icon={TriangleAlert}
              />
              <SummaryCard
                title="Active keys"
                value={formatCount(data.activeKeyCount)}
                description="Keys with activity in period"
                icon={KeyRound}
              />
            </div>
            <Card>
              <CardHeader>
                <CardTitle>UTC request volume</CardTitle>
                <CardDescription>Admissions and recorded completion outcomes.</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer
                  config={{
                    requests: { label: "Requests", color: "hsl(221 83% 53%)" },
                    successes: { label: "Successes", color: "hsl(142 71% 45%)" },
                    errors: { label: "Errors", color: "hsl(0 72% 51%)" }
                  }}
                  className="h-72 w-full aspect-auto"
                >
                  <LineChart data={data.buckets}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="timestamp" tickLine={false} axisLine={false} minTickGap={32} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line type="monotone" dataKey="requests" stroke="var(--color-requests)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="successes" stroke="var(--color-successes)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="errors" stroke="var(--color-errors)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ChartContainer>
              </CardContent>
            </Card>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Ranking title="Top API Keys" rows={data.topKeys} />
              <Ranking title="Top Applications" rows={data.topApplications} />
              <Ranking title="Top Requested Resources" rows={data.topResources} />
              <Ranking title="Top Endpoints" rows={data.topEndpoints} />
            </div>
          </TabsContent>

          <TabsContent value="trends" className="space-y-4">
            <div className="flex justify-end">{groupSelect}</div>
            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Requests by {groupLabel(group)}</CardTitle>
                  <CardDescription>Top bounded series over the selected UTC period.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={trendSeries.config} className="h-80 w-full aspect-auto">
                    <LineChart data={trendSeries.points}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="timestamp" tickLine={false} axisLine={false} minTickGap={32} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      {trendSeries.lines.map((line) => (
                        <Line key={line.id} type="monotone" dataKey={line.dataKey} name={line.label} stroke={line.color} strokeWidth={2} dot={false} />
                      ))}
                    </LineChart>
                  </ChartContainer>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Completion status</CardTitle>
                  <CardDescription>Success, error, and pending outcomes by UTC bucket.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ChartContainer
                    config={{
                      successes: { label: "Successes", color: "hsl(142 71% 45%)" },
                      errors: { label: "Errors", color: "hsl(0 72% 51%)" },
                      pending: { label: "Pending", color: "hsl(38 92% 50%)" }
                    }}
                    className="h-80 w-full aspect-auto"
                  >
                    <LineChart data={statusBuckets}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="timestamp" tickLine={false} axisLine={false} minTickGap={32} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Line type="monotone" dataKey="successes" stroke="var(--color-successes)" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="errors" stroke="var(--color-errors)" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="pending" stroke="var(--color-pending)" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="explore" className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Select value={metric} onValueChange={(value) => setMetric(value as Metric)}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="requests">Requests</SelectItem>
                  <SelectItem value="successes">Successes</SelectItem>
                  <SelectItem value="errors">Errors</SelectItem>
                </SelectContent>
              </Select>
              {groupSelect}
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <Ranking
                title={`${metric[0].toUpperCase()}${metric.slice(1)} by ${groupLabel(group)}`}
                rows={exploreSeries.breakdown}
              />
              <Card>
                <CardHeader>
                  <CardTitle>Selected series</CardTitle>
                  <CardDescription>
                    Server-bounded {metric} grouped by {groupLabel(group)}.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={exploreSeries.config} className="h-80 w-full aspect-auto">
                    <BarChart data={exploreSeries.points}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="timestamp" tickLine={false} axisLine={false} minTickGap={32} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      {exploreSeries.lines.map((line) => (
                        <Bar key={line.id} dataKey={line.dataKey} name={line.label} fill={line.color} stackId="series" />
                      ))}
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
