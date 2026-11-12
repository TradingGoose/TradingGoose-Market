"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import styles from "./market-api-preview.module.css";

const examples = [
  {
    value: "search",
    label: "Search",
    request: "/api/search/listings?version=v1&search_query=AAPL",
    response: `{
  "data": [
    {
      "listing_id": "{listing_id}",
      "base": "AAPL",
      "quote": "USD",
      "name": "Apple Inc.",
      "primaryMicCode": "XNAS"
    }
  ]
}`,
  },
  {
    value: "listing",
    label: "Listing",
    request: "/api/get/listing?version=v1&listing_id={listing_id}",
    response: `{
  "data": {
    "listing_id": "{listing_id}",
    "base": "AAPL",
    "quote": "USD",
    "name": "Apple Inc.",
    "primaryMicCode": "XNAS",
    "timeZoneName": "America/New_York"
  }
}`,
  },
  {
    value: "hours",
    label: "Market hours",
    request:
      "/api/get/market-hours?version=v1&listing_id={listing_id}&listingType=default&date=2026-11-02",
    response: `{
  "data": {
    "isHoliday": false,
    "timeZone": {
      "name": "America/New_York",
      "utcOffset": "-05:00"
    },
    "marketHors": {
      "market": { "start": "09:30", "end": "16:00" }
    }
  }
}`,
  },
];

function ResponseCode({ value }: { value: string }) {
  return (
    <code>
      {value.split("\n").map((line, index) => {
        const field = line.match(/^(\s*)("[^"]+")(:)(.*)$/);

        return (
          <span key={index}>
            {field ? (
              <>
                {field[1]}
                <span className={styles.key}>{field[2]}</span>
                {field[3]}
                <span className={styles.value}>{field[4]}</span>
              </>
            ) : (
              line
            )}
            {"\n"}
          </span>
        );
      })}
    </code>
  );
}

export function MarketApiPreview() {
  return (
    <Tabs defaultValue="search" className={`${styles.console} bg-background/50 backdrop-blur-sm`}>
      <TabsList
        aria-label="API request examples"
        className={`${styles.tabs} h-auto w-full justify-start gap-0 rounded-none bg-transparent p-0`}
      >
        {examples.map((example) => (
          <TabsTrigger
            key={example.value}
            value={example.value}
            className={`${styles.tab} rounded-none bg-transparent hover:bg-transparent focus-visible:ring-foreground focus-visible:ring-inset focus-visible:ring-offset-0 data-[state=active]:bg-transparent data-[state=active]:shadow-none`}
          >
            {example.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {examples.map((example) => (
        <TabsContent
          key={example.value}
          value={example.value}
          className={`${styles.panel} mt-0 focus-visible:ring-foreground focus-visible:ring-inset focus-visible:ring-offset-0`}
        >
          <div className={styles.request}>
            <span className={styles.method}>GET</span>
            <code>{example.request}</code>
          </div>
          <div className={styles.responseHeading}>Example JSON response</div>
          <pre
            className={styles.response}
            tabIndex={0}
            role="region"
            aria-label={`${example.label} example JSON response`}
          >
            <ResponseCode value={example.response} />
          </pre>
        </TabsContent>
      ))}
    </Tabs>
  );
}
