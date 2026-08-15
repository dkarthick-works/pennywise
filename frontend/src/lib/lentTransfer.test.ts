import { describe, expect, it } from "vitest";
import {
  LENT_ARCHIVE_MAX_LENTS,
  lentTransferCounts,
  parseLentTransferJSON,
} from "./lentTransfer";

const lentID = "11111111-1111-4111-8111-111111111111";
const repaymentID = "22222222-2222-4222-8222-222222222222";

function archive(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "pennywise-lents",
    version: 1,
    exported_at: "2026-08-16T00:00:00Z",
    lents: [
      {
        source_id: lentID,
        counterparty: "  Ravi  ",
        amount: "5000",
        lent_on: "2026-06-01",
        due_on: null,
        note: "",
        repayments: [
          {
            source_id: repaymentID,
            amount: "2000.5",
            repaid_on: "2026-06-15",
            note: "part payment",
          },
        ],
      },
    ],
    ...overrides,
  });
}

describe("parseLentTransferJSON", () => {
  it("normalizes exact money and preserves nullable due dates", () => {
    const result = parseLentTransferJSON(`\uFEFF${archive()}`);

    expect(result.fileError).toBe("");
    expect(result.archive?.lents[0]).toMatchObject({
      counterparty: "Ravi",
      amount: "5000.00",
      due_on: null,
      repayments: [{ amount: "2000.50" }],
    });
    expect(lentTransferCounts(result.archive!)).toEqual({ lents: 1, repayments: 1 });
  });

  it("accepts an empty archive", () => {
    const result = parseLentTransferJSON(
      archive({ lents: [] }),
    );

    expect(result.fileError).toBe("");
    expect(result.archive?.lents).toEqual([]);
  });

  it("rejects missing required nullable fields and unknown fields", () => {
    const missingDue = JSON.parse(archive()) as { lents: Array<Record<string, unknown>> };
    delete missingDue.lents[0].due_on;
    expect(parseLentTransferJSON(JSON.stringify(missingDue)).fileError).toContain("due_on is required");

    expect(parseLentTransferJSON(archive({ extra: true })).fileError).toContain("unknown archive field");
  });

  it("rejects trailing JSON and unsupported versions", () => {
    expect(parseLentTransferJSON(`${archive()} {}`).fileError).toContain("Unexpected non-whitespace character");
    expect(parseLentTransferJSON(archive({ version: 2 })).fileError).toContain("unsupported archive version");
  });

  it("rejects duplicate repayment IDs globally and over-repayment", () => {
    const duplicate = JSON.parse(archive()) as {
      lents: Array<Record<string, unknown>>;
    };
    duplicate.lents.push({
      source_id: "33333333-3333-4333-8333-333333333333",
      counterparty: "Meera",
      amount: "100.00",
      lent_on: "2026-06-01",
      due_on: null,
      note: "",
      repayments: [
        {
          source_id: repaymentID,
          amount: "1.00",
          repaid_on: "2026-06-20",
          note: "",
        },
      ],
    });
    expect(parseLentTransferJSON(JSON.stringify(duplicate)).fileError).toContain("duplicate repayment source_id");

    expect(parseLentTransferJSON(archive({
      lents: [{
        source_id: lentID,
        counterparty: "Ravi",
        amount: "1.00",
        lent_on: "2026-06-01",
        due_on: null,
        note: "",
        repayments: [{
          source_id: repaymentID,
          amount: "1.01",
          repaid_on: "2026-06-15",
          note: "",
        }],
      }],
    })).fileError).toContain("exceed the outstanding balance");
  });

  it("rejects archives over the lent count limit", () => {
    const lents = Array.from({ length: LENT_ARCHIVE_MAX_LENTS + 1 }, (_, index) => ({
      source_id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
      counterparty: "Ravi",
      amount: "1.00",
      lent_on: "2026-06-01",
      due_on: null,
      note: "",
      repayments: [],
    }));
    expect(parseLentTransferJSON(archive({ lents })).fileError).toContain("maximum");
  });
});
