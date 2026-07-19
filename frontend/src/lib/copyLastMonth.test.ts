import { describe, it, expect } from "vitest";
import { buildCopyLastMonthPlan } from "./copyLastMonth";
import type { Section, Transaction, TxnKind } from "../types";

let seq = 0;
function txn(partial: Partial<Transaction> & { section: Section }): Transaction {
  seq += 1;
  return {
    id: partial.id ?? `t${seq}`,
    section: partial.section,
    category: partial.category ?? "Rent",
    amount: partial.amount ?? 100,
    date: partial.date ?? "2026-06-10",
    kind: (partial.kind ?? "cash") as TxnKind,
    settles: partial.settles,
    settled: partial.settled,
  };
}

const plan = (args: {
  section: Section;
  targetMonth?: string;
  sourceTxns: Transaction[];
  currentTxns?: Transaction[];
}) =>
  buildCopyLastMonthPlan({
    section: args.section,
    targetMonth: args.targetMonth ?? "2026-07",
    sourceTxns: args.sourceTxns,
    currentTxns: args.currentTxns ?? [],
  });

describe("buildCopyLastMonthPlan — eligibility", () => {
  it("keeps only rows from the requested section", () => {
    const p = plan({
      section: "essential",
      sourceTxns: [
        txn({ section: "essential", category: "Rent", amount: 100 }),
        txn({ section: "flexible", category: "Netflix", amount: 50 }),
      ],
    });
    expect(p.eligibleCount).toBe(1);
    expect(p.inserts).toHaveLength(1);
    expect(p.inserts[0].category).toBe("Rent");
  });

  it("skips settlements", () => {
    const p = plan({
      section: "flexible",
      sourceTxns: [
        txn({ section: "flexible", category: "Card clear", amount: 200, kind: "settlement" }),
        txn({ section: "flexible", category: "Netflix", amount: 50, kind: "cash" }),
      ],
    });
    expect(p.eligibleCount).toBe(1);
    expect(p.inserts[0].category).toBe("Netflix");
  });

  it("skips empty categories and non-positive amounts", () => {
    const p = plan({
      section: "essential",
      sourceTxns: [
        txn({ section: "essential", category: "   ", amount: 100 }),
        txn({ section: "essential", category: "Rent", amount: 0 }),
        txn({ section: "essential", category: "Savings", amount: -5 }),
        txn({ section: "essential", category: "EMI", amount: 100 }),
      ],
    });
    expect(p.eligibleCount).toBe(1);
    expect(p.inserts[0].category).toBe("EMI");
  });

  it("income allows only cash", () => {
    const p = plan({
      section: "income",
      sourceTxns: [
        txn({ section: "income", category: "Salary", amount: 1000, kind: "cash" }),
        txn({ section: "income", category: "Bonus", amount: 500, kind: "credit" }),
      ],
    });
    expect(p.eligibleCount).toBe(1);
    expect(p.inserts[0].category).toBe("Salary");
  });

  it("essential/flexible allow cash and credit", () => {
    const p = plan({
      section: "essential",
      sourceTxns: [
        txn({ section: "essential", category: "Rent", amount: 100, kind: "cash" }),
        txn({ section: "essential", category: "Phone", amount: 40, kind: "credit" }),
      ],
    });
    expect(p.eligibleCount).toBe(2);
    expect(p.inserts).toHaveLength(2);
  });
});

describe("buildCopyLastMonthPlan — payload shape", () => {
  it("insert payloads only carry copyable fields (no id/settles/settled)", () => {
    const p = plan({
      section: "flexible",
      sourceTxns: [
        txn({ section: "flexible", category: "Phone", amount: 40, kind: "credit", date: "2026-06-05" }),
      ],
    });
    expect(p.inserts[0]).toEqual({
      date: "2026-07-05",
      section: "flexible",
      category: "Phone",
      amount: 40,
      kind: "credit",
    });
    expect(p.inserts[0]).not.toHaveProperty("id");
    expect(p.inserts[0]).not.toHaveProperty("settles");
    expect(p.inserts[0]).not.toHaveProperty("settled");
  });

  it("trims the copied category", () => {
    const p = plan({
      section: "essential",
      sourceTxns: [txn({ section: "essential", category: "  Rent  ", amount: 100 })],
    });
    expect(p.inserts[0].category).toBe("Rent");
  });

  it("remaps and clamps the date into the target month", () => {
    const p = plan({
      section: "essential",
      targetMonth: "2026-02",
      sourceTxns: [txn({ section: "essential", category: "Rent", amount: 100, date: "2026-01-31" })],
    });
    expect(p.inserts[0].date).toBe("2026-02-28");
  });

  it("preserves source order", () => {
    const p = plan({
      section: "daily",
      sourceTxns: [
        txn({ section: "daily", category: "A", amount: 1, date: "2026-06-01" }),
        txn({ section: "daily", category: "B", amount: 2, date: "2026-06-02" }),
        txn({ section: "daily", category: "C", amount: 3, date: "2026-06-03" }),
      ],
    });
    expect(p.inserts.map((i) => i.category)).toEqual(["A", "B", "C"]);
  });
});

