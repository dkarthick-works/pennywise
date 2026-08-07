import { describe, it, expect, afterEach, vi } from "vitest";
import type { Transaction, TxnKind, Section } from "../types";
import { dailySpendByDay, dailySpendAverage, sectionSums } from "./txns";
import { inr } from "./money";

function txn(partial: {
  id?: string;
  section?: Section;
  category?: string;
  amount: number;
  date: string;
  kind?: TxnKind;
}): Transaction {
  return {
    id: partial.id ?? "t1",
    section: partial.section ?? "daily",
    category: partial.category ?? "Food",
    amount: partial.amount,
    date: partial.date,
    kind: partial.kind ?? "cash",
  };
}

describe("dailySpendByDay", () => {
  it("returns 31 days for a 31-day month", () => {
    const series = dailySpendByDay([], "2026-07");
    expect(series).toHaveLength(31);
    expect(series[0]).toEqual({ date: "2026-07-01", day: 1, value: 0 });
    expect(series[30]).toEqual({ date: "2026-07-31", day: 31, value: 0 });
  });

  it("returns 30 days for a 30-day month", () => {
    expect(dailySpendByDay([], "2026-04")).toHaveLength(30);
  });

  it("returns 28 days for non-leap February", () => {
    expect(dailySpendByDay([], "2026-02")).toHaveLength(28);
  });

  it("returns 29 days for leap February", () => {
    expect(dailySpendByDay([], "2024-02")).toHaveLength(29);
  });

  it("sums multiple transactions on the same day", () => {
    const series = dailySpendByDay(
      [
        txn({ amount: 100, date: "2026-07-03", kind: "cash" }),
        txn({ amount: 50.5, date: "2026-07-03", kind: "credit", id: "t2" }),
      ],
      "2026-07"
    );
    expect(series[2].value).toBe(150.5);
  });

  it("includes cash and credit, excludes settlement/income/essential/flexible", () => {
    const series = dailySpendByDay(
      [
        txn({ amount: 10, date: "2026-07-01", kind: "cash" }),
        txn({ amount: 20, date: "2026-07-01", kind: "credit", id: "t2" }),
        txn({ amount: 99, date: "2026-07-01", kind: "settlement", id: "t3" }),
        txn({ amount: 88, date: "2026-07-01", section: "income", id: "t4" }),
        txn({ amount: 77, date: "2026-07-01", section: "essential", id: "t5" }),
        txn({ amount: 66, date: "2026-07-01", section: "flexible", id: "t6" }),
      ],
      "2026-07"
    );
    expect(series[0].value).toBe(30);
  });

  it("excludes out-of-month rows", () => {
    const series = dailySpendByDay(
      [
        txn({ amount: 10, date: "2026-07-15" }),
        txn({ amount: 999, date: "2026-06-15", id: "t2" }),
        txn({ amount: 888, date: "2026-08-01", id: "t3" }),
      ],
      "2026-07"
    );
    expect(series[14].value).toBe(10);
    expect(series.reduce((s, d) => s + d.value, 0)).toBe(10);
  });

  it("includes future-dated transactions in their day buckets", () => {
    const series = dailySpendByDay(
      [txn({ amount: 40, date: "2026-07-31" })],
      "2026-07"
    );
    expect(series[30].value).toBe(40);
  });

  it("returns [] for invalid month format", () => {
    expect(dailySpendByDay([], "2026-7")).toEqual([]);
    expect(dailySpendByDay([], "202607")).toEqual([]);
    expect(dailySpendByDay([], "")).toEqual([]);
  });

  it("returns [] for month outside 1..12", () => {
    expect(dailySpendByDay([], "2026-13")).toEqual([]);
    expect(dailySpendByDay([], "2026-00")).toEqual([]);
  });

  it("output is chronological with zeros filled", () => {
    const series = dailySpendByDay(
      [txn({ amount: 5, date: "2026-07-10" })],
      "2026-07"
    );
    expect(series.map((d) => d.day)).toEqual(
      Array.from({ length: 31 }, (_, i) => i + 1)
    );
    expect(series.filter((d) => d.value === 0)).toHaveLength(30);
    expect(series[9].value).toBe(5);
  });

  it("sums decimals accurately", () => {
    const series = dailySpendByDay(
      [
        txn({ amount: 10.25, date: "2026-07-02" }),
        txn({ amount: 0.1, date: "2026-07-02", id: "t2" }),
      ],
      "2026-07"
    );
    expect(series[1].value).toBeCloseTo(10.35, 10);
  });

  it("total equals sectionSums incurred daily", () => {
    const txns = [
      txn({ amount: 100, date: "2026-07-01", kind: "cash" }),
      txn({ amount: 50, date: "2026-07-05", kind: "credit", id: "t2" }),
      txn({ amount: 200, date: "2026-07-05", kind: "settlement", id: "t3" }),
      txn({ amount: 30, date: "2026-07-10", section: "essential", id: "t4" }),
      txn({ amount: 15, date: "2026-07-20", section: "flexible", id: "t5" }),
      txn({ amount: 8.5, date: "2026-07-25", kind: "cash", id: "t6" }),
    ];
    const series = dailySpendByDay(txns, "2026-07");
    const total = series.reduce((s, d) => s + d.value, 0);
    expect(total).toBe(sectionSums(txns, "2026-07", "incurred").daily);
    expect(total).toBe(158.5);
  });
});

