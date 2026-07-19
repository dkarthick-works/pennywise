// Pure planning for the "Copy last month" record action. No I/O: given the
// previous month's transactions and the current month's rows for one section,
// decide which eligible source rows become atomic inserts and which fill an
// existing zero-value cash row in the current month.

import type { Section, Transaction, ImportRowPayload } from "../types";
import { shiftDateToMonth } from "./dates";

export interface CopyFill {
  id: string;
  patch: { date: string; amount: number; kind: "cash" | "credit"; category: string };
}

export interface CopyLastMonthPlan {
  fills: CopyFill[];
  inserts: ImportRowPayload[];
  eligibleCount: number;
}

// A source row is eligible only if it belongs to the section, has a real
// category and amount, and a copyable kind. Income is cash-only; essential and
// flexible allow cash or credit. Settlements are always skipped.
function isEligible(t: Transaction, section: Section): boolean {
  if (t.section !== section) return false;
  if (t.kind === "settlement") return false;
  if (!t.category.trim()) return false;
  if (!(t.amount > 0)) return false;
  if (section === "income") return t.kind === "cash";
  return t.kind === "cash" || t.kind === "credit";
}

export function buildCopyLastMonthPlan({
  section,
  targetMonth,
  sourceTxns,
  currentTxns,
}: {
  section: Section;
  targetMonth: string;
  sourceTxns: Transaction[];
  currentTxns: Transaction[];
}): CopyLastMonthPlan {
  const eligible = sourceTxns.filter((t) => isEligible(t, section));

  // Fillable pool: current-month zero-value cash rows in this section. Income
  // has no seeded rows, so it never fills — every eligible row is an insert.
  const zeroPool =
    section === "income"
      ? []
      : currentTxns.filter(
          (t) => t.section === section && t.amount === 0 && t.kind === "cash"
        );
  const usedIds = new Set<string>();

  const fills: CopyFill[] = [];
  const inserts: ImportRowPayload[] = [];

  for (const src of eligible) {
    const category = src.category.trim();
    const date = shiftDateToMonth(src.date, targetMonth);
    const kind = src.kind as "cash" | "credit";

    // Trimmed, case-sensitive category match; each zero row is consumed once.
    const match =
      section === "income"
        ? undefined
        : zeroPool.find((z) => !usedIds.has(z.id) && z.category.trim() === category);

    if (match) {
      usedIds.add(match.id);
      fills.push({ id: match.id, patch: { date, amount: src.amount, kind, category } });
    } else {
      inserts.push({ date, section, category, amount: src.amount, kind });
    }
  }

  return { fills, inserts, eligibleCount: eligible.length };
}
