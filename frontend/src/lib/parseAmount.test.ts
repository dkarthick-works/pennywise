import { describe, expect, it } from "vitest";
import { formatIndianAmount, parseIndianAmount } from "./parseAmount";

describe("parseIndianAmount", () => {
  it("keeps two decimal places", () => {
    expect(parseIndianAmount("500.25")).toEqual({ value: 500.25, decimalPlaces: 2 });
    expect(parseIndianAmount("0.99")).toEqual({ value: 0.99, decimalPlaces: 2 });
  });

  it("strips Indian grouping commas and keeps the decimal point", () => {
    expect(parseIndianAmount("1,234.50")).toEqual({ value: 1234.5, decimalPlaces: 2 });
  });

  it("does not glue 500.25 into 50025", () => {
    expect(parseIndianAmount("500.25").value).toBe(500.25);
    expect(parseIndianAmount("500.25").value).not.toBe(50025);
  });

  it("tracks over-precise amounts", () => {
    expect(parseIndianAmount("500.251")).toEqual({ value: 500.251, decimalPlaces: 3 });
  });

  it("treats empty as null", () => {
    expect(parseIndianAmount("")).toEqual({ value: null, decimalPlaces: 0 });
    expect(parseIndianAmount("   ")).toEqual({ value: null, decimalPlaces: 0 });
  });
});

describe("formatIndianAmount", () => {
  it("uses Indian grouping", () => {
    expect(formatIndianAmount(1234.5)).toBe("1,234.5");
    expect(formatIndianAmount(500.25)).toBe("500.25");
  });
});