describe("dailySpendAverage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses full series and calendar days for a past month", () => {
    const series = dailySpendByDay(
      [
        txn({ amount: 310, date: "2026-07-01" }),
        txn({ amount: 310, date: "2026-07-15", id: "t2" }),
      ],
      "2026-07"
    );
    const result = dailySpendAverage(series, "2026-07", "2026-08-07");
    expect(result.soFar).toBe(false);
    expect(result.divisor).toBe(31);
    expect(result.numerator).toBe(620);
    expect(result.avg).toBeCloseTo(620 / 31, 10);
  });

  it("uses full series and calendar days for a future selected month", () => {
    const series = dailySpendByDay(
      [txn({ amount: 900, date: "2026-09-10" })],
      "2026-09"
    );
    const result = dailySpendAverage(series, "2026-09", "2026-08-07");
    expect(result.soFar).toBe(false);
    expect(result.divisor).toBe(30);
    expect(result.numerator).toBe(900);
    expect(result.avg).toBe(30);
  });

  it("uses elapsed days and soFar for current mid-month", () => {
    const series = dailySpendByDay(
      [txn({ amount: 700, date: "2026-08-02" })],
      "2026-08"
    );
    const result = dailySpendAverage(series, "2026-08", "2026-08-07");
    expect(result.soFar).toBe(true);
    expect(result.divisor).toBe(7);
    expect(result.numerator).toBe(700);
    expect(result.avg).toBe(100);
  });

  it("uses divisor 1 on current month day 1", () => {
    const series = dailySpendByDay(
      [txn({ amount: 50, date: "2026-08-01" })],
      "2026-08"
    );
    const result = dailySpendAverage(series, "2026-08", "2026-08-01");
    expect(result.soFar).toBe(true);
    expect(result.divisor).toBe(1);
    expect(result.numerator).toBe(50);
    expect(result.avg).toBe(50);
  });

  it("excludes future-dated spend from current-month numerator", () => {
    const series = dailySpendByDay(
      [
        txn({ amount: 100, date: "2026-08-03" }),
        txn({ amount: 3000, date: "2026-08-20", id: "t2" }),
      ],
      "2026-08"
    );
    const fullTotal = series.reduce((s, d) => s + d.value, 0);
    expect(fullTotal).toBe(3100);

    const result = dailySpendAverage(series, "2026-08", "2026-08-07");
    expect(result.soFar).toBe(true);
    expect(result.numerator).toBe(100);
    expect(result.divisor).toBe(7);
    expect(result.avg).toBeCloseTo(100 / 7, 10);
  });

  it("returns zeros for empty series", () => {
    expect(dailySpendAverage([], "2026-08", "2026-08-07")).toEqual({
      avg: 0,
      numerator: 0,
      divisor: 0,
      soFar: false,
    });
  });

  it("rounds display with inr for non-integer averages", () => {
    const series = dailySpendByDay([], "2026-07");
    // Force numerator/divisor via past-month path with crafted values
    series[0].value = 100;
    const result = dailySpendAverage(series, "2026-07", "2026-08-07");
    // 100/31 ≈ 3.226 → inr rounds to ₹3
    expect(inr(result.avg)).toBe("₹3");

    // Explicit 100/3 case: build a 3-day series manually
    const short = [
      { date: "2026-02-01", day: 1, value: 100 },
      { date: "2026-02-02", day: 2, value: 0 },
      { date: "2026-02-03", day: 3, value: 0 },
    ];
    // Past Feb relative to Aug → full series / 3
    const r2 = dailySpendAverage(short, "2026-02", "2026-08-07");
    expect(r2.avg).toBeCloseTo(100 / 3, 10);
    expect(inr(r2.avg)).toBe("₹33");
  });
});
