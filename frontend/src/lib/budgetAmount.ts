import { parseIndianAmount } from "./parseAmount";

export const MONTHLY_BUDGET_MAX = 999_999_999_999.99;

export function sanitizeBudgetDraft(raw: string): string {
  let seenDot = false;
  let frac = 0;
  let out = "";
  for (const ch of raw) {
    if (ch === ",") continue;
    if (ch >= "0" && ch <= "9") {
      if (seenDot) {
        if (frac >= 2) continue;
        frac += 1;
      }
      out += ch;
      continue;
    }
    if (ch === "." && !seenDot) {
      seenDot = true;
      out += ".";
    }
  }
  return out;
}

export function budgetDraftIsTemporary(draft: string): boolean {
  const trimmed = draft.trim();
  return trimmed === "" || trimmed === "." || trimmed.endsWith(".");
}

export function formatBudgetAmount(value: number): string {
  return value.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
}

export function parseBudgetCommit(
  draft: string
): { ok: true; value: number } | { ok: false; message: string } {
  if (budgetDraftIsTemporary(draft)) {
    return { ok: false, message: "Enter an amount that is zero or greater" };
  }
  const { value, decimalPlaces } = parseIndianAmount(draft);
  if (value == null || !Number.isFinite(value) || value < 0) {
    return { ok: false, message: "Enter an amount that is zero or greater" };
  }
  if (decimalPlaces > 2) {
    return { ok: false, message: "Use at most two decimal places" };
  }
  if (value > MONTHLY_BUDGET_MAX) {
    return { ok: false, message: "Amount exceeds the maximum" };
  }
  return { ok: true, value };
}
