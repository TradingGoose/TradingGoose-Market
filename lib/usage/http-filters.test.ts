import { describe, expect, it } from "vitest";
import {
  parseUsageFilters,
  UsageFilterInputError,
} from "./http-filters";

describe("usage HTTP filters", () => {
  it("accepts only canonical activity dimensions", () => {
    const url = new URL(
      "https://market.example/api/account/activity?range=7d&route=public.get.market-hours&resource=market_hour&completion=success&granularity=day&group=app&metric=requests&app=https%3A%2F%2Fstudio.example%2F",
    );
    expect(parseUsageFilters(url, "activity")).toMatchObject({
      range: "7d",
      routeId: "public.get.market-hours",
      resourceId: "market_hour",
      completion: "success",
      granularity: "day",
      group: "app",
      metric: "requests",
      appUrl: "https://studio.example/",
    });
  });

  it.each([
    "range=forever",
    "group=application",
    "sort=cost",
    "range=7d&range=30d",
    "app=https%3A%2F%2Fexample.com%2F%3Fsecret%3D1",
  ])("rejects unsupported or non-canonical activity input: %s", (query) => {
    expect(() =>
      parseUsageFilters(
        new URL(`https://market.example/api/account/activity?${query}`),
        "activity",
      ),
    ).toThrow(UsageFilterInputError);
  });

  it("validates opaque logs cursors and bounded pages", () => {
    const cursor = Buffer.from(
      JSON.stringify({ admittedAt: "2026-07-18T12:00:00.000Z", id: "event-id" }),
    ).toString("base64url");
    const url = new URL(
      `https://market.example/api/account/logs?range=24h&limit=100&cursor=${cursor}`,
    );
    expect(parseUsageFilters(url, "logs")).toMatchObject({
      range: "24h",
      limit: 100,
      cursor,
    });
    expect(() =>
      parseUsageFilters(
        new URL("https://market.example/api/account/logs?cursor=not-a-cursor"),
        "logs",
      ),
    ).toThrow(UsageFilterInputError);
    expect(() =>
      parseUsageFilters(
        new URL("https://market.example/api/account/logs?limit=101"),
        "logs",
      ),
    ).toThrow(UsageFilterInputError);
  });
});
