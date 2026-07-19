import type { QueryClient } from "@tanstack/react-query";
import {
  isTransactionNameSuggestionSection,
  transactionNameSuggestionKeys,
} from "./transactionNameSuggestions";
import { creditUsageKeys } from "../api/ledger";
import type { TransactionNameSuggestionSection } from "../types";

// Credit usage crosses month boundaries: a transaction in one calendar month
// can belong to a statement cycle that closes in the next. Invalidating only
// the mutated month's summary would leave adjacent cycles stale, so we always
// invalidate the entire credit-usage and credit-transactions key space.
export function invalidateCreditCaches(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: creditUsageKeys.all });
  qc.invalidateQueries({ queryKey: creditUsageKeys.detailAll });
}

export function invalidateMonthCaches(qc: QueryClient, month: string): void {
  qc.invalidateQueries({ queryKey: ["open-month", month] });
  qc.invalidateQueries({ queryKey: ["txns", "month", month] });
  qc.invalidateQueries({ queryKey: ["dashboard", "monthly", month] });
  qc.invalidateQueries({ queryKey: ["group-spend", month] });
  invalidateCreditCaches(qc);
}

export function invalidateTransactionNameSuggestions(
  qc: QueryClient,
  section: string
): void {
  if (!isTransactionNameSuggestionSection(section)) return;
  qc.invalidateQueries({ queryKey: transactionNameSuggestionKeys.section(section) });
}

export function invalidateTransactionNameSuggestionSections(
  qc: QueryClient,
  sections: Iterable<string>
): void {
  const supported = new Set<TransactionNameSuggestionSection>();
  for (const section of sections) {
    if (isTransactionNameSuggestionSection(section)) supported.add(section);
  }
  supported.forEach((section) => invalidateTransactionNameSuggestions(qc, section));
}

export function invalidateImportCaches(qc: QueryClient, months: string[]): void {
  months.forEach((m) => invalidateMonthCaches(qc, m));
  invalidateTransactionNameSuggestionSections(qc, ["daily", "income"]);
}
