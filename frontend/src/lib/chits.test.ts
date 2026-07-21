import { describe, expect, it } from "vitest";
import {
  derivedStatus,
  monthToStartMonth,
  paymentVariance,
  startMonthToMonth,
  toChitInput,
  validateChitForm,
  validateInstallmentForm,
} from "./chits";

describe("chit start_month conversion", () => {
  it("converts YYYY-MM to YYYY-MM-01", () => {
    expect(monthToStartMonth("2026-07")).toBe("2026-07-01");
  });

  it("rejects invalid month input", () => {
    expect(monthToStartMonth("2026-7")).toBe("");
    expect(monthToStartMonth("2026-07-01")).toBe("");
  });

  it("slices API date back to YYYY-MM", () => {
    expect(startMonthToMonth("2026-07-01")).toBe("2026-07");
  });
});

describe("chit validation", () => {
  const base = {
    name: "Office A",
    organizer: "Ramesh",
    chit_value: 100000,
    expected_monthly: 5000,
    total_installments: 20,
    start_month_ym: "2026-07",
  };

  it("accepts a valid form", () => {
    expect(validateChitForm(base)).toBeNull();
  });

  it("requires name and organizer", () => {
    expect(validateChitForm({ ...base, name: "  " })).toBe("name is required");
    expect(validateChitForm({ ...base, organizer: "" })).toBe("organizer is required");
  });

  it("bounds total installments", () => {
    expect(validateChitForm({ ...base, total_installments: 0 })).toMatch(/between 1 and 360/);
    expect(validateChitForm({ ...base, total_installments: 361 })).toMatch(/between 1 and 360/);
  });

  it("builds API input with start_month day 01", () => {
    expect(toChitInput(base).start_month).toBe("2026-07-01");
  });

  it("validates installment rows", () => {
    expect(validateInstallmentForm({ paid_on: "2026-07-10", amount: 4800, note: "" })).toBeNull();
    expect(validateInstallmentForm({ paid_on: "bad", amount: 4800, note: "" })).toMatch(/date/);
    expect(validateInstallmentForm({ paid_on: "2026-07-10", amount: 0, note: "" })).toMatch(/amount/);
  });
});

describe("chit derived status and variance", () => {
  it("marks completed when count reaches total", () => {
    expect(derivedStatus(19, 20)).toBe("active");
    expect(derivedStatus(20, 20)).toBe("completed");
    expect(derivedStatus(21, 20)).toBe("completed");
  });

  it("computes payment variance as expected minus paid", () => {
    expect(paymentVariance(5000, 4800)).toBe(200);
  });
});
