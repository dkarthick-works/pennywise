import { describe, it, expect } from "vitest";
import { shiftDateToMonth, shiftMonth } from "./dates";

describe("shiftDateToMonth", () => {
  it("keeps a valid day unchanged", () => {
    expect(shiftDateToMonth("2026-06-15", "2026-07")).toBe("2026-07-15");
  });

  it("clamps 31 into a 30-day month", () => {
    expect(shiftDateToMonth("2026-03-31", "2026-04")).toBe("2026-04-30");
  });

  it("clamps 31 into non-leap February", () => {
    expect(shiftDateToMonth("2026-01-31", "2026-02")).toBe("2026-02-28");
  });

  it("clamps 31 into leap February", () => {
    expect(shiftDateToMonth("2024-01-31", "2024-02")).toBe("2024-02-29");
  });

  it("clamps 30 into non-leap February", () => {
    expect(shiftDateToMonth("2026-04-30", "2026-02")).toBe("2026-02-28");
  });

  it("pads single-digit days", () => {
    expect(shiftDateToMonth("2026-06-03", "2026-07")).toBe("2026-07-03");
  });

  it("works with the December → January previous-year source (via shiftMonth)", () => {
    // Viewing January 2026, the previous month is December 2025.
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftDateToMonth("2025-12-31", "2026-01")).toBe("2026-01-31");
  });
});
