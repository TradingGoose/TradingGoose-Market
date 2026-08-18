import {
  marketApiKeys,
  marketApiUsageCompletion,
  marketApiUsageEvent,
  marketUsageOwner,
} from "@tradinggoose/db/schema";
import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { MarketDatabase } from "@tradinggoose/db";
import type { UsageFacets } from "@/lib/account/contracts";
import { requireDatabase } from "@/lib/db/runtime";
import { appDisplayName } from "./attribution";

const RESOURCE_LABELS: Record<string, string> = {
  market_instrument: "Market Instrument",
  city: "City",
  country: "Country",
  currency: "Currency",
  crypto: "Cryptocurrency",
  exchange: "Exchange",
  listing_identity: "Listing Identity",
  market_hour: "Market Hours",
  timezone: "Timezone",
};

const RANGE_MS = {
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000,
} as const;

type UsageScope =
  | { kind: "customer"; userId: string }
  | { kind: "admin" };

type UsageFacetRows = {
  keys: Array<{ id: string; name: string; displayValue: string }>;
  applications: Array<{ url: string | null; title: string | null }>;
  resources: Array<{ id: string }>;
  endpoints: Array<{ id: string }>;
};

export type UsageFilters = {
  range?: string | null;
  keyId?: string | null;
  appUrl?: string | null;
  routeId?: string | null;
  category?: string | null;
  resourceId?: string | null;
  completion?: string | null;
  cursor?: string | null;
  limit?: number;
  metric?: string | null;
  group?: string | null;
  granularity?: string | null;
};

export async function getCustomerActivity(userId: string, filters: UsageFilters) {
  return getActivity({ kind: "customer", userId }, filters);
}

export async function getAdminActivity(filters: UsageFilters) {
  return getActivity({ kind: "admin" }, filters);
}

export async function getCustomerLogs(userId: string, filters: UsageFilters) {
  return getLogs({ kind: "customer", userId }, filters);
}

export async function getAdminLogs(filters: UsageFilters) {
  return getLogs({ kind: "admin" }, filters);
}

