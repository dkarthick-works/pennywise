import type { Transaction } from "../types";

/** Daily/Income display order: newest txn_date first, then id. */
export function sortRowsByDateDesc(rows: Transaction[]): Transaction[] {
  return [...rows].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

/** Essential/Flexible: keep open-month API order (status filter only). */
export function preserveApiRowOrder(rows: Transaction[]): Transaction[] {
  return rows;
}
