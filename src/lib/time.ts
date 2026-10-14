// All times are stored in UTC and shown in the event time zone.
export const EVENT_TZ = "America/Chicago";

function offsetMs(utcMs: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - utcMs;
}

/** Wall-clock time in `tz` -> the UTC instant. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz = EVENT_TZ) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - offsetMs(guess, tz);
  t = guess - offsetMs(t, tz); // second pass handles DST boundaries
  return new Date(t);
}

/** Parses "YYYY-MM-DD" + "HH:mm" as event-zone wall-clock time. Returns null if malformed. */
export function parseZoned(date: string, time: string) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  return zonedToUtc(+d[1], +d[2], +d[3], +t[1], +t[2]);
}

export function formatSession(date: Date, tz = EVENT_TZ) {
  return date.toLocaleString("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatMoney(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
