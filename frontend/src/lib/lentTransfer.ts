import type { LentTransferArchive, LentTransferLent, LentTransferRepayment } from "../types";

export const LENT_ARCHIVE_MAX_BYTES = 25 * 1024 * 1024;
export const LENT_ARCHIVE_MAX_LENTS = 10_000;
export const LENT_ARCHIVE_MAX_REPAYMENTS = 50_000;
export const LENT_ARCHIVE_MAX_REPAYMENTS_PER_LENT = 500;

const MAX_ARCHIVE_CENTS = 99_999_999_999_999;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_RE = /^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/;
const RFC3339_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

export interface LentTransferParseResult {
  archive: LentTransferArchive | null;
  fileError: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredValue(object: Record<string, unknown>, key: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(object, key)) {
    throw new Error(`${key} is required`);
  }
  if (object[key] === null) {
    throw new Error(`${key} cannot be null`);
  }
  return object[key];
}

function assertObject(
  value: unknown,
  name: string,
  allowed: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} must be an object`);
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unknown) throw new Error(`unknown archive field "${unknown}"`);
  return value;
}

function requiredString(object: Record<string, unknown>, key: string): string {
  const value = requiredValue(object, key);
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  return value;
}

function requiredArray(object: Record<string, unknown>, key: string): unknown[] {
  const value = requiredValue(object, key);
  if (!Array.isArray(value)) throw new Error(`${key} must be an array`);
  return value;
}

function isCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseMoney(value: string, label: string): number {
  if (!MONEY_RE.test(value)) {
    throw new Error(`${label} must be a positive decimal with at most two fractional digits`);
  }
  const [wholeText, fractionText = ""] = value.split(".");
  const whole = Number(wholeText);
  const fraction = fractionText.length === 1 ? Number(fractionText) * 10 : Number(fractionText);
  const cents = whole * 100 + fraction;
  if (!Number.isSafeInteger(cents) || cents > MAX_ARCHIVE_CENTS) {
    throw new Error(`${label} exceeds the maximum supported amount`);
  }
  if (cents <= 0) throw new Error(`${label} must be greater than zero`);
  return cents;
}

function formatMoney(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function parseRepayment(value: unknown, lentIndex: number, repaymentIndex: number): LentTransferRepayment {
  const object = assertObject(
    value,
    `lents[${lentIndex}].repayments[${repaymentIndex}]`,
    ["source_id", "amount", "repaid_on", "note"],
  );
  const sourceId = requiredString(object, "source_id");
  if (!UUID_RE.test(sourceId)) {
    throw new Error(`lents[${lentIndex}].repayments[${repaymentIndex}].source_id must be a UUID`);
  }
  const amount = requiredString(object, "amount");
  const cents = parseMoney(amount, `lents[${lentIndex}].repayments[${repaymentIndex}].amount`);
  const repaidOn = requiredString(object, "repaid_on");
  if (!isCalendarDate(repaidOn)) {
    throw new Error(`lents[${lentIndex}].repayments[${repaymentIndex}].repaid_on must be YYYY-MM-DD`);
  }
  return {
    source_id: sourceId,
    amount: formatMoney(cents),
    repaid_on: repaidOn,
    note: requiredString(object, "note"),
  };
}

function parseLent(
  value: unknown,
  lentIndex: number,
  repaymentIds: Set<string>,
): LentTransferLent {
  const object = assertObject(
    value,
    `lents[${lentIndex}]`,
    ["source_id", "counterparty", "amount", "lent_on", "due_on", "note", "repayments"],
  );
  const sourceId = requiredString(object, "source_id");
  if (!UUID_RE.test(sourceId)) throw new Error(`lents[${lentIndex}].source_id must be a UUID`);

  const counterparty = requiredString(object, "counterparty").trim();
  if (!counterparty) throw new Error(`lents[${lentIndex}].counterparty is required`);

  const amount = requiredString(object, "amount");
  const amountCents = parseMoney(amount, `lents[${lentIndex}].amount`);
  const lentOn = requiredString(object, "lent_on");
  if (!isCalendarDate(lentOn)) throw new Error(`lents[${lentIndex}].lent_on must be YYYY-MM-DD`);

  if (!Object.prototype.hasOwnProperty.call(object, "due_on")) {
    throw new Error("due_on is required");
  }
  const dueOn = object.due_on;
  if (dueOn !== null && typeof dueOn !== "string") {
    throw new Error(`lents[${lentIndex}].due_on must be YYYY-MM-DD or null`);
  }
  if (typeof dueOn === "string") {
    if (!isCalendarDate(dueOn)) throw new Error(`lents[${lentIndex}].due_on must be YYYY-MM-DD or null`);
    if (dueOn < lentOn) throw new Error(`lents[${lentIndex}].due_on cannot be before lent_on`);
  }

  const repaymentValues = requiredArray(object, "repayments");
  if (repaymentValues.length > LENT_ARCHIVE_MAX_REPAYMENTS_PER_LENT) {
    throw new Error(`a lent cannot contain more than ${LENT_ARCHIVE_MAX_REPAYMENTS_PER_LENT} repayments`);
  }
  let repaidCents = 0;
  const repayments = repaymentValues.map((repayment, repaymentIndex) => {
    const parsed = parseRepayment(repayment, lentIndex, repaymentIndex);
    if (repaymentIds.has(parsed.source_id)) {
      throw new Error(`duplicate repayment source_id "${parsed.source_id}"`);
    }
    repaymentIds.add(parsed.source_id);
    const cents = parseMoney(parsed.amount, "repayment amount");
    repaidCents += cents;
    if (repaidCents > amountCents) {
      throw new Error(`lents[${lentIndex}] repayments exceed the outstanding balance`);
    }
    return parsed;
  });

  return {
    source_id: sourceId,
    counterparty,
    amount: formatMoney(amountCents),
    lent_on: lentOn,
    due_on: dueOn,
    note: requiredString(object, "note"),
    repayments,
  };
}

export function parseLentTransferJSON(text: string): LentTransferParseResult {
  try {
    const parsed = JSON.parse(text.replace(/^\uFEFF/, "")) as unknown;
    const object = assertObject(parsed, "archive", ["type", "version", "exported_at", "lents"]);
    if (requiredString(object, "type") !== "pennywise-lents") {
      throw new Error('archive type must be "pennywise-lents"');
    }
    const version = requiredValue(object, "version");
    if (typeof version !== "number" || !Number.isInteger(version)) {
      throw new Error("version must be an integer");
    }
    if (version !== 1) throw new Error(`unsupported archive version ${version}`);

    const exportedAt = requiredString(object, "exported_at");
    if (!RFC3339_UTC_RE.test(exportedAt) || Number.isNaN(Date.parse(exportedAt))) {
      throw new Error("exported_at must be RFC3339 UTC");
    }

    const lentValues = requiredArray(object, "lents");
    if (lentValues.length > LENT_ARCHIVE_MAX_LENTS) {
      throw new Error(`archive exceeds maximum of ${LENT_ARCHIVE_MAX_LENTS} lents`);
    }
    const lentIds = new Set<string>();
    const repaymentIds = new Set<string>();
    const lents = lentValues.map((lent, lentIndex) => {
      const parsedLent = parseLent(lent, lentIndex, repaymentIds);
      if (lentIds.has(parsedLent.source_id)) {
        throw new Error(`duplicate lent source_id "${parsedLent.source_id}"`);
      }
      lentIds.add(parsedLent.source_id);
      return parsedLent;
    });
    const repaymentCount = lents.reduce((count, lent) => count + lent.repayments.length, 0);
    if (repaymentCount > LENT_ARCHIVE_MAX_REPAYMENTS) {
      throw new Error(`archive exceeds maximum of ${LENT_ARCHIVE_MAX_REPAYMENTS} repayments`);
    }

    return {
      archive: { type: "pennywise-lents", version: 1, exported_at: exportedAt, lents },
      fileError: "",
    };
  } catch (error) {
    return {
      archive: null,
      fileError: error instanceof Error ? error.message : "Invalid lent archive.",
    };
  }
}

export function lentTransferCounts(archive: LentTransferArchive): {
  lents: number;
  repayments: number;
} {
  return {
    lents: archive.lents.length,
    repayments: archive.lents.reduce((count, lent) => count + lent.repayments.length, 0),
  };
}
