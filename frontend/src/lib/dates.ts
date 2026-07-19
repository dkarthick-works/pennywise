// Date helpers — port of data.jsx

export const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

export function monthLabel(key: string): string {
  if (!key) return "";
  const [y, m] = key.split("-");
  return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
}

// '2026-06' → '06-2026'
export function monthCode(key: string): string {
  return key ? key.slice(5) + "-" + key.slice(0, 4) : "";
}

export function shiftMonth(key: string, delta: number): string {
  let [y, m] = key.split("-").map(Number);
  m += delta;
  while (m > 12) { m -= 12; y++; }
  while (m < 1)  { m += 12; y--; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

/**
 * Move a date into a target month, keeping the day-of-month but clamping it to
 * the last valid day of that month. Timezone-safe (UTC). Handles 30-day months
 * and leap/non-leap February: '2026-01-31' → Feb 2026 → '2026-02-28',
 * '2024-01-31' → '2024-02-29', '2026-03-31' → '2026-04-30'.
 */
export function shiftDateToMonth(date: string, targetMonth: string): string {
  const day = parseInt(date.slice(8, 10), 10);
  const [y, m] = targetMonth.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const clamped = Math.min(day, lastDay);
  return `${targetMonth}-${String(clamped).padStart(2, "0")}`;
}

// '2026-06-03' → '3 Jun'
export function prettyDate(d: string): string {
  if (!d) return "";
  const [, m, dd] = d.split("-");
  return `${parseInt(dd, 10)} ${MONTH_NAMES[parseInt(m, 10) - 1].slice(0, 3)}`;
}

export function monthKey(dateStr: string): string {
  return dateStr ? dateStr.slice(0, 7) : "";
}

export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Latest date among entries, or today-in-month when the table is empty. */
export function defaultDraftDate(month: string, dates: string[]): string {
  if (dates.length > 0) return dates.reduce((a, b) => (a > b ? a : b));
  const today = new Date();
  return `${month}-${String(today.getDate()).padStart(2, "0")}`.slice(0, 10);
}
