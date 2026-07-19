import { describe, it, expect } from "vitest";
import { statementCycleForMonth, cyclePreviewSentence, longDayMonth } from "./billingCycle";

describe("statementCycleForMonth", () => {
  it("day 15 in a normal month spans the previous 16th to this 15th", () => {
    expect(statementCycleForMonth("2026-07", 15)).toEqual({ from: "2026-06-16", to: "2026-07-15" });
  });

  it("day 1", () => {
    expect(statementCycleForMonth("2026-07", 1)).toEqual({ from: "2026-06-02", to: "2026-07-01" });
  });

  it("clamps day 31 to the last day of February (non-leap)", () => {
    // Previous month January (31 days) clamps independently.
    expect(statementCycleForMonth("2026-02", 31)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("clamps day 31 to the last day of February (leap)", () => {
    expect(statementCycleForMonth("2028-02", 31)).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("handles January with a December rollover on the from side", () => {
    expect(statementCycleForMonth("2026-01", 5)).toEqual({ from: "2025-12-06", to: "2026-01-05" });
  });

  it("clamps the previous month independently (day 30 into March)", () => {
    // March close = 30; previous Feb (28) clamps -> from = Mar 1.
    expect(statementCycleForMonth("2026-03", 30)).toEqual({ from: "2026-03-01", to: "2026-03-30" });
  });

  it("rejects invalid input", () => {
    expect(statementCycleForMonth("2026-07", 0)).toBeNull();
    expect(statementCycleForMonth("2026-07", 32)).toBeNull();
    expect(statementCycleForMonth("2026-13", 15)).toBeNull();
    expect(statementCycleForMonth("nope", 15)).toBeNull();
    expect(statementCycleForMonth("2026-07", 15.5)).toBeNull();
  });
});

describe("cyclePreviewSentence", () => {
  it("names the statement month and the full range", () => {
    expect(cyclePreviewSentence("2026-07", 15)).toBe("Your July billing cycle: 16 June – 15 July");
  });

  it("returns null for invalid input", () => {
    expect(cyclePreviewSentence("2026-07", 0)).toBeNull();
  });
});

describe("longDayMonth", () => {
  it("formats an ISO date as day + full month", () => {
    expect(longDayMonth("2026-06-16")).toBe("16 June");
    expect(longDayMonth("2026-07-01")).toBe("1 July");
  });
});
