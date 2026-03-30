import { sql, type SQL } from "drizzle-orm";
import type { ApiContext } from "@/lib/market-api/core/context";

import { db } from "@tradinggoose/db";
import { resolveSearchParams } from "../../search/params";

type ListingType = "default" | "crypto" | "currency";

type Session = {
  start: string;
  end: string;
  state: string;
};

type SessionsByDay = Record<DayKey, Session[]>;

type MarketHours = {
  sessions: SessionsByDay;
  holidays: string[];
  earlyCloses: Record<string, string>;
};

type DayKey = "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";

type MarketHoursRow = {
  hours: unknown;
  timeZoneName: string | null;
  timeZoneOffset: string | null;
  timeZoneOffsetDst: string | null;
  timeZoneObservesDst: boolean | null;
};

type ListingRow = {
  assetClass: string | null;
  marketId: string | null;
  marketCountryId: string | null;
};

type MarketRange = {
  start: string;
  end: string;
};

type MarketHoursResponse = {
  premarket: MarketRange | null;
  market: MarketRange | null;
  postmarket: MarketRange | null;
};

type TimeZoneResponse = {
  name: string;
  utcOffset: string;
  dstOn: boolean;
  observesDst: boolean;
};

const DAY_KEYS: DayKey[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday"
];

const WEEKDAY_MAP: Record<string, DayKey> = {
  sun: "sunday",
  sunday: "sunday",
  mon: "monday",
  monday: "monday",
  tue: "tuesday",
  tues: "tuesday",
  tuesday: "tuesday",
  wed: "wednesday",
  weds: "wednesday",
  wednesday: "wednesday",
  thu: "thursday",
  thur: "thursday",
  thurs: "thursday",
  thursday: "thursday",
  fri: "friday",
  friday: "friday",
  sat: "saturday",
  saturday: "saturday"
};

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function makeDtf(timeZone: string) {
  const cached = dtfCache.get(timeZone);
  if (cached) return cached;
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  dtfCache.set(timeZone, dtf);
  return dtf;
}

function parseDatePartsFromZone(date: Date, timeZone: string) {
  let dtf: Intl.DateTimeFormat;
  try {
    dtf = makeDtf(timeZone);
  } catch {
    return null;
  }

  const parts = dtf.formatToParts(date);
  const result = {
    year: 0,
    month: 0,
    day: 0,
    hour: 0,
    minute: 0,
    second: 0,
    weekday: ""
  };

  for (const part of parts) {
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
      case "weekday":
        result.weekday = part.value;
        break;
      default:
        break;
    }
  }

  const weekdayKey = WEEKDAY_MAP[result.weekday.trim().toLowerCase()];
  if (!weekdayKey) return null;

  return { ...result, weekdayKey };
}

