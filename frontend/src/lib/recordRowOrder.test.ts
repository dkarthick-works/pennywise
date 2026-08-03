import { describe, it, expect } from "vitest";
import { preserveApiRowOrder, sortRowsByDateDesc } from "./recordRowOrder";
import type { Transaction } from "../types";

function txn(partial: Partial<Transaction> & Pick<Transaction, "id" | "date">): Transaction {
  return {
    section: "daily",
    category: "x",
    amount: 1,
    kind: "cash",
    ...partial,
  };
}

describe("preserveApiRowOrder", () => {
  it("keeps Essential/Flexible open-month order as given", () => {
    const rows = [
      txn({ id: "b", date: "2026-06-01", category: "Newer-looking", section: "essential" }),
      txn({ id: "a", date: "2026-06-10", category: "Older-looking", section: "essential" }),
    ];
    expect(preserveApiRowOrder(rows).map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("sortRowsByDateDesc", () => {
  it("orders Daily/Income by date desc then id desc", () => {
    const rows = [
      txn({ id: "a", date: "2026-06-01", section: "daily" }),
      txn({ id: "c", date: "2026-06-10", section: "daily" }),
      txn({ id: "b", date: "2026-06-10", section: "daily" }),
    ];
    expect(sortRowsByDateDesc(rows).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("does not mutate the input array", () => {
    const rows = [txn({ id: "a", date: "2026-06-01" }), txn({ id: "b", date: "2026-06-02" })];
    const before = rows.map((r) => r.id);
    sortRowsByDateDesc(rows);
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});
