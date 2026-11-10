"use client";

import { CalendarDays, CircleCheck, CircleMinus, Clock3 } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { previewTradingDates } from "./market-preview-data";
import styles from "./market-calendar-reference.module.css";

export function MarketCalendarPreview() {
  const [index, setIndex] = useState(0);
  const day = previewTradingDates[index];
  const isRegular = day.status === "regular";
  const isHoliday = day.status === "holiday";
  const StatusIcon = isRegular ? CircleCheck : isHoliday ? CircleMinus : Clock3;
  const sessions = isRegular
    ? [
        { name: "Premarket", hours: "04:00–09:30", start: 4, end: 9.5 },
        { name: "Regular", hours: "09:30–16:00", start: 9.5, end: 16 },
        { name: "Postmarket", hours: "16:00–20:00", start: 16, end: 20 },
      ]
    : [{ name: "Regular", hours: isHoliday ? "Closed" : "09:30–13:00", start: 9.5, end: isHoliday ? 9.5 : 13 }];

  return (
    <Card className={`${styles.calendar} rounded-lg bg-background/50 shadow-none backdrop-blur-sm`} aria-label="Nasdaq trading calendar preview">
      <CardHeader className={`${styles.previewHeader} flex-row space-y-0`}>
        <CardTitle className={styles.previewTitle}>
          <CalendarDays aria-hidden="true" /> Nasdaq trading calendar
        </CardTitle>
        <Badge variant="outline" className="font-normal">XNAS</Badge>
      </CardHeader>
      <CardContent className="p-0">
        <div className={styles.dateControls}>
          <Select value={day.date} onValueChange={(date) => setIndex(previewTradingDates.findIndex((entry) => entry.date === date))}>
            <SelectTrigger aria-label="Trading calendar date" className="flex-1 focus:ring-0 focus:ring-offset-0 focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"><SelectValue /></SelectTrigger>
            <SelectContent>{previewTradingDates.map((entry) => <SelectItem key={entry.date} value={entry.date}>{entry.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className={styles.schedule} aria-live="polite">
          <div className={styles.dayStatus}>
            <StatusIcon aria-hidden="true" className={`size-4 ${isRegular ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}`} />
            <span>{isRegular ? "Regular trading day" : isHoliday ? "Thanksgiving Day" : "Early close"}</span>
            <Badge variant={isRegular ? "secondary" : "outline"} className="ml-auto font-normal">{isHoliday ? "Closed" : isRegular ? "Scheduled" : "13:00 close"}</Badge>
          </div>
          <dl className={styles.sessionList}>
            {sessions.map((session) => (
              <div className={styles.session} key={session.name}>
                <dt>{session.name}</dt>
                <dd>{session.hours}</dd>
                <div className={styles.sessionTrack} aria-hidden="true">
                  <span style={{ marginLeft: `${((session.start - 4) / 16) * 100}%`, width: `${((session.end - session.start) / 16) * 100}%`, background: session.name === "Regular" ? "hsl(var(--primary))" : "hsl(var(--muted-foreground) / 0.5)" }} />
                </div>
              </div>
            ))}
          </dl>
          {!isRegular && <p className="mt-5 text-sm leading-relaxed text-muted-foreground">{isHoliday ? "No regular trading session on this market holiday." : "The regular session ends three hours earlier."}</p>}
        </div>
        <div className={styles.exceptions}>
          <Button variant="ghost" onClick={() => setIndex(1)} aria-pressed={isHoliday} className="h-auto justify-between gap-3 px-2 py-2 text-xs font-normal">
            <span className="flex items-center gap-2"><CircleMinus aria-hidden="true" className="size-4 text-amber-700 dark:text-amber-400" /> Market holiday</span><span className="text-muted-foreground">Nov 26</span>
          </Button>
          <Button variant="ghost" onClick={() => setIndex(2)} aria-pressed={day.status === "early"} className="h-auto justify-between gap-3 px-2 py-2 text-xs font-normal">
            <span className="flex items-center gap-2"><Clock3 aria-hidden="true" className="size-4 text-amber-700 dark:text-amber-400" /> Early close</span><span className="text-muted-foreground">Nov 27</span>
          </Button>
        </div>
        <div className={styles.timezone}>
          <Clock3 aria-hidden="true" /><span>Exchange time</span><span>America/New_York</span>
        </div>
      </CardContent>
    </Card>
  );
}
