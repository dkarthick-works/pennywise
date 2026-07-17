import type { QueryClient } from "@tanstack/react-query";
import {
  isTransactionNameSuggestionSection,
  transactionNameSuggestionKeys,
} from "./transactionNameSuggestions";
import type { TransactionNameSuggestionSection } from "../types";

export function invalidateMonthCaches(qc: QueryClient, month: string): void {
  qc.invalidateQueries({ queryKey: ["open-month", month] });
  qc.invalidateQueries({ queryKey: ["txns", "month", month] });
  qc.invalidateQueries({ queryKey: ["dashboard", "monthly", month] });
  qc.invalidateQueries({ queryKey: ["group-spend", month] });
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
