// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MarketListingPreview } from "../../app/(landing)/components/market-listing-preview";
import type { Listing } from "../../lib/market-api/v1/search/types";

const apple: Listing = {
  listing_id: "TG_LSTG_TEST_AAPL", base_id: null, quote_id: null, base: "AAPL", quote: "USD",
  name: "Apple Inc.", iconUrl: "/api/files/serve/apple.svg", assetClass: "stock", listing_type: "default",
  primaryMicCode: "XNAS", countryCode: "US", cityName: "New York", timeZoneName: "America/New_York",
};
const frankfurt: Listing = { ...apple, listing_id: "TG_LSTG_TEST_APC", base: "APC", quote: "EUR", primaryMicCode: "XFRA", countryCode: "DE", cityName: "Frankfurt", timeZoneName: "Europe/Berlin" };
const nvidia: Listing = { ...apple, listing_id: "TG_LSTG_TEST_NVDA", base: "NVDA", name: "NVIDIA Corporation", iconUrl: null };
const catalog = [apple, frankfurt, nvidia, ...Array.from({ length: 9 }, (_, index) => ({ ...apple, listing_id: `TG_LSTG_TEST_${index}`, base: `T${index}`, name: `Search result ${index}`, assetClass: index === 0 ? "etf" : "stock" }))];
const fetchMock = vi.fn<typeof fetch>();

