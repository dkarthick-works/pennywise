import type { TransactionNameSuggestionSection } from "../types";

export function normalizeTransactionNameQuery(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

export const transactionNameSuggestionKeys = {
  all: ["transaction-name-suggestions"] as const,
  section: (section: TransactionNameSuggestionSection) =>
    ["transaction-name-suggestions", section] as const,
  search: (section: TransactionNameSuggestionSection, query: string) =>
    ["transaction-name-suggestions", section, normalizeTransactionNameQuery(query)] as const,
};

export function isTransactionNameSuggestionSection(
  section: string
): section is TransactionNameSuggestionSection {
  return section === "daily" || section === "income";
}
