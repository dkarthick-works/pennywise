import { describe, expect, it } from "vitest";
import {
  compareWithPrevious,
  contributionPercentage,
  monthlyCostShare,
  normalizeComparisonRange,
  periodAverage,
} from "./groupSpendComparison";
import type { GroupSpendHistoryBucket } from "../types";

function bucket(month: string, total: number, count = total === 0 ? 0 : 1): GroupSpendHistoryBucket {
  return {
    month,
    total,
    transaction_count: count,
    average_transaction: count ? total / count : null,
    median_transaction: count ? total / count : null,
    largest_transaction: count ? total : null,
    categories: [],
  };
}

describe("group spend comparison calculations", () => {
  it("averages every displayed month, including zero months", () => {
    expect(periodAverage([
      bucket("2026-06", 300),
      bucket("2026-07", 0),
      bucket("2026-08", 600),
    ])).toBe(300);
  });

  it("handles all previous-month zero states without dividing by zero", () => {
    expect(compareWithPrevious(bucket("2026-08", 0), bucket("2026-07", 0))).toEqual({ kind: "both-empty" });
    expect(compareWithPrevious(bucket("2026-08", 100), bucket("2026-07", 0))).toEqual({ kind: "new", delta: 100 });
    expect(compareWithPrevious(bucket("2026-08", 0), bucket("2026-07", 100))).toEqual({ kind: "now-empty", delta: -100 });
    expect(compareWithPrevious(bucket("2026-08", 150), bucket("2026-07", 100))).toEqual({ kind: "changed", delta: 50, percentage: 50 });
    expect(compareWithPrevious(bucket("2026-08", 100), bucket("2026-07", 0, 1))).toEqual({ kind: "changed", delta: 100, percentage: null });
  });

  it("uses monthly cost as the share denominator without clamping", () => {
    const current = bucket("2026-08", 150);
    expect(monthlyCostShare(current, [{ month: "2026-08", total: 100 }])).toBe(150);
    expect(monthlyCostShare(current, [{ month: "2026-08", total: 0 }])).toBeNull();
  });

  it("normalizes supported ranges", () => {
    expect(normalizeComparisonRange("3")).toBe(3);
    expect(normalizeComparisonRange("12")).toBe(12);
    expect(normalizeComparisonRange("4")).toBe(6);
    expect(contributionPercentage(25, 100)).toBe(25);
    expect(contributionPercentage(25, 0)).toBeNull();
  });
});