async function getActivity(scope: UsageScope, filters: UsageFilters) {
  const database = requireDatabase();
  const range = parseRange(filters.range);
  const now = new Date();
  const rangeMs = RANGE_MS[range];
  const start = new Date(now.getTime() - rangeMs);
  const previousStart = new Date(start.getTime() - rangeMs);
  const conditions = usageConditions(scope, filters, start, now);

  const [aggregate] = await database
    .select({
      total: count(),
      activeKeys: countDistinct(marketApiUsageEvent.marketApiKeyId),
      successes: sql<number>`count(*) filter (where ${marketApiUsageCompletion.resultClass} = 'success')`,
      errors: sql<number>`count(*) filter (where ${marketApiUsageCompletion.resultClass} in ('client_error', 'server_error'))`,
      pending: sql<number>`count(*) filter (where ${marketApiUsageCompletion.eventId} is null)`,
    })
    .from(marketApiUsageEvent)
    .innerJoin(marketApiKeys, eq(marketApiKeys.id, marketApiUsageEvent.marketApiKeyId))
    .innerJoin(marketUsageOwner, eq(marketUsageOwner.id, marketApiUsageEvent.usageOwnerId))
    .leftJoin(
      marketApiUsageCompletion,
      eq(marketApiUsageCompletion.eventId, marketApiUsageEvent.id),
    )
    .where(and(...conditions));

  const [previousAggregate] = await database
    .select({ total: count() })
    .from(marketApiUsageEvent)
    .innerJoin(marketApiKeys, eq(marketApiKeys.id, marketApiUsageEvent.marketApiKeyId))
    .innerJoin(marketUsageOwner, eq(marketUsageOwner.id, marketApiUsageEvent.usageOwnerId))
    .leftJoin(
      marketApiUsageCompletion,
      eq(marketApiUsageCompletion.eventId, marketApiUsageEvent.id),
    )
    .where(and(...usageConditions(scope, filters, previousStart, start)));

  const bucketUnit = chooseBucketUnit(range, filters.granularity);
  const bucketTimestamp = utcBucketExpression(bucketUnit);
  const bucketRows = await database
    .select({
      timestamp: bucketTimestamp,
      requests: count(),
      successes: sql<number>`count(*) filter (where ${marketApiUsageCompletion.resultClass} = 'success')`,
      errors: sql<number>`count(*) filter (where ${marketApiUsageCompletion.resultClass} in ('client_error', 'server_error'))`,
    })
    .from(marketApiUsageEvent)
    .innerJoin(marketApiKeys, eq(marketApiKeys.id, marketApiUsageEvent.marketApiKeyId))
    .innerJoin(marketUsageOwner, eq(marketUsageOwner.id, marketApiUsageEvent.usageOwnerId))
    .leftJoin(
      marketApiUsageCompletion,
      eq(marketApiUsageCompletion.eventId, marketApiUsageEvent.id),
    )
    .where(and(...conditions))
    .groupBy(bucketTimestamp)
    .orderBy(bucketTimestamp);
  const facets = await getUsageFacets(scope, start, now);

  const keyCount = count();
  const keyRows = await database
    .select({
      id: marketApiKeys.id,
      name: marketApiKeys.name,
      displayValue: marketApiKeys.displayValue,
      requests: keyCount,
    })
    .from(marketApiUsageEvent)
    .innerJoin(marketApiKeys, eq(marketApiKeys.id, marketApiUsageEvent.marketApiKeyId))
    .innerJoin(marketUsageOwner, eq(marketUsageOwner.id, marketApiUsageEvent.usageOwnerId))
    .leftJoin(
      marketApiUsageCompletion,
      eq(marketApiUsageCompletion.eventId, marketApiUsageEvent.id),
    )
    .where(and(...conditions))
    .groupBy(marketApiKeys.id, marketApiKeys.name, marketApiKeys.displayValue)
    .orderBy(desc(keyCount), asc(marketApiKeys.id))
    .limit(10);

  const applicationCount = count();
  const latestApplicationTitle = latestApplicationTitleExpression();
  const applicationRows = await database
    .select({
      url: marketApiUsageEvent.applicationUrl,
      title: latestApplicationTitle,
      requests: applicationCount,
    })
    .from(marketApiUsageEvent)
    .innerJoin(marketApiKeys, eq(marketApiKeys.id, marketApiUsageEvent.marketApiKeyId))
    .innerJoin(marketUsageOwner, eq(marketUsageOwner.id, marketApiUsageEvent.usageOwnerId))
    .leftJoin(
      marketApiUsageCompletion,
      eq(marketApiUsageCompletion.eventId, marketApiUsageEvent.id),
    )
    .where(and(...conditions))
    .groupBy(marketApiUsageEvent.applicationUrl)
    .orderBy(
      desc(applicationCount),
      asc(sql`coalesce(${marketApiUsageEvent.applicationUrl}, '')`),
    )
    .limit(10);

  const resourceCount = count();
  const resourceRows = await database
    .select({ id: marketApiUsageEvent.resourceId, requests: resourceCount })
    .from(marketApiUsageEvent)
    .innerJoin(marketApiKeys, eq(marketApiKeys.id, marketApiUsageEvent.marketApiKeyId))
    .innerJoin(marketUsageOwner, eq(marketUsageOwner.id, marketApiUsageEvent.usageOwnerId))
    .leftJoin(
      marketApiUsageCompletion,
      eq(marketApiUsageCompletion.eventId, marketApiUsageEvent.id),
    )
    .where(and(...conditions))
    .groupBy(marketApiUsageEvent.resourceId)
    .orderBy(desc(resourceCount), asc(marketApiUsageEvent.resourceId))
    .limit(10);

  const endpointCount = count();
  const endpointRows = await database
    .select({ id: marketApiUsageEvent.routeId, requests: endpointCount })
    .from(marketApiUsageEvent)
    .innerJoin(marketApiKeys, eq(marketApiKeys.id, marketApiUsageEvent.marketApiKeyId))
    .innerJoin(marketUsageOwner, eq(marketUsageOwner.id, marketApiUsageEvent.usageOwnerId))
    .leftJoin(
      marketApiUsageCompletion,
      eq(marketApiUsageCompletion.eventId, marketApiUsageEvent.id),
    )
    .where(and(...conditions))
    .groupBy(marketApiUsageEvent.routeId)
    .orderBy(desc(endpointCount), asc(marketApiUsageEvent.routeId))
    .limit(10);

  const group = parseGroup(filters.group);
  const topSeries = await selectTopActivitySeries(
    database,
    conditions,
    group,
    parseMetric(filters.metric),
  );
  const topSeriesIds = topSeries.map((row) => row.id);
  const seriesLabels = new Map(topSeries.map((row) => [row.id, row.label]));
  const seriesId =
    group === "app"
      ? sql<string>`coalesce(${marketApiUsageEvent.applicationUrl}, '__unattributed__')`
      : group === "key"
        ? sql<string>`${marketApiKeys.id}`
        : group === "endpoint"
          ? sql<string>`${marketApiUsageEvent.routeId}`
          : sql<string>`${marketApiUsageEvent.resourceId}`;
  const seriesRows =
    topSeriesIds.length === 0
      ? []
      : await database
          .select({
            timestamp: bucketTimestamp,
            seriesId,
            requests: count(),
            successes: sql<number>`count(*) filter (where ${marketApiUsageCompletion.resultClass} = 'success')`,
            errors: sql<number>`count(*) filter (where ${marketApiUsageCompletion.resultClass} in ('client_error', 'server_error'))`,
          })
          .from(marketApiUsageEvent)
          .innerJoin(
            marketApiKeys,
            eq(marketApiKeys.id, marketApiUsageEvent.marketApiKeyId),
          )
          .innerJoin(
            marketUsageOwner,
            eq(marketUsageOwner.id, marketApiUsageEvent.usageOwnerId),
          )
          .leftJoin(
            marketApiUsageCompletion,
            eq(marketApiUsageCompletion.eventId, marketApiUsageEvent.id),
          )
          .where(and(...conditions, inArray(seriesId, topSeriesIds)))
          .groupBy(bucketTimestamp, seriesId)
          .orderBy(bucketTimestamp, seriesId);
  const currentTotal = Number(aggregate?.total ?? 0);
  const previousTotal = Number(previousAggregate?.total ?? 0);
  return {
    totalRequests: currentTotal,
    completedSuccessCount: Number(aggregate?.successes ?? 0),
    completedErrorCount: Number(aggregate?.errors ?? 0),
    pendingCount: Number(aggregate?.pending ?? 0),
    activeKeyCount: Number(aggregate?.activeKeys ?? 0),
    comparisonDeltaPercent:
      previousTotal === 0
        ? null
        : ((currentTotal - previousTotal) / previousTotal) * 100,
    buckets: bucketRows.map((row) => ({
      timestamp: row.timestamp,
      requests: Number(row.requests),
      successes: Number(row.successes),
      errors: Number(row.errors),
    })),
    topKeys: keyRows.map((row) => ({
      id: row.id,
      label: row.name || row.displayValue,
      requests: Number(row.requests),
    })),
    topApplications: applicationRows.map((row) => ({
      id: row.url ?? "Unattributed",
      label: appDisplayName({ url: row.url, title: row.title }),
      requests: Number(row.requests),
    })),
    topResources: resourceRows.map((row) => ({
      id: row.id,
      label: RESOURCE_LABELS[row.id] ?? row.id,
      requests: Number(row.requests),
    })),
    topEndpoints: endpointRows.map((row) => ({
      id: row.id,
      label: row.id,
      requests: Number(row.requests),
    })),
    series: seriesRows.map((entry) => ({
        timestamp: entry.timestamp,
        seriesId: entry.seriesId === "__unattributed__" ? "Unattributed" : entry.seriesId,
        requests: Number(entry.requests),
        successes: Number(entry.successes),
        errors: Number(entry.errors),
        seriesLabel: seriesDisplayLabel(
          entry.seriesId,
          seriesLabels,
        ),
      })),
    facets,
  };
}