describe("buildCopyLastMonthPlan — fill vs insert", () => {
  it("fills a matching zero-value cash row and reports amount/kind/date/category", () => {
    const p = plan({
      section: "essential",
      sourceTxns: [txn({ section: "essential", category: "Rent", amount: 25000, date: "2026-06-03" })],
      currentTxns: [
        txn({ id: "zero1", section: "essential", category: "Rent", amount: 0, kind: "cash" }),
      ],
    });
    expect(p.inserts).toHaveLength(0);
    expect(p.fills).toEqual([
      { id: "zero1", patch: { date: "2026-07-03", amount: 25000, kind: "cash", category: "Rent" } },
    ]);
  });

  it("overwrites a manually created zero cash row (no seed provenance)", () => {
    const p = plan({
      section: "flexible",
      sourceTxns: [txn({ section: "flexible", category: "Gym", amount: 800 })],
      currentTxns: [txn({ id: "manual", section: "flexible", category: "Gym", amount: 0, kind: "cash" })],
    });
    expect(p.fills).toHaveLength(1);
    expect(p.fills[0].id).toBe("manual");
  });

  it("category match is case-sensitive (Rent ≠ rent)", () => {
    const p = plan({
      section: "essential",
      sourceTxns: [txn({ section: "essential", category: "Rent", amount: 100 })],
      currentTxns: [txn({ id: "z", section: "essential", category: "rent", amount: 0, kind: "cash" })],
    });
    expect(p.fills).toHaveLength(0);
    expect(p.inserts).toHaveLength(1);
  });

  it("does not fill a non-zero existing row", () => {
    const p = plan({
      section: "essential",
      sourceTxns: [txn({ section: "essential", category: "Rent", amount: 100 })],
      currentTxns: [txn({ id: "z", section: "essential", category: "Rent", amount: 500, kind: "cash" })],
    });
    expect(p.fills).toHaveLength(0);
    expect(p.inserts).toHaveLength(1);
  });

  it("does not fill a zero credit row (only cash rows are fillable)", () => {
    const p = plan({
      section: "essential",
      sourceTxns: [txn({ section: "essential", category: "Rent", amount: 100 })],
      currentTxns: [txn({ id: "z", section: "essential", category: "Rent", amount: 0, kind: "credit" })],
    });
    expect(p.fills).toHaveLength(0);
    expect(p.inserts).toHaveLength(1);
  });

  it("consumes each matching zero row once; extra source rows become inserts", () => {
    const p = plan({
      section: "flexible",
      sourceTxns: [
        txn({ section: "flexible", category: "Coffee", amount: 10 }),
        txn({ section: "flexible", category: "Coffee", amount: 12 }),
      ],
      currentTxns: [txn({ id: "z", section: "flexible", category: "Coffee", amount: 0, kind: "cash" })],
    });
    expect(p.fills).toHaveLength(1);
    expect(p.inserts).toHaveLength(1);
    expect(p.inserts[0].amount).toBe(12);
  });

  it("income never fills — always inserts", () => {
    const p = plan({
      section: "income",
      sourceTxns: [txn({ section: "income", category: "Salary", amount: 1000, kind: "cash" })],
      currentTxns: [txn({ id: "z", section: "income", category: "Salary", amount: 0, kind: "cash" })],
    });
    expect(p.fills).toHaveLength(0);
    expect(p.inserts).toHaveLength(1);
  });
});

describe("buildCopyLastMonthPlan — empty", () => {
  it("returns zero eligible when nothing qualifies", () => {
    const p = plan({
      section: "essential",
      sourceTxns: [txn({ section: "flexible", category: "Netflix", amount: 50 })],
    });
    expect(p.eligibleCount).toBe(0);
    expect(p.fills).toHaveLength(0);
    expect(p.inserts).toHaveLength(0);
  });
});
