import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildUsageFacets } from "./queries";

describe("usage query response contracts", () => {
  it("keeps complete filter facets separate from bounded rankings", () => {
    const facets = buildUsageFacets({
      keys: Array.from({ length: 12 }, (_, index) => ({
        id: `key-${String(index).padStart(2, "0")}`,
        name: index === 0 ? "Revoked historical key" : `Key ${index}`,
        displayValue: `market_...${index}`,
      })).reverse(),
      applications: [
        { url: null, title: null },
        { url: "https://example.com/app", title: "Example App" },
      ],
      resources: [{ id: "market_hour" }, { id: "listing_identity" }],
      endpoints: [
        { id: "public.search.listings" },
        { id: "public.get.market-hours" },
      ],
    });

    expect(facets.keys).toHaveLength(12);
    expect(facets.keys).toContainEqual({
      id: "key-00",
      label: "Revoked historical key",
    });
    expect(facets.applications).toContainEqual({
      id: "Unattributed",
      label: "Unattributed",
    });
    expect(facets.resources).toContainEqual({
      id: "market_hour",
      label: "Market Hours",
    });
    expect(facets.endpoints.map((facet) => facet.id)).toEqual([
      "public.get.market-hours",
      "public.search.listings",
    ]);
  });

  it("counts keys from distinct selected usage events, not current inventory", () => {
    const source = readFileSync(new URL("./queries.ts", import.meta.url), "utf8");
    expect(source).toContain(
      "activeKeys: countDistinct(marketApiUsageEvent.marketApiKeyId)",
    );
    expect(source).toContain("activeKeyCount: Number(aggregate?.activeKeys ?? 0)");
    expect(source).not.toContain("activeKeyConditions");
  });

  it("builds facets from the owner-scoped selected range without a top-ten cap", () => {
    const source = readFileSync(new URL("./queries.ts", import.meta.url), "utf8");
    const facetQuery = source.slice(
      source.indexOf("async function getUsageFacets"),
      source.indexOf("export function buildUsageFacets"),
    );
    expect(facetQuery).toContain("usageConditions(scope, {}, start, end)");
    expect(facetQuery).not.toContain(".limit(");
  });
});