async function selectTopActivitySeries(
  database: MarketDatabase,
  conditions: SQL[],
  group: "app" | "resource" | "endpoint" | "key",
  metric: "requests" | "successes" | "errors",
): Promise<Array<{ id: string; label: string }>> {
  const metricCount = activityMetricCount(metric);

  if (group === "key") {
    const rows = await database.select({
      id: marketApiKeys.id,
      name: marketApiKeys.name,
      displayValue: marketApiKeys.displayValue,
      metric: metricCount,
    })
      .from(marketApiUsageEvent)
      .innerJoin(marketApiKeys, eq(marketApiKeys.id, marketApiUsageEvent.marketApiKeyId))
      .innerJoin(marketUsageOwner, eq(marketUsageOwner.id, marketApiUsageEvent.usageOwnerId))
      .leftJoin(
        marketApiUsageCompletion,
        eq(marketApiUsageCompletion.eventId, marketApiUsageEvent.id),
      )
      .where(and(...conditions))
      .groupBy(marketApiKeys.id, marketApiKeys.name, marketApiKeys.displayValue)
      .orderBy(desc(metricCount), asc(marketApiKeys.id))
      .limit(10);
    return rows.map((row) => ({ id: row.id, label: row.name || row.displayValue }));
  }

  if (group === "app") {
    const id = sql<string>`coalesce(${marketApiUsageEvent.applicationUrl}, '__unattributed__')`;
    const rows = await database.select({
      id,
      url: marketApiUsageEvent.applicationUrl,
      title: latestApplicationTitleExpression(),
      metric: metricCount,
    })
      .from(marketApiUsageEvent)
      .innerJoin(marketApiKeys, eq(marketApiKeys.id, marketApiUsageEvent.marketApiKeyId))
      .innerJoin(marketUsageOwner, eq(marketUsageOwner.id, marketApiUsageEvent.usageOwnerId))
      .leftJoin(
        marketApiUsageCompletion,
        eq(marketApiUsageCompletion.eventId, marketApiUsageEvent.id),
      )
      .where(and(...conditions))
      .groupBy(marketApiUsageEvent.applicationUrl)
      .orderBy(desc(metricCount), asc(id))
      .limit(10);
    return rows.map((row) => ({
      id: row.id,
      label: appDisplayName({ url: row.url, title: row.title }),
    }));
  }

  if (group === "endpoint") {
    const rows = await database.select({
      id: marketApiUsageEvent.routeId,
      metric: metricCount,
    })
      .from(marketApiUsageEvent)
      .innerJoin(marketApiKeys, eq(marketApiKeys.id, marketApiUsageEvent.marketApiKeyId))
      .innerJoin(marketUsageOwner, eq(marketUsageOwner.id, marketApiUsageEvent.usageOwnerId))
      .leftJoin(
        marketApiUsageCompletion,
        eq(marketApiUsageCompletion.eventId, marketApiUsageEvent.id),
      )
      .where(and(...conditions))
      .groupBy(marketApiUsageEvent.routeId)
      .orderBy(desc(metricCount), asc(marketApiUsageEvent.routeId))
      .limit(10);
    return rows.map((row) => ({ id: row.id, label: row.id }));
  }

  const rows = await database.select({
    id: marketApiUsageEvent.resourceId,
    metric: metricCount,
  })
    .from(marketApiUsageEvent)
    .innerJoin(marketApiKeys, eq(marketApiKeys.id, marketApiUsageEvent.marketApiKeyId))
    .innerJoin(marketUsageOwner, eq(marketUsageOwner.id, marketApiUsageEvent.usageOwnerId))
    .leftJoin(
      marketApiUsageCompletion,
      eq(marketApiUsageCompletion.eventId, marketApiUsageEvent.id),
    )
    .where(and(...conditions))
    .groupBy(marketApiUsageEvent.resourceId)
    .orderBy(desc(metricCount), asc(marketApiUsageEvent.resourceId))
    .limit(10);
  return rows.map((row) => ({
    id: row.id,
    label: RESOURCE_LABELS[row.id] ?? row.id,
  }));
}

