// Statement-cycle date math, mirrored from the Go helper
// (backend/internal/api/billing_cycle.go). Used only for the Settings live
// preview; the backend response remains authoritative for dashboard totals.
//
// The statement day is the inclusive closing day. For a given "YYYY-MM" month,
// the cycle ends on the (clamped) closing day within that month and begins the
// day after the previous month's (clamped) closing day.

import { MONTH_NAMES } from "./dates";

export interface CycleRange {
  from: string; // YYYY-MM-DD inclusive
  to: string;   // YYYY-MM-DD inclusive
}

function daysInMonth(year: number, month1: number): number {
  // month1 is 1-based; day 0 of the next month is this month's last day.
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function clampDay(day: number, monthLen: number): number {
  return day > monthLen ? monthLen : day;
}

function iso(year: number, month1: number, day: number): string {
  return `${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Returns the inclusive statement-cycle window for a "YYYY-MM" month and a
 * statement day (1..31), or null when inputs are invalid.
 */
export function statementCycleForMonth(month: string, statementDay: number): CycleRange | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  if (!Number.isInteger(statementDay) || statementDay < 1 || statementDay > 31) return null;

  const [year, month1] = month.split("-").map(Number);
  if (month1 < 1 || month1 > 12) return null;

  const closeThisDay = clampDay(statementDay, daysInMonth(year, month1));

  // Previous month (handles January -> previous December).
  let prevYear = year;
  let prevMonth = month1 - 1;
  if (prevMonth < 1) {
    prevMonth = 12;
    prevYear -= 1;
  }
  const closePrevDay = clampDay(statementDay, daysInMonth(prevYear, prevMonth));

  // Day after the previous close = cycle start.
  const start = new Date(Date.UTC(prevYear, prevMonth - 1, closePrevDay + 1));
  const from = iso(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate());
  const to = iso(year, month1, closeThisDay);
  return { from, to };
}

/** '2026-06-16' → '16 June' */
export function longDayMonth(dateISO: string): string {
  const [, m, d] = dateISO.split("-");
  return `${parseInt(d, 10)} ${MONTH_NAMES[parseInt(m, 10) - 1]}`;
}

/**
 * Human sentence for the Settings preview, e.g.
 * "Your July billing cycle: 16 June – 15 July".
 */
export function cyclePreviewSentence(month: string, statementDay: number): string | null {
  const range = statementCycleForMonth(month, statementDay);
  if (!range) return null;
  const [, month1] = month.split("-").map(Number);
  const statementMonthName = MONTH_NAMES[month1 - 1];
  return `Your ${statementMonthName} billing cycle: ${longDayMonth(range.from)} – ${longDayMonth(range.to)}`;
}
