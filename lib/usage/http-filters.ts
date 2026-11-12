import { MARKET_API_ROUTE_MANIFEST } from "@/lib/market-api/core/manifest";
import { parseMarketAppAttribution } from "./attribution";
import type { UsageFilters } from "./queries";

const RANGES = new Set(["24h", "7d", "30d", "90d"]);
const COMPLETIONS = new Set(["success", "client_error", "server_error", "pending"]);
const GRANULARITIES = new Set(["hour", "day"]);
const GROUPS = new Set(["app", "resource", "endpoint", "key"]);
const METRICS = new Set(["requests", "successes", "errors"]);
const KEYED_ROUTES = MARKET_API_ROUTE_MANIFEST.filter((descriptor) => descriptor.keyed);
const ROUTE_IDS = new Set(KEYED_ROUTES.map((descriptor) => descriptor.id));
const CATEGORIES = new Set(KEYED_ROUTES.map((descriptor) => descriptor.category));
const RESOURCE_IDS = new Set(KEYED_ROUTES.map((descriptor) => descriptor.resource.id));
const COMMON_PARAMETERS = new Set([
  "range",
  "key",
  "app",
  "route",
  "category",
  "resource",
  "completion",
]);

export class UsageFilterInputError extends Error {
  override readonly name = "UsageFilterInputError";
}

export function parseUsageFilters(
  url: URL,
  mode: "activity" | "logs",
  options: { allowView?: boolean } = {},
): UsageFilters {
  const allowed = new Set(COMMON_PARAMETERS);
  if (mode === "activity") {
    allowed.add("granularity");
    allowed.add("group");
    allowed.add("metric");
  } else {
    allowed.add("cursor");
    allowed.add("limit");
  }
  if (options.allowView) allowed.add("view");

  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) throw invalid(`Unsupported usage filter: ${key}`);
    if (url.searchParams.getAll(key).length !== 1) {
      throw invalid(`Usage filter must be provided once: ${key}`);
    }
  }

  const range = optionalEnum(url, "range", RANGES);
  const routeId = optionalEnum(url, "route", ROUTE_IDS);
  const category = optionalEnum(url, "category", CATEGORIES);
  const resourceId = optionalEnum(url, "resource", RESOURCE_IDS);
  const completion = optionalEnum(url, "completion", COMPLETIONS);
  const keyId = optionalBounded(url, "key", 128);
  const appUrl = optionalApplication(url);

  if (mode === "activity") {
    return {
      range,
      keyId,
      appUrl,
      routeId,
      category,
      resourceId,
      completion,
      granularity: optionalEnum(url, "granularity", GRANULARITIES),
      group: optionalEnum(url, "group", GROUPS),
      metric: optionalEnum(url, "metric", METRICS),
    };
  }

  return {
    range,
    keyId,
    appUrl,
    routeId,
    category,
    resourceId,
    completion,
    cursor: optionalCursor(url),
    limit: optionalLimit(url),
  };
}

function optionalEnum(
  url: URL,
  name: string,
  allowed: ReadonlySet<string>,
): string | null {
  const value = url.searchParams.get(name);
  if (value === null) return null;
  if (!allowed.has(value)) throw invalid(`Invalid ${name} filter`);
  return value;
}

function optionalBounded(url: URL, name: string, maxLength: number): string | null {
  const value = url.searchParams.get(name);
  if (value === null) return null;
  if (!value || value.length > maxLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw invalid(`Invalid ${name} filter`);
  }
  return value;
}

function optionalApplication(url: URL): string | null {
  const value = url.searchParams.get("app");
  if (value === null) return null;
  if (value === "Unattributed") return value;
  const attribution = parseMarketAppAttribution(
    new Headers({ "HTTP-Referer": value }),
  );
  if (attribution.url !== value) throw invalid("Invalid app filter");
  return value;
}

function optionalLimit(url: URL): number | undefined {
  const value = url.searchParams.get("limit");
  if (value === null) return undefined;
  if (!/^\d+$/u.test(value)) throw invalid("Invalid limit filter");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
    throw invalid("Invalid limit filter");
  }
  return parsed;
}

function optionalCursor(url: URL): string | null {
  const value = url.searchParams.get("cursor");
  if (value === null) return null;
  if (!value || value.length > 4_096) throw invalid("Invalid cursor");
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      admittedAt?: unknown;
      id?: unknown;
    };
    if (
      typeof parsed.admittedAt !== "string" ||
      Number.isNaN(new Date(parsed.admittedAt).getTime()) ||
      typeof parsed.id !== "string" ||
      !parsed.id ||
      parsed.id.length > 128
    ) {
      throw invalid("Invalid cursor");
    }
    return value;
  } catch (error) {
    if (error instanceof UsageFilterInputError) throw error;
    throw invalid("Invalid cursor");
  }
}

function invalid(message: string) {
  return new UsageFilterInputError(message);
}
