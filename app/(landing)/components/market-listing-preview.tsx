"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CheckIcon, SearchIcon, XIcon } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { MarketApiError, marketApiRequest } from "@/hooks/use-market-resource";
import type { Listing } from "@/lib/market-api/v1/search/types";

import styles from "./market-listing-preview.module.css";

type ListingRecord = Listing & { listing_id: string };
type SearchState = { url: string; data: ListingRecord[]; status: "loading" | "ready" | "error"; error: string | null };
type BatchState = { data: ListingRecord[]; missing: string[]; loading: boolean; error: string | null };
const focus = "focus-visible:ring-foreground";
const assetClasses = [
  { value: "stock", label: "Stocks", recordLabel: "Stock" },
  { value: "etf", label: "ETFs", recordLabel: "ETF" },
  { value: "indice", label: "Indices", recordLabel: "Index" },
  { value: "mutualfund", label: "Mutual funds", recordLabel: "Mutual fund" },
  { value: "future", label: "Futures", recordLabel: "Future" },
];
const currencies = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "HKD", "CNY"];

function hasListingId(listing: Listing | null): listing is ListingRecord {
  return Boolean(listing?.listing_id);
}

function requestError(error: unknown, operation: "Search" | "Lookup") {
  return error instanceof MarketApiError && error.status === 429
    ? `${operation} limit reached. Try again shortly.`
    : `${operation} is temporarily unavailable. Please try again.`;
}

