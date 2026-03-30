export const LISTING_ASSET_CLASSES = ["stock", "etf", "indice", "mutualfund", "future"] as const;
export const SUPPORTED_ASSET_CLASSES = new Set([...LISTING_ASSET_CLASSES, "crypto", "currency"]);

export type ParsedSearchQuery = {
  assetClass?: string;
  baseQuery?: string;
  quoteQuery?: string;
  region?: string;
};

export type ParsedFilters = {
  assetClasses: string[];
  regions: string[];
  micTokens: string[];
  marketTokens: string[];
  chainTokens: string[];
  limit: string | null;
};

export function parsePositiveInt(value: string | null | undefined, fallback: number, max?: number) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.max(Math.floor(parsed), 1);
  if (typeof max === "number") return Math.min(normalized, max);
  return normalized;
}

export function uniqueNonEmpty(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function parseListParam(searchParams: URLSearchParams, key: string) {
  const rawValues = [
    ...searchParams.getAll(key),
    ...searchParams.getAll(`${key}[]`)
  ];
  if (!rawValues.length) return [];

  const tokens: string[] = [];
  for (const raw of rawValues) {
    if (!raw) continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const pushToken = (value: string) => {
      const cleaned = value.trim().replace(/^['"]|['"]$/g, "");
      if (cleaned) tokens.push(cleaned);
    };

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item === null || item === undefined) continue;
            pushToken(String(item));
          }
          continue;
        }
      } catch {
        // Fall through to manual parsing.
      }
      const inner = trimmed.slice(1, -1);
      if (inner) {
        inner.split(",").forEach((value) => pushToken(value));
      }
      continue;
    }

    if (trimmed.includes(",")) {
      trimmed.split(",").forEach((value) => pushToken(value));
      continue;
    }

    pushToken(trimmed);
  }

  return uniqueNonEmpty(tokens);
}

function parseListFromString(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const tokens: string[] = [];
  const pushToken = (value: string) => {
    const cleaned = value.trim().replace(/^['"]|['"]$/g, "");
    if (cleaned) tokens.push(cleaned);
  };

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        parsed.forEach((item) => {
          if (item === null || item === undefined) return;
          pushToken(String(item));
        });
        return uniqueNonEmpty(tokens);
      }
    } catch {
      // Fall through to manual parsing.
    }
    const inner = trimmed.slice(1, -1);
    if (inner) {
      inner.split(",").forEach((value) => pushToken(value));
    }
    return uniqueNonEmpty(tokens);
  }

  if (trimmed.includes(",")) {
    trimmed.split(",").forEach((value) => pushToken(value));
    return uniqueNonEmpty(tokens);
  }

  pushToken(trimmed);
  return uniqueNonEmpty(tokens);
}

function parseListFromUnknown(value: unknown) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return uniqueNonEmpty(
      value.map((item) => String(item).trim()).filter((item) => item.length > 0)
    );
  }
  if (typeof value === "string") {
    return parseListFromString(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  return [];
}

export function parseFiltersParam(searchParams: URLSearchParams): ParsedFilters {
  const rawFilters = searchParams.get("filters");
  let parsedFilters: Record<string, unknown> = {};
  if (rawFilters) {
    try {
      const parsed = JSON.parse(rawFilters);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        parsedFilters = parsed as Record<string, unknown>;
      }
    } catch {
      // Ignore invalid JSON; fall back to empty filters.
    }
  }

  const assetClasses = uniqueNonEmpty(parseListFromUnknown(parsedFilters.asset_class));
  const regions = uniqueNonEmpty(parseListFromUnknown(parsedFilters.region));
  const micTokens = uniqueNonEmpty(parseListFromUnknown(parsedFilters.mic));
  const marketTokens = uniqueNonEmpty(parseListFromUnknown(parsedFilters.market));
  const chainTokens = uniqueNonEmpty(parseListFromUnknown(parsedFilters.chain));

  let limit: string | null = null;
  const rawLimit = parsedFilters.limit;
  if (typeof rawLimit === "number" && Number.isFinite(rawLimit)) {
    limit = String(rawLimit);
  } else if (typeof rawLimit === "string") {
    limit = rawLimit;
  }

  return { assetClasses, regions, micTokens, marketTokens, chainTokens, limit };
}

function normalizeAssetPrefix(value: string) {
  const normalized = value.trim().toLowerCase();
  return SUPPORTED_ASSET_CLASSES.has(normalized) ? normalized : null;
}

export function parseSearchQuery(rawValue?: string | null): ParsedSearchQuery {
  const trimmed = rawValue?.trim();
  if (!trimmed) return {};

  let working = trimmed;
  let assetClass: string | undefined;
  let region: string | undefined;

  const regionPrefixMatch = working.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (regionPrefixMatch) {
    region = regionPrefixMatch[1].trim();
    working = (regionPrefixMatch[2] ?? "").trim();
  }

  const prefixMatch = working.match(/^([A-Za-z]+)\s*:\s*(.*)$/);
  if (prefixMatch) {
    const mapped = normalizeAssetPrefix(prefixMatch[1]);
    if (mapped) {
      assetClass = mapped;
      working = (prefixMatch[2] ?? "").trim();
    }
  }

  if (!region) {
    const regionMatch = working.match(/\[([^\]]+)\]\s*$/);
    if (regionMatch) {
      region = regionMatch[1].trim();
      const index = regionMatch.index ?? working.length;
      working = working.slice(0, index).trim();
    }
  }

  let baseQuery: string | undefined;
  let quoteQuery: string | undefined;
  const slashIndex = working.indexOf("/");
  if (slashIndex >= 0) {
    const base = working.slice(0, slashIndex).trim();
    const quote = working.slice(slashIndex + 1).trim();
    if (base) baseQuery = base;
    if (quote) quoteQuery = quote;
  } else if (working) {
    baseQuery = working;
  }

  return { assetClass, baseQuery, quoteQuery, region };
}

export function expandAssetClasses(values: string[]) {
  const expanded = new Set<string>();
  for (const raw of values) {
    const normalized = raw.trim().toLowerCase();
    if (SUPPORTED_ASSET_CLASSES.has(normalized)) {
      expanded.add(normalized);
    }
  }
  return Array.from(expanded);
}
