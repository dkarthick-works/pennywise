import { describe, expect, it } from "vitest";
import {
  CHIT_ARCHIVE_MAX_CHITS,
  chitTransferCounts,
  parseChitTransferJSON,
} from "./chitTransfer";

function archive(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: "pennywise-chits",
    version: 1,
    chits: [
      {
        name: "  Office Chit  ",
        organizer: "Ramesh",
        chit_value: 100000,
        expected_monthly: 5000,
        total_installments: 20,
        start_month: "2026-07-01",
        installments: [
          { paid_on: "2026-07-10", amount: 4800.5, note: "part payment" },
        ],
      },
    ],
    ...overrides,
  });
}

describe("parseChitTransferJSON", () => {
  it("parses the nested archive and reports counts", () => {
    const result = parseChitTransferJSON(`\uFEFF${archive()}`);

    expect(result.fileError).toBe("");
    expect(result.rawArchiveText.startsWith("\uFEFF")).toBe(false);
    expect(result.archive?.chits[0]).toMatchObject({
      name: "Office Chit",
      installments: [{ amount: 4800.5 }],
    });
    expect(chitTransferCounts(result.archive!)).toEqual({ chits: 1, installments: 1 });
  });

  it("preserves the raw lexical JSON for backend validation", () => {
    const raw = `\uFEFF${archive({
      chits: [{
        name: "Office Chit",
        organizer: "Ramesh",
        chit_value: 1e2,
        expected_monthly: 50,
        total_installments: 1,
        start_month: "2026-07-01",
        installments: [{ paid_on: "2026-07-10", amount: 1.230, note: "" }],
      }],
    })}`.replace("100", "1e2").replace("1.23", "1.230");
    const result = parseChitTransferJSON(raw);

    expect(result.fileError).toBe("");
    expect(result.rawArchiveText).toContain('"chit_value":1e2');
    expect(result.rawArchiveText).toContain('"amount":1.230');
    expect(result.archive?.chits[0].chit_value).toBe(100);
    expect(result.archive?.chits[0].installments[0].amount).toBe(1.23);
  });

  it("rejects empty, unknown, missing, and over-limit archives", () => {
    expect(parseChitTransferJSON(archive({ chits: [] })).fileError).toBe("no chits to import");
    expect(parseChitTransferJSON(archive({ extra: true })).fileError).toContain("unknown archive field");

    const missing = JSON.parse(archive()) as { chits: Array<Record<string, unknown>> };
    delete missing.chits[0].installments;
    expect(parseChitTransferJSON(JSON.stringify(missing)).fileError).toContain("installments is required");

    const chits = Array.from({ length: CHIT_ARCHIVE_MAX_CHITS + 1 }, () => ({
      name: "Office Chit",
      organizer: "Ramesh",
      chit_value: 100,
      expected_monthly: 50,
      total_installments: 1,
      start_month: "2026-07-01",
      installments: [],
    }));
    expect(parseChitTransferJSON(archive({ chits })).fileError).toContain("maximum");
  });

  it("rejects invalid dates, money, and trailing JSON", () => {
    expect(parseChitTransferJSON(archive({
      chits: [{
        name: "Office Chit",
        organizer: "Ramesh",
        chit_value: 0,
        expected_monthly: 50,
        total_installments: 1,
        start_month: "2026-07-01",
        installments: [],
      }],
    })).fileError).toContain("greater than zero");
    expect(parseChitTransferJSON(`${archive()} {}`).fileError).toContain("Unexpected non-whitespace character");
    expect(parseChitTransferJSON(archive({
      chits: [{
        name: "Office Chit",
        organizer: "Ramesh",
        chit_value: 100,
        expected_monthly: 50,
        total_installments: 1,
        start_month: "2026-07-02",
        installments: [],
      }],
    })).fileError).toContain("YYYY-MM-01");
  });
});