function ListingResults({ listings, selectedId, onSelect, label }: {
  listings: ListingRecord[];
  selectedId: string;
  onSelect: (id: string) => void;
  label: string;
}) {
  const selected = listings.find((listing) => listing.listing_id === selectedId) ?? listings[0];
  if (!selected) return null;
  return (
    <div className="space-y-4">
      <ul aria-label={label} className="max-h-56 min-w-0 space-y-1 overflow-y-auto pr-3">
        {listings.map((listing) => (
          <li key={listing.listing_id}>
            <Button
              type="button"
              variant="ghost"
              aria-label={`View ${listing.base} listing on ${listing.primaryMicCode ?? "unknown exchange"} in ${listing.quote ?? "local currency"}`}
              aria-pressed={selected.listing_id === listing.listing_id}
              onClick={() => onSelect(listing.listing_id)}
              className={`h-auto min-h-12 w-full min-w-0 justify-start gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground ${focus} ${selected.listing_id === listing.listing_id ? "bg-accent" : "bg-transparent"}`}
            >
              <Avatar className={`m-1 size-6 rounded-sm ${listing.iconUrl ? "bg-white" : "bg-secondary/60"}`}>
                {listing.iconUrl && <AvatarImage src={listing.iconUrl} alt="" className="object-contain" />}
                <AvatarFallback className="rounded-none text-xs text-accent-foreground">{listing.base.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-none">
                <span title={`${listing.base}${listing.quote ? `/${listing.quote}` : ""}`} className="truncate text-sm font-semibold">
                  {listing.base}{listing.quote && <span className="text-muted-foreground">/{listing.quote}</span>}
                </span>
                {listing.name?.trim() && listing.name.trim().toLowerCase() !== listing.base.trim().toLowerCase() && (
                  <span title={listing.name} className="truncate text-xs font-normal text-muted-foreground">{listing.name}</span>
                )}
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5 text-xs text-muted-foreground">
                <span className="font-semibold">{assetClasses.find((item) => item.value === listing.assetClass)?.recordLabel ?? listing.assetClass}</span>
                {listing.primaryMicCode && <span className="font-normal">{listing.primaryMicCode}</span>}
              </span>
              <CheckIcon className={`size-4 shrink-0 text-muted-foreground ${selected.listing_id === listing.listing_id ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      <Card className="rounded-md bg-muted/30 shadow-none" role="region" aria-label={`${selected.base} listing details`}>
        <CardContent className="space-y-3 p-3">
          <div className="flex min-w-0 items-center gap-2">
            <Avatar className={`m-1 size-6 rounded-sm ${selected.iconUrl ? "bg-white" : "bg-secondary/60"}`}>
              {selected.iconUrl && <AvatarImage src={selected.iconUrl} alt="" className="object-contain" />}
              <AvatarFallback className="rounded-none text-xs text-accent-foreground">{selected.base.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p title={`${selected.base}${selected.quote ? `/${selected.quote}` : ""}`} className="truncate text-sm font-semibold">
                {selected.base}{selected.quote && <span className="text-muted-foreground">/{selected.quote}</span>}
              </p>
              {selected.name?.trim() && selected.name.trim().toLowerCase() !== selected.base.trim().toLowerCase() && (
                <p title={selected.name} className="truncate text-xs text-muted-foreground">{selected.name}</p>
              )}
            </div>
            <span className="shrink-0 text-xs font-semibold text-muted-foreground">{assetClasses.find((item) => item.value === selected.assetClass)?.recordLabel ?? selected.assetClass}</span>
          </div>
          <dl className={styles.details}>
            <div><dt>Exchange / MIC</dt><dd className="font-medium tracking-tight">{selected.primaryMicCode ?? "—"}</dd></div>
            <div><dt>Currency</dt><dd className="font-mono">{selected.quote ?? "—"}</dd></div>
            <div><dt>Time zone</dt><dd>{selected.timeZoneName ?? "—"}</dd></div>
            <div className="col-span-full flex items-start justify-between gap-3">
              <dt className="shrink-0">Listing ID</dt>
              <dd className="min-w-0 break-all text-right"><code className="font-mono text-xs text-muted-foreground">{selected.listing_id}</code></dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

export function MarketListingPreview() {
  const id = useId();
  const queryInput = useRef<HTMLInputElement>(null);
  const batchController = useRef<AbortController | null>(null);
  const [query, setQuery] = useState("");
  const [assetClass, setAssetClass] = useState("all");
  const [currency, setCurrency] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState<SearchState>({ url: "", data: [], status: "loading", error: null });
  const [batchInput, setBatchInput] = useState<string | null>(null);
  const [batch, setBatch] = useState<BatchState | null>(null);
  const [batchSelectedId, setBatchSelectedId] = useState("");
  const params = new URLSearchParams({ version: "v1", limit: "12" });
  if (query.trim()) params.set("search_query", query.trim());
  if (assetClass !== "all") params.set("asset_class", assetClass);
  else if (!query.trim()) assetClasses.forEach(({ value }) => params.append("asset_class", value));
  if (currency !== "all") params.set("listing_quote_code", currency);
  const searchUrl = `/api/search/listings?${params}`;
  const isLoading = search.url !== searchUrl || search.status === "loading";
  const batchValue = batchInput ?? search.data.slice(0, 3).map((listing) => listing.listing_id).join(", ");
  const batchIds = [...new Set(batchValue.split(/[,\n]/).map((value) => value.trim()).filter(Boolean))];

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearch((current) => ({ ...current, url: searchUrl, status: "loading", error: null }));
      try {
        const response = await marketApiRequest<{ data: Listing[] }>(searchUrl, { signal: controller.signal });
        if (!controller.signal.aborted) setSearch({ url: searchUrl, data: response.data.filter(hasListingId), status: "ready", error: null });
      } catch (error) {
        if (!controller.signal.aborted) setSearch({ url: searchUrl, data: [], status: "error", error: requestError(error, "Search") });
      }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [searchUrl, retry]);

  useEffect(() => () => batchController.current?.abort(), []);

  function clearSearch() { setQuery(""); queryInput.current?.focus(); }
  function resetSearch() { clearSearch(); setAssetClass("all"); setCurrency("all"); }

  async function resolveBatch() {
    batchController.current?.abort();
    const controller = new AbortController();
    batchController.current = controller;
    setBatch({ data: [], missing: [], loading: true, error: null });
    const batchParams = new URLSearchParams({ version: "v1" });
    batchIds.forEach((listingId) => batchParams.append("listing_id", listingId));
    try {
      const response = await marketApiRequest<{ data: Listing | Record<string, Listing | null> | null }>(`/api/get/listing?${batchParams}`, { signal: controller.signal });
      const records = batchIds.length === 1 ? [response.data as Listing | null] : Object.values(response.data ?? {});
      const data = records.filter(hasListingId);
      if (!controller.signal.aborted) setBatch({ data, missing: batchIds.filter((listingId) => !data.some((listing) => listing.listing_id === listingId)), loading: false, error: null });
    } catch (error) {
      if (!controller.signal.aborted) setBatch({
        data: [], missing: [], loading: false,
        error: error instanceof MarketApiError && error.status === 404 ? "No listing was found for that ID." : error instanceof MarketApiError && error.status === 400 && batchIds.length > 200 ? "Use 200 listing IDs or fewer." : requestError(error, "Lookup"),
      });
    }
  }

  return (
    <Card className="w-full min-w-0 max-w-[640px] justify-self-center overflow-hidden rounded-lg bg-background/50 shadow-none backdrop-blur-sm">
      <Tabs defaultValue="search" className="p-5">
        <TabsList aria-label="Listing lookup" className="h-auto w-full justify-start bg-transparent p-0">
          <TabsTrigger value="search" className={`h-11 ${focus} data-[state=active]:bg-muted data-[state=active]:text-foreground data-[state=active]:shadow-none`}>Search listings</TabsTrigger>
          <TabsTrigger value="batch" className={`h-11 ${focus} data-[state=active]:bg-muted data-[state=active]:text-foreground data-[state=active]:shadow-none`}>Batch lookup</TabsTrigger>
        </TabsList>
        <TabsContent value="search" className={`mt-4 space-y-4 ${focus}`}>
          <div className={styles.controls}>
            <div className={styles.search}>
              <Label htmlFor={`${id}-query`} className="sr-only">Search listings by symbol or name</Label>
              <SearchIcon className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" aria-hidden="true" />
              <Input ref={queryInput} id={`${id}-query`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Symbol or company name" className={`h-11 pl-10 pr-12 ${focus}`} />
              {query && <Button type="button" variant="ghost" size="icon" onClick={clearSearch} aria-label="Clear listing search" className={`absolute right-0 top-0 size-11 bg-transparent ${focus}`}><XIcon aria-hidden="true" /></Button>}
            </div>
            <div>
              <Label htmlFor={`${id}-asset`} className="sr-only">Asset class</Label>
              <Select value={assetClass} onValueChange={setAssetClass}>
                <SelectTrigger id={`${id}-asset`} className="h-11 focus:ring-0 focus:ring-offset-0 focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all" className="min-h-11">All asset classes</SelectItem>{assetClasses.map(({ value, label }) => <SelectItem key={value} value={value} className="min-h-11">{label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor={`${id}-currency`} className="sr-only">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id={`${id}-currency`} className="h-11 focus:ring-0 focus:ring-offset-0 focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all" className="min-h-11">All currencies</SelectItem>{currencies.map((value) => <SelectItem key={value} value={value} className="min-h-11">{value}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className={styles.results} aria-busy={isLoading}>
            {isLoading ? (
              <div className="space-y-3" role="status"><span className="text-xs text-muted-foreground">Searching listings…</span>{[0, 1, 2].map((row) => <Skeleton key={row} className="h-16 w-full motion-reduce:animate-none" />)}</div>
            ) : search.error ? (
              <div className="space-y-3 py-12 text-center"><p role="alert" className="text-sm text-muted-foreground">{search.error}</p><Button type="button" variant="outline" onClick={() => { setSearch((current) => ({ ...current, status: "loading" })); setRetry((current) => current + 1); }} className={`h-11 ${focus}`}>Retry search</Button></div>
            ) : search.data.length ? (
              <><p role="status" className="mb-2 text-xs text-muted-foreground">Showing {search.data.length} {search.data.length === 1 ? "listing" : "listings"}</p><ListingResults listings={search.data} selectedId={selectedId} onSelect={setSelectedId} label="Matching listings" /></>
            ) : (
              <div className="space-y-3 py-12 text-center"><p role="status" className="text-sm text-muted-foreground">No listings match your search and filters.</p><Button type="button" variant="outline" onClick={resetSearch} className={`h-11 ${focus}`}>Reset search</Button></div>
            )}
          </div>
        </TabsContent>
        <TabsContent value="batch" className={`mt-4 min-h-[400px] space-y-4 ${focus}`}>
          <div className="space-y-2">
            <Label htmlFor={`${id}-batch`}>Listing IDs</Label>
            <Textarea id={`${id}-batch`} value={batchValue} onChange={(event) => { batchController.current?.abort(); setBatchInput(event.target.value); setBatch(null); }} aria-describedby={`${id}-batch-help ${id}-batch-count`} aria-invalid={Boolean(batch?.error)} className={`min-h-24 resize-y text-base md:text-sm ${focus}`} />
            <p id={`${id}-batch-help`} className="text-xs leading-relaxed text-muted-foreground">Separate up to 200 listing IDs with commas or new lines.</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p id={`${id}-batch-count`} className="text-xs text-muted-foreground">{batchIds.length} / 200 entries</p>
            <Button type="button" disabled={!batchIds.length || batch?.loading} onClick={resolveBatch} className={`h-11 ${focus}`}>{batch?.loading ? "Resolving…" : "Resolve listings"}</Button>
          </div>
          {batch?.loading && <p role="status" className="text-sm text-muted-foreground">Looking up listings…</p>}
          {batch?.error && <p role="alert" className="text-sm text-muted-foreground">{batch.error}</p>}
          {batch && !batch.loading && !batch.error && <><p role="status" className="break-words text-sm text-muted-foreground">{batch.data.length} {batch.data.length === 1 ? "listing" : "listings"} resolved.{batch.missing.length > 0 && ` Not found: ${batch.missing.join(", ")}.`}</p><ListingResults listings={batch.data} selectedId={batchSelectedId} onSelect={setBatchSelectedId} label="Resolved listings" /></>}
        </TabsContent>
      </Tabs>
    </Card>
  );
}