function formatOffset(minutes: number) {
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  return `${sign}${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function getUtcOffsetMinutes(date: Date, timeZone: string) {
  const parts = parseDatePartsFromZone(date, timeZone);
  if (!parts) return null;
  const utc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return Math.round((utc - date.getTime()) / 60000);
}

function resolveTimeZoneResponse(
  row: MarketHoursRow,
  date: Date
): TimeZoneResponse | null {
  if (!row.timeZoneName) return null;
  const offsetMinutes = getUtcOffsetMinutes(date, row.timeZoneName);
  if (offsetMinutes === null) return null;
  const utcOffset = formatOffset(offsetMinutes);
  const observesDst = Boolean(row.timeZoneObservesDst);
  const offsetDst = row.timeZoneOffsetDst?.trim() ?? null;
  const offsetStd = row.timeZoneOffset?.trim() ?? null;
  const dstOn = observesDst && offsetDst ? utcOffset === offsetDst : observesDst && offsetStd ? utcOffset !== offsetStd : false;
  return {
    name: row.timeZoneName,
    utcOffset,
    dstOn,
    observesDst
  };
}

function parseListingType(value: string | null): ListingType | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "default" || normalized === "crypto" || normalized === "currency") {
    return normalized;
  }
  return null;
}

function parseIsoDate(value: string) {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const day = Number.parseInt(match[3] ?? "", 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function dayKeyFromDateParts(year: number, month: number, day: number): DayKey {
  const date = new Date(Date.UTC(year, month - 1, day));
  return DAY_KEYS[date.getUTCDay()] ?? "sunday";
}

function compareDateParts(a: { year: number; month: number; day: number }, b: { year: number; month: number; day: number }) {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

function formatIsoDate(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(parts: { year: number; month: number; day: number }, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function formatHolidayKey(year: number, month: number, day: number) {
  return `${month}/${day}/${year}`;
}

function parseHoursValue(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof value === "object") return value as Record<string, unknown>;
  return {};
}

function normalizeSession(value: unknown): Session | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const start = typeof record.start === "string" ? record.start.trim() : "";
  const end = typeof record.end === "string" ? record.end.trim() : "";
  const state = typeof record.state === "string" ? record.state.trim().toLowerCase() : "";
  if (!start || !end || !state) return null;
  return { start, end, state };
}

function normalizeSessions(input: unknown): Session[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => normalizeSession(item))
    .filter((item): item is Session => Boolean(item));
}

function normalizeHours(value: unknown): MarketHours {
  const hours = parseHoursValue(value);
  const sessionsRaw =
    typeof hours.sessions === "object" && hours.sessions !== null
      ? (hours.sessions as Record<string, unknown>)
      : {};

  const sessions = {
    sunday: normalizeSessions(sessionsRaw.sunday),
    monday: normalizeSessions(sessionsRaw.monday),
    tuesday: normalizeSessions(sessionsRaw.tuesday),
    wednesday: normalizeSessions(sessionsRaw.wednesday),
    thursday: normalizeSessions(sessionsRaw.thursday),
    friday: normalizeSessions(sessionsRaw.friday),
    saturday: normalizeSessions(sessionsRaw.saturday)
  } satisfies SessionsByDay;

  const holidays = Array.isArray(hours.holidays)
    ? hours.holidays.filter((item): item is string => typeof item === "string")
    : [];

  const earlyCloses =
    typeof hours.earlyCloses === "object" && hours.earlyCloses !== null
      ? (hours.earlyCloses as Record<string, string>)
      : {};

  return { sessions, holidays, earlyCloses };
}

function parseTimeToSeconds(value: string) {
  const parts = value.split(":").map((chunk) => Number.parseInt(chunk, 10));
  if (parts.length < 2 || parts.length > 3) return null;
  const [hours, minutes, seconds = 0] = parts;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  if (hours < 0 || hours > 24 || minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) return null;
  if (hours === 24 && (minutes !== 0 || seconds !== 0)) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function inSession(nowSeconds: number, start: number, end: number) {
  if (start === end) return false;
  if (end > start) return nowSeconds >= start && nowSeconds < end;
  return nowSeconds >= start || nowSeconds < end;
}

function normalizeMarketRange(session: Session | null, earlyClose: string | null) {
  if (!session) return null;
  if (session.state !== "market") return { start: session.start, end: session.end };
  if (!earlyClose) return { start: session.start, end: session.end };
  const endSeconds = parseTimeToSeconds(session.end);
  const earlySeconds = parseTimeToSeconds(earlyClose);
  if (endSeconds === null || earlySeconds === null) return { start: session.start, end: session.end };
  if (earlySeconds < endSeconds) {
    return { start: session.start, end: earlyClose };
  }
  return { start: session.start, end: session.end };
}

function collapseSessionRange(
  sessions: Session[],
  state: "premarket" | "market" | "postmarket",
  earlyClose: string | null
): MarketRange | null {
  const matches = sessions.filter((session) => session.state === state);
  if (!matches.length) return null;
  let minStartSeconds: number | null = null;
  let maxEndSeconds: number | null = null;
  let minStart = "";
  let maxEnd = "";

  for (const session of matches) {
    const startSeconds = parseTimeToSeconds(session.start);
    const endSeconds = parseTimeToSeconds(session.end);
    if (startSeconds === null || endSeconds === null) continue;
    if (minStartSeconds === null || startSeconds < minStartSeconds) {
      minStartSeconds = startSeconds;
      minStart = session.start;
    }
    if (maxEndSeconds === null || endSeconds > maxEndSeconds) {
      maxEndSeconds = endSeconds;
      maxEnd = session.end;
    }
  }

  if (minStartSeconds === null || maxEndSeconds === null) return null;
  if (state === "market" && earlyClose) {
    const earlySeconds = parseTimeToSeconds(earlyClose);
    if (earlySeconds !== null && earlySeconds < maxEndSeconds) {
      maxEndSeconds = earlySeconds;
      maxEnd = earlyClose;
    }
    if (maxEndSeconds <= minStartSeconds) return null;
  }
  return { start: minStart, end: maxEnd };
}

function buildMarketHoursResponse(
  sessions: Session[],
  earlyClose: string | null,
  isHoliday: boolean
): MarketHoursResponse {
  if (isHoliday) {
    return { premarket: null, market: null, postmarket: null };
  }

  return {
    premarket: collapseSessionRange(sessions, "premarket", null),
    market: collapseSessionRange(sessions, "market", earlyClose),
    postmarket: collapseSessionRange(sessions, "postmarket", null)
  };
}

function resolveMarketType(
  sessions: Session[],
  nowSeconds: number,
  earlyClose: string | null,
  isHoliday: boolean
): "closed" | "market" | "premarket" | "postmarket" {
  if (isHoliday) return "closed";

  const checkState = (state: "market" | "premarket" | "postmarket") => {
    for (const session of sessions) {
      if (session.state !== state) continue;
      const start = parseTimeToSeconds(session.start);
      if (start === null) continue;
      let end = parseTimeToSeconds(session.end);
      if (end === null) continue;
      if (state === "market" && earlyClose) {
        const earlySeconds = parseTimeToSeconds(earlyClose);
        if (earlySeconds !== null && earlySeconds < end) {
          end = earlySeconds;
        }
      }
      if (inSession(nowSeconds, start, end)) return true;
    }
    return false;
  };

  if (checkState("market")) return "market";
  if (checkState("premarket")) return "premarket";
  if (checkState("postmarket")) return "postmarket";
  return "closed";
}

async function fetchListingRow(listingId: string): Promise<ListingRow | null> {
  if (!db) return null;
  const rows = (await db.execute(sql`
    SELECT
      e.asset_class AS "assetClass",
      e.market_id AS "marketId",
      mk.country_id AS "marketCountryId"
    FROM listings e
    LEFT JOIN markets mk ON mk.id = e.market_id
    WHERE e.id = ${listingId}
    LIMIT 1
  `)) as ListingRow[];
  return rows[0] ?? null;
}

async function fetchMarketHoursByFilter(filter: SQL): Promise<MarketHoursRow | null> {
  if (!db) return null;
  const rows = (await db.execute(sql`
    SELECT
      mh.hours AS "hours",
      tz.name AS "timeZoneName",
      tz.offset AS "timeZoneOffset",
      tz.offset_dst AS "timeZoneOffsetDst",
      tz.observes_dst AS "timeZoneObservesDst"
    FROM market_hours mh
    LEFT JOIN time_zones tz ON tz.id = mh.time_zone_id
    WHERE ${filter}
    ORDER BY mh.id ASC
    LIMIT 1
  `)) as MarketHoursRow[];
  return rows[0] ?? null;
}

async function fetchMarketHoursRow(
  listingId: string,
  listingType: ListingType
): Promise<MarketHoursRow | null> {
  if (!db) return null;

  const listing = await fetchListingRow(listingId);
  const assetClass = listing?.assetClass?.trim().toLowerCase() ?? null;
  const marketId = listing?.marketId ?? null;
  const marketCountryId = listing?.marketCountryId ?? null;

  if (!listing || !assetClass) return null;

  if (listingType === "default") {
    if (assetClass === "crypto" || assetClass === "currency") return null;

    const candidates: SQL[] = [];
    if (marketId) {
      candidates.push(sql`mh.listing_id = ${listingId} AND mh.market_id = ${marketId}`);
    }
    if (marketCountryId) {
      candidates.push(sql`mh.listing_id = ${listingId} AND mh.country_id = ${marketCountryId}`);
    }
    if (marketId) {
      candidates.push(sql`
        mh.listing_id IS NULL
        AND mh.asset_class = ${assetClass}
        AND mh.market_id = ${marketId}
      `);
    }
    if (marketCountryId) {
      candidates.push(sql`
        mh.listing_id IS NULL
        AND mh.asset_class = ${assetClass}
        AND mh.country_id = ${marketCountryId}
      `);
    }
    if (marketId) {
      candidates.push(sql`mh.listing_id IS NULL AND mh.market_id = ${marketId}`);
    }
    if (marketCountryId) {
      candidates.push(sql`mh.listing_id IS NULL AND mh.country_id = ${marketCountryId}`);
    }

    for (const filter of candidates) {
      const row = await fetchMarketHoursByFilter(filter);
      if (row) return row;
    }
    return null;
  }

  if (assetClass !== listingType) return null;

  const candidates: SQL[] = [
    sql`mh.listing_id = ${listingId} AND mh.asset_class = ${assetClass}`,
    sql`mh.listing_id IS NULL AND mh.asset_class = ${assetClass}`
  ];

  for (const filter of candidates) {
    const row = await fetchMarketHoursByFilter(filter);
    if (row) return row;
  }
  return null;
}

export async function getMarketHours(c: ApiContext) {
  try {
    if (!db) {
      return c.json({ error: "Database connection is not configured." }, 503);
    }

    const request = c.req.raw;
    const searchParams = await resolveSearchParams(request);

    const listingId = searchParams.get("listing_id")?.trim();
    const listingTypeRaw = searchParams.get("listingType")?.trim() ?? null;
    const listingType = parseListingType(listingTypeRaw);
    const dateParam = searchParams.get("date")?.trim() ?? null;
    const startDateParam = searchParams.get("startDate")?.trim() ?? null;
    const endDateParam = searchParams.get("endDate")?.trim() ?? null;

    if (!listingId || !listingTypeRaw) {
      return c.json({ error: "listing_id and listingType are required." }, 400);
    }
    if (!listingType) {
      return c.json({ error: "listingType must be default, crypto, or currency." }, 400);
    }

    if ((startDateParam && !endDateParam) || (!startDateParam && endDateParam)) {
      return c.json({ error: "startDate and endDate must be provided together." }, 400);
    }
    if (startDateParam && endDateParam && dateParam) {
      return c.json({ error: "Use either date or startDate/endDate, not both." }, 400);
    }

    if (startDateParam && endDateParam) {
      const startDate = parseIsoDate(startDateParam);
      const endDate = parseIsoDate(endDateParam);
      if (!startDate || !endDate) {
        return c.json({ error: "startDate and endDate must be in YYYY-MM-DD format." }, 400);
      }
      if (compareDateParts(startDate, endDate) > 0) {
        return c.json({ error: "startDate must be on or before endDate." }, 400);
      }

      const row = await fetchMarketHoursRow(listingId, listingType);
      if (!row) {
        return c.json({ data: {} });
      }

      const hours = normalizeHours(row.hours);
      const response: Record<string, { isHoliday: boolean; timeZone: TimeZoneResponse; marketHors: MarketHoursResponse }> = {};

      let cursor = startDate;
      while (compareDateParts(cursor, endDate) <= 0) {
        const dateKey = formatIsoDate(cursor.year, cursor.month, cursor.day);
        const dateForOffset = new Date(Date.UTC(cursor.year, cursor.month - 1, cursor.day, 12, 0, 0));
        const timeZone = resolveTimeZoneResponse(row, dateForOffset);
        if (!timeZone) {
          return c.json({ error: "Market hours time zone is not configured." }, 500);
        }
        const dayKey = dayKeyFromDateParts(cursor.year, cursor.month, cursor.day);
        const holidayKey = formatHolidayKey(cursor.year, cursor.month, cursor.day);
        const isHoliday = hours.holidays.includes(holidayKey);
        const earlyClose = hours.earlyCloses[holidayKey] ?? null;
        const sessions = hours.sessions[dayKey] ?? [];
        const marketHors = buildMarketHoursResponse(sessions, earlyClose, isHoliday);
        response[dateKey] = { isHoliday, timeZone, marketHors };
        cursor = addDays(cursor, 1);
      }

      return c.json({ data: response });
    }

    if (dateParam) {
      const parsedDate = parseIsoDate(dateParam);
      if (!parsedDate) {
        return c.json({ error: "date must be in YYYY-MM-DD format." }, 400);
      }

      const row = await fetchMarketHoursRow(listingId, listingType);
      if (!row) {
        return c.json({ data: {} });
      }

      const dateForOffset = new Date(Date.UTC(parsedDate.year, parsedDate.month - 1, parsedDate.day, 12, 0, 0));
      const timeZone = resolveTimeZoneResponse(row, dateForOffset);
      if (!timeZone) {
        return c.json({ error: "Market hours time zone is not configured." }, 500);
      }

      const hours = normalizeHours(row.hours);
      const dayKey = dayKeyFromDateParts(parsedDate.year, parsedDate.month, parsedDate.day);
      const holidayKey = formatHolidayKey(parsedDate.year, parsedDate.month, parsedDate.day);
      const isHoliday = hours.holidays.includes(holidayKey);
      const earlyClose = hours.earlyCloses[holidayKey] ?? null;
      const sessions = hours.sessions[dayKey] ?? [];
      const marketHors = buildMarketHoursResponse(sessions, earlyClose, isHoliday);

      return c.json({ data: { isHoliday, timeZone, marketHors } });
    }

    const row = await fetchMarketHoursRow(listingId, listingType);
    if (!row) {
      return c.json({ data: {} });
    }

    const now = new Date();
    const timeZone = resolveTimeZoneResponse(row, now);
    if (!timeZone) {
      return c.json({ error: "Market hours time zone is not configured." }, 500);
    }

    const nowParts = parseDatePartsFromZone(now, row.timeZoneName!);
    if (!nowParts) {
      return c.json({ error: "Unable to resolve time zone for market hours." }, 500);
    }

    const hours = normalizeHours(row.hours);
    const holidayKey = formatHolidayKey(nowParts.year, nowParts.month, nowParts.day);
    const isHoliday = hours.holidays.includes(holidayKey);
    const earlyClose = hours.earlyCloses[holidayKey] ?? null;
    const sessions = hours.sessions[nowParts.weekdayKey] ?? [];
    const nowSeconds = nowParts.hour * 3600 + nowParts.minute * 60 + nowParts.second;

    const marketType = resolveMarketType(sessions, nowSeconds, earlyClose, isHoliday);

    return c.json({ data: { isHoliday, timeZone, marketType } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[get/market-hours] API error:", message);
    return c.json({ error: message }, 500);
  }
}