async function apiResponse(input: RequestInfo | URL) {
  const url = new URL(String(input), "http://localhost");
  if (url.pathname === "/api/get/listing") {
    const ids = url.searchParams.getAll("listing_id");
    if (ids.length > 200) return Response.json({ error: "listing_id supports up to 200 values." }, { status: 400 });
    if (ids.length === 1) {
      const listing = catalog.find((item) => item.listing_id === ids[0]);
      return Response.json({ data: listing ?? null }, { status: listing ? 200 : 404 });
    }
    return Response.json({ data: Object.fromEntries(ids.map((id) => [id, catalog.find((item) => item.listing_id === id) ?? null])) });
  }
  const query = url.searchParams.get("search_query")?.toLowerCase() ?? "";
  const currency = url.searchParams.get("listing_quote_code");
  const classes = url.searchParams.getAll("asset_class");
  return Response.json({ data: catalog.filter((listing) =>
    (!query || listing.base.toLowerCase().includes(query) || listing.name?.toLowerCase().includes(query)) &&
    (!currency || listing.quote === currency) && (!classes.length || classes.includes(listing.assetClass)),
  ) });
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  fetchMock.mockReset().mockImplementation(apiResponse);
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Market listing search with the public API", () => {
  it("loads 12 real-response identities and sends query and currency filters to the API", async () => {
    const interaction = userEvent.setup();
    render(<MarketListingPreview />);
    await screen.findByText("Showing 12 listings");
    expect(within(screen.getByRole("list", { name: "Matching listings" })).getAllByRole("button")).toHaveLength(12);
    const initialUrl = new URL(String(fetchMock.mock.calls[0][0]), "http://localhost");
    expect(initialUrl.pathname).toBe("/api/search/listings");
    expect(initialUrl.searchParams.get("version")).toBe("v1");
    expect(initialUrl.searchParams.get("limit")).toBe("12");
    expect(initialUrl.searchParams.getAll("asset_class")).toEqual(["stock", "etf", "indice", "mutualfund", "future"]);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has("x-api-key")).toBe(false);

    const input = screen.getByRole("textbox", { name: "Search listings by symbol or name" });
    await interaction.type(input, "Apple");
    await screen.findByText("Showing 2 listings");
    await interaction.click(screen.getByRole("button", { name: "View APC listing on XFRA in EUR" }));
    expect(screen.getByRole("region", { name: "APC listing details" }).textContent).toContain("Europe/Berlin");
    expect(screen.getByRole("region", { name: "APC listing details" }).textContent).toContain(frankfurt.listing_id);
    await interaction.click(screen.getByRole("combobox", { name: "Currency" }));
    await interaction.click(screen.getByRole("option", { name: "EUR" }));
    await screen.findByText("Showing 1 listing");
    const filteredUrl = new URL(String(fetchMock.mock.calls.at(-1)?.[0]), "http://localhost");
    expect(filteredUrl.searchParams.get("search_query")).toBe("Apple");
    expect(filteredUrl.searchParams.get("listing_quote_code")).toBe("EUR");

    await interaction.click(screen.getByRole("combobox", { name: "Asset class" }));
    await interaction.click(screen.getByRole("option", { name: "ETFs" }));
    await screen.findByText("No listings match your search and filters.");
    expect(new URL(String(fetchMock.mock.calls.at(-1)?.[0]), "http://localhost").searchParams.get("asset_class")).toBe("etf");
    await interaction.click(screen.getByRole("button", { name: "Reset search" }));
    expect(document.activeElement).toBe(input);
    await screen.findByText("Showing 12 listings");
    await interaction.type(input, "AAPL");
    await interaction.click(screen.getByRole("button", { name: "Clear listing search" }));
    expect(document.activeElement).toBe(input);
  });

  it("aborts an older search and ignores its response after a new query", async () => {
    let finishOldRequest: ((response: Response) => void) | undefined;
    let oldSignal: AbortSignal | null | undefined;
    fetchMock.mockImplementation((input, init) => {
      if (new URL(String(input), "http://localhost").searchParams.get("search_query") === "AAPL") {
        oldSignal = init?.signal;
        return new Promise((resolve) => { finishOldRequest = resolve; });
      }
      return apiResponse(input);
    });
    render(<MarketListingPreview />);
    await screen.findByText("Showing 12 listings");
    const input = screen.getByRole("textbox", { name: "Search listings by symbol or name" });
    fireEvent.change(input, { target: { value: "AAPL" } });
    await waitFor(() => expect(finishOldRequest).toBeTypeOf("function"));
    fireEvent.change(input, { target: { value: "NVDA" } });
    expect(oldSignal?.aborted).toBe(true);
    await screen.findByRole("region", { name: "NVDA listing details" });
    await act(async () => { finishOldRequest?.(Response.json({ data: [apple] })); });
    expect(screen.queryByRole("region", { name: "AAPL listing details" })).toBeNull();
    expect(screen.getByRole("region", { name: "NVDA listing details" })).toBeTruthy();
  });

  it("shows an unavailable state without invented records or provider details and retries the API", async () => {
    const interaction = userEvent.setup();
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Provider internal detail", code: "ANONYMOUS_LIMIT_UNAVAILABLE" }, { status: 503 }));
    render(<MarketListingPreview />);
    await screen.findByText("Search is temporarily unavailable. Please try again.");
    expect(screen.queryByRole("list", { name: "Matching listings" })).toBeNull();
    expect(screen.queryByText("Provider internal detail")).toBeNull();
    await interaction.click(screen.getByRole("button", { name: "Retry search" }));
    await screen.findByText("Showing 12 listings");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses real listing IDs for single and batch lookups, preserves unknowns, and lets the API enforce its limit", async () => {
    const interaction = userEvent.setup();
    render(<MarketListingPreview />);
    await screen.findByText("Showing 12 listings");
    screen.getByRole("tab", { name: "Search listings" }).focus();
    await interaction.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Batch lookup" }).getAttribute("aria-selected")).toBe("true");
    const input = screen.getByRole("textbox", { name: "Listing IDs" }) as HTMLTextAreaElement;
    expect(input.value).toContain(apple.listing_id);
    fireEvent.change(input, { target: { value: `${apple.listing_id}, ${nvidia.listing_id}\nTG_LSTG_UNKNOWN` } });
    await interaction.click(screen.getByRole("button", { name: "Resolve listings" }));
    await screen.findByText("2 listings resolved. Not found: TG_LSTG_UNKNOWN.");
    const batchUrl = new URL(String(fetchMock.mock.calls.at(-1)?.[0]), "http://localhost");
    expect(batchUrl.pathname).toBe("/api/get/listing");
    expect(batchUrl.searchParams.getAll("listing_id")).toEqual([apple.listing_id, nvidia.listing_id, "TG_LSTG_UNKNOWN"]);

    fireEvent.change(input, { target: { value: nvidia.listing_id } });
    await interaction.click(screen.getByRole("button", { name: "Resolve listings" }));
    await screen.findByText("1 listing resolved.");
    expect(screen.getByRole("region", { name: "NVDA listing details" })).toBeTruthy();

    fireEvent.change(input, { target: { value: Array.from({ length: 201 }, (_, index) => `TG_LSTG_LIMIT_${index}`).join(",") } });
    await interaction.click(screen.getByRole("button", { name: "Resolve listings" }));
    await screen.findByText("Use 200 listing IDs or fewer.");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(new URL(String(fetchMock.mock.calls.at(-1)?.[0]), "http://localhost").searchParams.getAll("listing_id")).toHaveLength(201);
  });
});
