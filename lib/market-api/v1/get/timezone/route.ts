import { sql } from "drizzle-orm";
import type { ApiContext } from "@/lib/market-api/core/context";

import { db } from "@tradinggoose/db";

type TimeZoneRow = {
  name: string;
  offset: string | null;
  offsetDst: string | null;
  observesDst: boolean;
};

type TimeZoneResponse = {
  name: string;
  utcOffset: string;
  dstOn: boolean;
  observesDst: boolean;
};

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function makeDTF(timeZone: string) {
  const cached = dtfCache.get(timeZone);
  if (cached) return cached;
  const dtf = new Intl.DateTimeFormat("en-US", {
    hourCycle: "h23",
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  dtfCache.set(timeZone, dtf);
  return dtf;
}

function partsOffset(dtf: Intl.DateTimeFormat, date: Date) {
  const result = { year: 0, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
  for (const part of dtf.formatToParts(date)) {
    switch (part.type) {
      case "year":
        result.year = Number.parseInt(part.value, 10);
        break;
      case "month":
        result.month = Number.parseInt(part.value, 10);
        break;
      case "day":
        result.day = Number.parseInt(part.value, 10);
        break;
      case "hour":
        result.hour = Number.parseInt(part.value, 10);
        break;
      case "minute":
        result.minute = Number.parseInt(part.value, 10);
        break;
      case "second":
        result.second = Number.parseInt(part.value, 10);
        break;
      default:
        break;
    }
  }

  return result;
}

function objToLocalTS({
  year,
  month,
  day,
  hour,
  minute,
  second,
  millisecond
}: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}) {
  let d = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  if (year < 100 && year >= 0) {
    const adjusted = new Date(d);
    adjusted.setUTCFullYear(adjusted.getUTCFullYear() - 1900);
    d = +adjusted;
  }
  return d;
}

function getZoneOffsetMinutes(timeZoneName: string, date: Date) {
  let dtf: Intl.DateTimeFormat;
  try {
    dtf = makeDTF(timeZoneName);
  } catch {
    return null;
  }

  const parts = partsOffset(dtf, date);
  const asUTC = objToLocalTS({
    ...parts,
    millisecond: 0
  });

  let asTS = date.getTime();
  const over = asTS % 1000;
  asTS -= over >= 0 ? over : 1000 + over;

  return (asUTC - asTS) / (60 * 1000);
}

function formatOffset(minutes: number) {
  if (!Number.isFinite(minutes)) return null;
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

function resolveUtcOffset(row: TimeZoneRow, now: Date) {
  const currentOffset = getZoneOffsetMinutes(row.name, now);
  if (currentOffset !== null) {
    const formatted = formatOffset(currentOffset);
    if (formatted) return formatted;
  }

  return row.offset ?? row.offsetDst ?? "+00:00";
}

function resolveDstOn(row: TimeZoneRow, now: Date) {
  if (!row.offsetDst) return false;
  const currentOffset = getZoneOffsetMinutes(row.name, now);
  if (currentOffset === null) return false;
  const formatted = formatOffset(currentOffset);
  return formatted === row.offsetDst;
}

export async function getTimeZones(c: ApiContext) {
  try {
    if (!db) {
      return c.json({ error: "Database connection is not configured." }, 503);
    }

    const request = c.req.raw;
    const { searchParams } = new URL(request.url);
    const timeZoneName =
      searchParams.get("timezone_name")?.trim() || null;

    const filters = timeZoneName ? sql`WHERE name = ${timeZoneName}` : sql``;

    const rows = (await db.execute(sql`
      SELECT
        name,
        "offset" AS "offset",
        "offset_dst" AS "offsetDst",
        "observes_dst" AS "observesDst"
      FROM time_zones
      ${filters}
      ORDER BY name ASC
    `)) as TimeZoneRow[];

    const now = new Date();
    const data: TimeZoneResponse[] = rows.map((row) => ({
      name: row.name,
      utcOffset: resolveUtcOffset(row, now),
      dstOn: resolveDstOn(row, now),
      observesDst: row.observesDst
    }));

    if (timeZoneName) {
      const match = data[0];
      if (!match) {
        return c.json({ error: "Time zone not found." }, 404);
      }
      return c.json(match);
    }

    return c.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[get/timezone] API error:", message);
    return c.json({ error: message }, 500);
  }
}
