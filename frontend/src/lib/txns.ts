// Transaction aggregation helpers — port of data.jsx countsIn / sectionSums

import type { Section, Transaction, TxnKind } from "../types";

export const EXPENSE_SECTIONS = ["essential", "flexible", "daily"] as const;

export function isExpenseSection(section: Section): section is typeof EXPENSE_SECTIONS[number] {
  return (EXPENSE_SECTIONS as readonly Section[]).includes(section);
}

export function creditExpenseTransactions(txns: Transaction[]): Transaction[] {
  return txns.filter((t) => t.kind === "credit" && isExpenseSection(t.section));
}

export type ViewMode = "incurred" | "cashout";

/** Explicit inclusion — new kinds must not silently enter incurred totals. */
export function isIncurredExpenseKind(kind: TxnKind): boolean {
  return kind === "cash" || kind === "credit";
}

export function countsIn(t: Transaction, mode: ViewMode): boolean {
  if (mode === "incurred") return isIncurredExpenseKind(t.kind);
  return t.kind !== "credit";
}

const MONTH_KEY_RE = /^(\d{4})-(\d{2})$/;

export interface DailySpendDay {
  date: string; // YYYY-MM-DD
  day: number;
  value: number;
}

/** Days in month via UTC (same policy as dates.ts month-length helpers). */
function daysInMonthUTC(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/**
 * Daily-section cash+credit spend per calendar day for `month` (YYYY-MM).
 * Fills every day (₹0 when empty). Invalid month → []. Future-dated txns included.
 */
export function dailySpendByDay(txns: Transaction[], month: string): DailySpendDay[] {
  const m = MONTH_KEY_RE.exec(month);
  if (!m) return [];
  const year = Number(m[1]);
  const monthNum = Number(m[2]);
  if (monthNum < 1 || monthNum > 12) return [];

  const lastDay = daysInMonthUTC(year, monthNum);
  const byDate = new Map<string, number>();

  for (const t of txns) {
    if (t.section !== "daily") continue;
    if (!isIncurredExpenseKind(t.kind)) continue;
    if (t.date.slice(0, 7) !== month) continue;
    byDate.set(t.date, (byDate.get(t.date) ?? 0) + t.amount);
  }

  const out: DailySpendDay[] = [];
  for (let day = 1; day <= lastDay; day++) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    out.push({ date, day, value: byDate.get(date) ?? 0 });
  }
  return out;
}

export interface DailySpendAverage {
  avg: number;
  numerator: number;
  divisor: number;
  soFar: boolean;
}

/**
 * Average Daily spend per day for the chart header.
 * Current month: numerator = series through today; divisor = today's day-of-month; soFar=true.
 * Past/future month: full series sum / series.length; soFar=false.
 */
export function dailySpendAverage(
  series: DailySpendDay[],
  selectedMonth: string,
  today: string
): DailySpendAverage {
  if (series.length === 0) {
    return { avg: 0, numerator: 0, divisor: 0, soFar: false };
  }

  const soFar = today.slice(0, 7) === selectedMonth;
  if (soFar) {
    const todayDay = parseInt(today.slice(8, 10), 10);
    const numerator = series
      .filter((d) => d.date <= today)
      .reduce((s, d) => s + d.value, 0);
    const divisor = Number.isFinite(todayDay) && todayDay > 0 ? todayDay : 0;
    return {
      avg: divisor > 0 ? numerator / divisor : 0,
      numerator,
      divisor,
      soFar: true,
    };
  }

  const numerator = series.reduce((s, d) => s + d.value, 0);
  const divisor = series.length;
  return {
    avg: divisor > 0 ? numerator / divisor : 0,
    numerator,
    divisor,
    soFar: false,
  };
}

export function sectionSums(
  txns: Transaction[],
  month: string,
  mode: ViewMode
): { essential: number; flexible: number; daily: number } {
  const out = { essential: 0, flexible: 0, daily: 0 };
  for (const t of txns) {
    // Income is not an expense section — exclude it from expense aggregations.
    if (t.section === "income") continue;
    if (t.date.slice(0, 7) === month && countsIn(t, mode)) {
      out[t.section as "essential" | "flexible" | "daily"] =
        (out[t.section as "essential" | "flexible" | "daily"] || 0) + t.amount;
    }
  }
  return out;
}

// Sum income transactions for a given month (all income is always cash received).
export function incomeSum(txns: Transaction[], month: string): number {
  return txns
    .filter((t) => t.section === "income" && t.date.slice(0, 7) === month)
    .reduce((s, t) => s + t.amount, 0);
}

// Credits that have been settled (by checking the settled flag or settles refs).
export function settledCreditIds(txns: Transaction[]): Set<string> {
  const s = new Set<string>();
  for (const t of txns) {
    if (t.kind === "settlement" && Array.isArray(t.settles)) {
      t.settles.forEach((id) => s.add(id));
    }
  }
  return s;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