function activityMetricCount(metric: "requests" | "successes" | "errors") {
  if (metric === "successes") {
    return sql<number>`count(*) filter (where ${marketApiUsageCompletion.resultClass} = 'success')`;
  }
  if (metric === "errors") {
    return sql<number>`count(*) filter (where ${marketApiUsageCompletion.resultClass} in ('client_error', 'server_error'))`;
  }
  return count();
}

async function getLogs(scope: UsageScope, filters: UsageFilters) {
  const database = requireDatabase();
  const range = parseRange(filters.range);
  const now = new Date();
  const start = new Date(now.getTime() - RANGE_MS[range]);
  const limit = Number.isSafeInteger(filters.limit)
    ? Math.max(1, Math.min(100, filters.limit!))
    : 50;
  const baseConditions = usageConditions(scope, filters, start, now);
  const facets = await getUsageFacets(scope, start, now);
  const histogramTimestamp = utcBucketExpression("hour");
  const histogramRows = await database
    .select({
      timestamp: histogramTimestamp,
      requests: count(),
      successes: sql<number>`count(*) filter (where ${marketApiUsageCompletion.resultClass} = 'success')`,
      errors: sql<number>`count(*) filter (where ${marketApiUsageCompletion.resultClass} in ('client_error', 'server_error'))`,
    })
    .from(marketApiUsageEvent)
    .innerJoin(marketApiKeys, eq(marketApiKeys.id, marketApiUsageEvent.marketApiKeyId))
    .innerJoin(marketUsageOwner, eq(marketUsageOwner.id, marketApiUsageEvent.usageOwnerId))
    .leftJoin(
      marketApiUsageCompletion,
      eq(marketApiUsageCompletion.eventId, marketApiUsageEvent.id),
    )
    .where(and(...baseConditions))
    .groupBy(histogramTimestamp)
    .orderBy(histogramTimestamp);
  const conditions = [...baseConditions];
  const cursor = decodeCursor(filters.cursor);
  if (cursor) {
    conditions.push(
      or(
        lt(marketApiUsageEvent.admittedAt, cursor.admittedAt),
        and(
          eq(marketApiUsageEvent.admittedAt, cursor.admittedAt),
          lt(marketApiUsageEvent.id, cursor.id),
        ),
      )!,
    );
  }
  const rows = await database
    .select({
      id: marketApiUsageEvent.id,
      admittedAt: marketApiUsageEvent.admittedAt,
      resourceId: marketApiUsageEvent.resourceId,
      routeId: marketApiUsageEvent.routeId,
      category: marketApiUsageEvent.category,
      method: marketApiUsageEvent.method,
      version: marketApiUsageEvent.apiVersion,
      applicationUrl: marketApiUsageEvent.applicationUrl,
      applicationTitle: marketApiUsageEvent.applicationTitle,
      keyId: marketApiKeys.id,
      keyName: marketApiKeys.name,
      keyDisplay: marketApiKeys.displayValue,
      keyRevocationRequestedAt: marketApiKeys.revocationRequestedAt,
      keyProviderRevokedAt: marketApiKeys.providerRevokedAt,
      resultClass: marketApiUsageCompletion.resultClass,
      httpStatus: marketApiUsageCompletion.httpStatus,
      completedAt: marketApiUsageCompletion.completedAt,
    })
    .from(marketApiUsageEvent)
    .innerJoin(marketApiKeys, eq(marketApiKeys.id, marketApiUsageEvent.marketApiKeyId))
    .innerJoin(marketUsageOwner, eq(marketUsageOwner.id, marketApiUsageEvent.usageOwnerId))
    .leftJoin(
      marketApiUsageCompletion,
      eq(marketApiUsageCompletion.eventId, marketApiUsageEvent.id),
    )
    .where(and(...conditions))
    .orderBy(desc(marketApiUsageEvent.admittedAt), desc(marketApiUsageEvent.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    rows: page.map((row) => ({
      id: row.id,
      admittedAt: row.admittedAt.toISOString(),
      requestedResourceId: row.resourceId,
      requestedResourceLabel: RESOURCE_LABELS[row.resourceId] ?? row.resourceId,
      routeId: row.routeId,
      category: row.category,
      method: row.method,
      version: row.version,
      applicationUrl: row.applicationUrl,
      applicationTitle: row.applicationTitle,
      keyId: row.keyId,
      keyName: row.keyName,
      keyDisplayValue: row.keyDisplay,
      keyStatus: row.keyProviderRevokedAt
        ? "revoked"
        : row.keyRevocationRequestedAt
          ? "revocation_pending"
          : "available",
      completionStatus: row.resultClass ?? "pending",
      httpStatus: row.httpStatus,
      completedAt: row.completedAt?.toISOString() ?? null,
    })),
    histogram: histogramRows.map((row) => ({
      timestamp: row.timestamp,
      requests: Number(row.requests),
      successes: Number(row.successes),
      errors: Number(row.errors),
    })),
    nextCursor: hasMore && last ? encodeCursor(last.admittedAt, last.id) : null,
    facets,
  };
}

async function getUsageFacets(
  scope: UsageScope,
  start: Date,
  end: Date,
): Promise<UsageFacets> {
  const database = requireDatabase();
  const conditions = usageConditions(scope, {}, start, end);
  const keyRows = await database
    .select({
      id: marketApiKeys.id,
      name: marketApiKeys.name,
      displayValue: marketApiKeys.displayValue,
    })
    .from(marketApiUsageEvent)
    .innerJoin(marketApiKeys, eq(marketApiKeys.id, marketApiUsageEvent.marketApiKeyId))
    .innerJoin(marketUsageOwner, eq(marketUsageOwner.id, marketApiUsageEvent.usageOwnerId))
    .where(and(...conditions))
    .groupBy(marketApiKeys.id, marketApiKeys.name, marketApiKeys.displayValue);
  const applicationRows = await database
    .select({
      url: marketApiUsageEvent.applicationUrl,
      title: latestApplicationTitleExpression(),
    })
    .from(marketApiUsageEvent)
    .innerJoin(marketApiKeys, eq(marketApiKeys.id, marketApiUsageEvent.marketApiKeyId))
    .innerJoin(marketUsageOwner, eq(marketUsageOwner.id, marketApiUsageEvent.usageOwnerId))
    .where(and(...conditions))
    .groupBy(marketApiUsageEvent.applicationUrl);
  const resourceRows = await database
    .select({ id: marketApiUsageEvent.resourceId })
    .from(marketApiUsageEvent)
    .innerJoin(marketApiKeys, eq(marketApiKeys.id, marketApiUsageEvent.marketApiKeyId))
    .innerJoin(marketUsageOwner, eq(marketUsageOwner.id, marketApiUsageEvent.usageOwnerId))
    .where(and(...conditions))
    .groupBy(marketApiUsageEvent.resourceId);
  const endpointRows = await database
    .select({ id: marketApiUsageEvent.routeId })
    .from(marketApiUsageEvent)
    .innerJoin(marketApiKeys, eq(marketApiKeys.id, marketApiUsageEvent.marketApiKeyId))
    .innerJoin(marketUsageOwner, eq(marketUsageOwner.id, marketApiUsageEvent.usageOwnerId))
    .where(and(...conditions))
    .groupBy(marketApiUsageEvent.routeId);

  return buildUsageFacets({
    keys: keyRows,
    applications: applicationRows,
    resources: resourceRows,
    endpoints: endpointRows,
  });
}

export function buildUsageFacets(rows: UsageFacetRows): UsageFacets {
  return {
    keys: rows.keys
      .map((row) => ({ id: row.id, label: row.name || row.displayValue }))
      .sort(compareFacet),
    applications: rows.applications
      .map((row) => ({
        id: row.url ?? "Unattributed",
        label: appDisplayName({ url: row.url, title: row.title }),
      }))
      .sort(compareFacet),
    resources: rows.resources
      .map((row) => ({ id: row.id, label: RESOURCE_LABELS[row.id] ?? row.id }))
      .sort(compareFacet),
    endpoints: rows.endpoints
      .map((row) => ({ id: row.id, label: row.id }))
      .sort(compareFacet),
  };
}

function compareFacet(
  left: { id: string; label: string },
  right: { id: string; label: string },
) {
  return left.label.localeCompare(right.label) || left.id.localeCompare(right.id);
}

function latestApplicationTitleExpression() {
  return sql<string | null>`(
    array_agg(
      ${marketApiUsageEvent.applicationTitle}
      order by ${marketApiUsageEvent.admittedAt} desc, ${marketApiUsageEvent.id} desc
    ) filter (where ${marketApiUsageEvent.applicationTitle} is not null)
  )[1]`;
}

function usageConditions(
  scope: UsageScope,
  filters: UsageFilters,
  start: Date,
  end: Date,
): SQL[] {
  const conditions: SQL[] = [
    gte(marketApiUsageEvent.admittedAt, start),
    lt(marketApiUsageEvent.admittedAt, end),
  ];
  if (scope.kind === "customer") {
    conditions.push(eq(marketUsageOwner.userId, scope.userId));
    conditions.push(eq(marketApiUsageEvent.keyClass, "public"));
  } else {
    conditions.push(eq(marketApiUsageEvent.keyClass, "private"));
  }
  if (filters.keyId) conditions.push(eq(marketApiUsageEvent.marketApiKeyId, filters.keyId));
  if (filters.appUrl === "Unattributed") conditions.push(isNull(marketApiUsageEvent.applicationUrl));
  else if (filters.appUrl) conditions.push(eq(marketApiUsageEvent.applicationUrl, filters.appUrl));
  if (filters.routeId) conditions.push(eq(marketApiUsageEvent.routeId, filters.routeId));
  if (filters.category) conditions.push(eq(marketApiUsageEvent.category, filters.category));
  if (filters.resourceId) conditions.push(eq(marketApiUsageEvent.resourceId, filters.resourceId));
  if (filters.completion === "pending") conditions.push(isNull(marketApiUsageCompletion.eventId));
  else if (filters.completion && ["success", "client_error", "server_error"].includes(filters.completion)) {
    conditions.push(eq(marketApiUsageCompletion.resultClass, filters.completion));
  }
  return conditions;
}

function parseRange(value: string | null | undefined): keyof typeof RANGE_MS {
  return value && Object.hasOwn(RANGE_MS, value) ? (value as keyof typeof RANGE_MS) : "30d";
}

function parseGroup(value: string | null | undefined) {
  return ["app", "resource", "endpoint", "key"].includes(value ?? "")
    ? (value as "app" | "resource" | "endpoint" | "key")
    : "resource";
}

function parseMetric(value: string | null | undefined) {
  return value === "successes" || value === "errors" ? value : "requests";
}

function chooseBucketUnit(
  range: keyof typeof RANGE_MS,
  requested: string | null | undefined,
) {
  const allowed = requested === "hour" || requested === "day" ? requested : null;
  return allowed ?? (range === "24h" ? "hour" : "day");
}

function utcBucketExpression(unit: "hour" | "day") {
  const literal = sql.raw(unit === "hour" ? "'hour'" : "'day'");
  return sql<string>`to_char(date_trunc(${literal}, ${marketApiUsageEvent.admittedAt} at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
}

function seriesDisplayLabel(
  id: string,
  labels: Map<string, string>,
) {
  return labels.get(id) ?? (id === "__unattributed__" ? "Unattributed" : id);
}

function encodeCursor(admittedAt: Date, id: string) {
  return Buffer.from(JSON.stringify({ admittedAt: admittedAt.toISOString(), id })).toString(
    "base64url",
  );
}

function decodeCursor(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      admittedAt?: unknown;
      id?: unknown;
    };
    if (typeof parsed.admittedAt !== "string" || typeof parsed.id !== "string") return null;
    const admittedAt = new Date(parsed.admittedAt);
    if (Number.isNaN(admittedAt.getTime()) || !parsed.id) return null;
    return { admittedAt, id: parsed.id };
  } catch {
    return null;
  }
}
