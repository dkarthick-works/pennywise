import { describe, expect, it } from "vitest";
import { formatIndianAmount, parseIndianAmount } from "./parseAmount";

describe("parseIndianAmount", () => {
  it("keeps two decimal places", () => {
    expect(parseIndianAmount("500.25")).toEqual({ value: 500.25, decimalPlaces: 2, negative: false });
    expect(parseIndianAmount("0.99")).toEqual({ value: 0.99, decimalPlaces: 2, negative: false });
  });

  it("strips Indian grouping commas and keeps the decimal point", () => {
    expect(parseIndianAmount("1,234.50")).toEqual({ value: 1234.5, decimalPlaces: 2, negative: false });
  });

  it("does not glue 500.25 into 50025", () => {
    expect(parseIndianAmount("500.25").value).toBe(500.25);
    expect(parseIndianAmount("500.25").value).not.toBe(50025);
  });

  it("tracks over-precise amounts", () => {
    expect(parseIndianAmount("500.251")).toEqual({ value: 500.251, decimalPlaces: 3, negative: false });
  });

  it("treats empty as null", () => {
    expect(parseIndianAmount("")).toEqual({ value: null, decimalPlaces: 0, negative: false });
    expect(parseIndianAmount("   ")).toEqual({ value: null, decimalPlaces: 0, negative: false });
  });

  it("keeps a leading or unicode minus instead of dropping it", () => {
    expect(parseIndianAmount("-50")).toEqual({ value: -50, decimalPlaces: 0, negative: true });
    expect(parseIndianAmount("−50")).toEqual({ value: -50, decimalPlaces: 0, negative: true });
    expect(parseIndianAmount("-1,234.50")).toEqual({ value: -1234.5, decimalPlaces: 2, negative: true });
  });

  it("treats a minus anywhere in the text as negative", () => {
    expect(parseIndianAmount("50-")).toEqual({ value: -50, decimalPlaces: 0, negative: true });
    expect(parseIndianAmount("-")).toEqual({ value: null, decimalPlaces: 0, negative: true });
    expect(parseIndianAmount("-0")).toEqual({ value: 0, decimalPlaces: 0, negative: true });
  });
});

describe("formatIndianAmount", () => {
  it("uses Indian grouping", () => {
    expect(formatIndianAmount(1234.5)).toBe("1,234.5");
    expect(formatIndianAmount(500.25)).toBe("500.25");
  });
});
