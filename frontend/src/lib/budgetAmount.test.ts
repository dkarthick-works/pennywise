import { describe, expect, it } from "vitest";
import {
  MONTHLY_BUDGET_MAX,
  formatBudgetAmount,
  parseBudgetCommit,
  sanitizeBudgetDraft,
} from "./budgetAmount";

describe("sanitizeBudgetDraft", () => {
  it("keeps digits, one dot, and at most two fractional digits", () => {
    expect(sanitizeBudgetDraft("10,000.25")).toBe("10000.25");
    expect(sanitizeBudgetDraft("10000.251")).toBe("10000.25");
    expect(sanitizeBudgetDraft("12.3.")).toBe("12.3");
  });

  it("allows an empty or trailing-dot draft", () => {
    expect(sanitizeBudgetDraft("")).toBe("");
    expect(sanitizeBudgetDraft(".")).toBe(".");
    expect(sanitizeBudgetDraft("12.")).toBe("12.");
  });
});

describe("parseBudgetCommit", () => {
  it("accepts zero, integers, and two-decimal values", () => {
    expect(parseBudgetCommit("0")).toEqual({ ok: true, value: 0 });
    expect(parseBudgetCommit("15000")).toEqual({ ok: true, value: 15000 });
    expect(parseBudgetCommit("10,000.25")).toEqual({ ok: true, value: 10000.25 });
  });

  it("rejects temporary, over-precise, and oversized values", () => {
    expect(parseBudgetCommit("").ok).toBe(false);
    expect(parseBudgetCommit("12.").ok).toBe(false);
    expect(parseBudgetCommit("1.001").ok).toBe(false);
    expect(parseBudgetCommit(String(MONTHLY_BUDGET_MAX + 1)).ok).toBe(false);
  });
});

describe("formatBudgetAmount", () => {
  it("formats integers and two-decimal values with Indian grouping", () => {
    expect(formatBudgetAmount(0)).toBe("0");
    expect(formatBudgetAmount(15000)).toBe("15,000");
    expect(formatBudgetAmount(10000.25)).toBe("10,000.25");
  });
});
