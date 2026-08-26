import { describe, expect, it } from "vitest";
import {
  clearFieldIssues,
  previewReadiness,
  toPreviewRow,
  type PreviewRow,
} from "./transactionPreview";
import type { TransactionPreview } from "../types";

function row(partial: Partial<PreviewRow> = {}): PreviewRow {
  return {
    clientId: "p1",
    section: "daily",
    category: "Lunch",
    amount: 500.25,
    amountDecimalPlaces: 2,
    date: "2026-08-26",
    kind: "cash",
    issues: [],
    saveError: "",
    ...partial,
  };
}

describe("previewReadiness", () => {
  it("is ready when local fields are complete and in-month", () => {
    expect(previewReadiness(row(), "2026-08").ready).toBe(true);
  });

  it("blocks out-of-month dates", () => {
    const result = previewReadiness(row({ date: "2026-07-01" }), "2026-08");
    expect(result.ready).toBe(false);
    expect(result.issues.some((issue) => issue.message === "Date must be in the selected month")).toBe(true);
  });

  it("blocks over-precise amounts", () => {
    const result = previewReadiness(row({ amount: 500.251, amountDecimalPlaces: 3 }), "2026-08");
    expect(result.ready).toBe(false);
    expect(result.issues.some((issue) => issue.code === "invalid_amount")).toBe(true);
  });

  it("keeps remaining ambiguous backend issues", () => {
    const result = previewReadiness(
      row({
        issues: [{ field: "category", code: "ambiguous_category", message: "Category is unclear" }],
      }),
      "2026-08"
    );
    expect(result.ready).toBe(false);
  });
});

describe("clearFieldIssues", () => {
  it("drops missing and ambiguous issues for the edited field", () => {
    const next = clearFieldIssues(
      [
        { field: "amount", code: "ambiguous_amount", message: "Amount is unclear" },
        { field: "category", code: "ambiguous_category", message: "Category is unclear" },
      ],
      "amount"
    );
    expect(next).toEqual([
      { field: "category", code: "ambiguous_category", message: "Category is unclear" },
    ]);
  });
});

describe("toPreviewRow", () => {
  it("copies nullable parser fields", () => {
    const preview: TransactionPreview = {
      ready: false,
      section: null,
      category: null,
      amount: null,
      date: "2026-08-26",
      kind: "credit",
      issues: [{ field: "category", code: "missing_category", message: "Category is required" }],
    };
    expect(toPreviewRow(preview, "x")).toMatchObject({
      clientId: "x",
      section: null,
      category: "",
      amount: null,
      date: "2026-08-26",
      kind: "credit",
    });
  });
});
