// Transaction aggregation helpers — port of data.jsx countsIn / sectionSums

import type { Section, Transaction } from "../types";

export const EXPENSE_SECTIONS = ["essential", "flexible", "daily"] as const;

export function isExpenseSection(section: Section): section is typeof EXPENSE_SECTIONS[number] {
  return (EXPENSE_SECTIONS as readonly Section[]).includes(section);
}

export function creditExpenseTransactions(txns: Transaction[]): Transaction[] {
  return txns.filter((t) => t.kind === "credit" && isExpenseSection(t.section));
}

export type ViewMode = "incurred" | "cashout";

export function countsIn(t: Transaction, mode: ViewMode): boolean {
  if (mode === "incurred") return t.kind !== "settlement";
  return t.kind !== "credit";
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
