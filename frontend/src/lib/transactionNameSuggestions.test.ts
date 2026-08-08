import { describe, it, expect } from "vitest";
import { isTransactionNameSuggestionSection } from "./transactionNameSuggestions";

describe("isTransactionNameSuggestionSection", () => {
  it("accepts all four ledger sections", () => {
    expect(isTransactionNameSuggestionSection("essential")).toBe(true);
    expect(isTransactionNameSuggestionSection("flexible")).toBe(true);
    expect(isTransactionNameSuggestionSection("daily")).toBe(true);
    expect(isTransactionNameSuggestionSection("income")).toBe(true);
  });

  it("rejects unknown sections", () => {
    expect(isTransactionNameSuggestionSection("other")).toBe(false);
    expect(isTransactionNameSuggestionSection("")).toBe(false);
  });
});
