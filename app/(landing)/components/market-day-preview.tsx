"use client";

import { CalendarDays, CircleCheck, CircleMinus, Clock3 } from "lucide-react";
import { Fragment, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { ListingLogo } from "./listing-logo";
import { previewTradingDates } from "./market-preview-data";
import styles from "./market-day-preview.module.css";

const markets = [
  { city: "Tokyo", mic: "XTKS", offset: 9, sessions: [{ start: 0, end: 2.5 }, { start: 3.5, end: 6.5 }] },
  { city: "London", mic: "XLON", offset: 0, sessions: [{ start: 8, end: 16.5 }] },
  { city: "New York", mic: "XNAS", offset: -5, sessions: [{ start: 14.5, end: 21 }] },
];

type SessionType = (typeof previewTradingDates)[number]["status"];
const statusLabels = { regular: "Regular", holiday: "Holiday", early: "Early close" };
const listingStatusLabels = { regular: "Regular session", holiday: "Market holiday", early: "Early close" };
const statusColors = {
  regular: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  holiday: "border-transparent bg-secondary text-secondary-foreground",
  early: "border-transparent bg-primary/10 text-foreground",
};

function SessionStatus({ status, label }: { status: SessionType; label?: string }) {
  const Icon = status === "regular" ? CircleCheck : status === "holiday" ? CircleMinus : Clock3;
  return <Badge variant="outline" className={`${styles.status} ${statusColors[status]}`}><Icon aria-hidden="true" className="size-3.5 shrink-0" />{label ?? statusLabels[status]}</Badge>;
}

function formatHour(hour: number) {
  return `${String(Math.floor(hour)).padStart(2, "0")}:${hour % 1 ? "30" : "00"}`;
}

export function MarketDayPreview() {
  const [date, setDate] = useState<string>(previewTradingDates[0].date);
  const [zone, setZone] = useState("utc");
  const day = previewTradingDates.find((entry) => entry.date === date)!;

  return (
    <figure className={styles.preview}>
      <Card className="overflow-hidden rounded-lg bg-background/50 font-sans shadow-none backdrop-blur-sm">
        <header className={styles.toolbar}>
          <div className={styles.title}>
            <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <h3>A day across markets</h3>
          </div>
          <div className={styles.controls}>
            <Select value={date} onValueChange={setDate}>
              <SelectTrigger aria-label="Market hours date" className="h-9 w-full bg-background text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{previewTradingDates.map((entry) => <SelectItem value={entry.date} key={entry.date}>{entry.label}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={zone} onValueChange={setZone}>
              <SelectTrigger aria-label="Market hours time zone" className="h-9 w-full bg-background text-sm"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="utc">UTC</SelectItem><SelectItem value="local">Exchange time</SelectItem></SelectContent>
            </Select>
          </div>
        </header>
        <div className={styles.chart}>
          <Table className={styles.timeline}>
            <caption className="sr-only">Trading sessions on {day.label} in {zone === "utc" ? "UTC" : "each exchange’s local time"}.</caption>
            <colgroup><col className={styles.marketColumn} /><col /></colgroup>
            <TableHeader>
              <TableRow className="border-0 hover:bg-transparent">
                <TableHead scope="col" className={`${styles.marketHeading} h-auto pl-0`}>Market</TableHead>
                <TableHead scope="col" className="h-auto p-0">
                  <div className={styles.axisHeader}><span>Trading sessions</span><span>{zone === "utc" ? "UTC" : "Exchange time"}</span></div>
                  <div aria-hidden="true" className={styles.axis}>
                    {["00:00", "06:00", "12:00", "18:00", "24:00"].map((time, index) => <span key={time} style={{ left: `${index * 25}%` }}>{time}</span>)}
                  </div>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {markets.map((market) => {
                const status: SessionType = market.mic === "XNAS" ? day.status : "regular";
                const sessions = status === "holiday" ? [] : market.sessions.map((session) => ({
                  start: session.start + (zone === "local" ? market.offset : 0),
                  end: (status === "early" ? 18 : session.end) + (zone === "local" ? market.offset : 0),
                }));
                return (
                  <TableRow key={market.mic} className="hover:bg-transparent">
                    <TableHead scope="row" className={`${styles.marketLabel} h-auto pl-0 text-foreground`}>
                      <span className={styles.city}>{market.city}</span>
                      <span className={styles.mic}>{market.mic}</span>
                      <SessionStatus status={status} />
                    </TableHead>
                    <TableCell className="px-0 py-3">
                      <div aria-hidden="true" className={styles.track}>
                        {!sessions.length && <span className={styles.closed}>Market closed</span>}
                        {sessions.map((session) => (
                          <div key={session.start} className={styles.session} style={{ left: `${session.start / 24 * 100}%`, width: `${(session.end - session.start) / 24 * 100}%` }}>
                            <span className={styles.bar} />
                            <span className={styles.rangeLabel}>{formatHour(session.start)}–{formatHour(session.end)}</span>
                          </div>
                        ))}
                      </div>
                      <div className={styles.sessionSummary}>
                        {sessions.length ? sessions.map((session) => <Fragment key={session.start}><span>{formatHour(session.start)}–{formatHour(session.end)}</span>{" "}</Fragment>) : <span>Market closed</span>}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className={styles.listing}>
          <div className={styles.listingIdentity}>
            <ListingLogo name="apple" className="size-6 shrink-0 rounded-sm border-0 p-0" />
            <div className="min-w-0"><p className="text-sm font-semibold">AAPL<span className="text-muted-foreground">/USD</span></p><p className="text-xs text-muted-foreground">Apple Inc.</p></div>
          </div>
          <SessionStatus status={day.status} label={listingStatusLabels[day.status]} />
          <dl className={styles.listingDetails}>
            <div><dt>Venue</dt><dd>XNAS</dd></div>
            <div><dt>Currency</dt><dd>USD</dd></div>
          </dl>
        </div>
      </Card>
      <figcaption>{day.label}. {zone === "utc" ? "Session times in UTC." : "Each row uses its exchange’s local time."}</figcaption>
    </figure>
  );
}
