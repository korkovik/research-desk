/**
 * Dates are decided in the configured timezone, not in the machine's. The run
 * fires at 06:00 Europe/Prague; if the host is ever on UTC, "today" must still
 * be the Prague day the family will read, and the archive filename must match.
 */

/** `YYYY-MM-DD` for an instant, in the given IANA timezone. */
export function localDateISO(when: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the shape we store.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(when);
}

/** 1 = Monday … 7 = Sunday, in the given timezone. Explicit, unlike `getDay()`. */
export function localWeekday(when: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(when);
  const order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const index = order.indexOf(name);
  if (index < 0) throw new Error(`unexpected weekday ${name} for timezone ${timeZone}`);
  return index + 1;
}

/** `YYYY-MM-DD` shifted by whole days. Operates on the date string, so it is timezone-free. */
export function shiftISODate(isoDate: string, days: number): string {
  const parsed = parseISODate(isoDate);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** Whole days between two `YYYY-MM-DD` values (b - a). */
export function daysBetween(a: string, b: string): number {
  const ms = parseISODate(b).getTime() - parseISODate(a).getTime();
  return Math.round(ms / 86_400_000);
}

export function isISODate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parseISODate(value).getTime());
}

function parseISODate(isoDate: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error(`not a YYYY-MM-DD date: ${isoDate}`);
  return new Date(`${isoDate}T00:00:00Z`);
}

/** arXiv's query grammar wants `YYYYMMDDHHMM` in UTC. */
export function arxivStamp(when: Date): string {
  const iso = when.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}`;
}
