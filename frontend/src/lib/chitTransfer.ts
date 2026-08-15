import type {
  ChitTransferArchive,
  ChitTransferChit,
  ChitTransferInstallment,
} from "../types";

export const CHIT_ARCHIVE_MAX_BYTES = 5 * 1024 * 1024;
export const CHIT_ARCHIVE_MAX_CHITS = 500;
export const CHIT_ARCHIVE_MAX_INSTALLMENTS = 10_000;
export const CHIT_ARCHIVE_MAX_TEXT_BYTES = 1 * 1024 * 1024;
export const CHIT_ARCHIVE_MAX_INSTALLMENTS_PER_CHIT = 360;

const MAX_ARCHIVE_CENTS = 99_999_999_999_999;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const START_MONTH_RE = /^\d{4}-\d{2}-01$/;

export interface ChitTransferParseResult {
  archive: ChitTransferArchive | null;
  rawArchiveText: string;
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

function requiredNumber(object: Record<string, unknown>, key: string): number {
  const value = requiredValue(object, key);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number`);
  }
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

function validateMoney(value: number, label: string): void {
  if (!(value > 0)) throw new Error(`${label} must be greater than zero`);
  if (value > MAX_ARCHIVE_CENTS / 100) {
    throw new Error(`${label} exceeds the maximum supported amount`);
  }
  if (!Number.isSafeInteger(Math.round(value * 100))) {
    throw new Error(`${label} is too large`);
  }
}

function parseInstallment(
  value: unknown,
  chitIndex: number,
  installmentIndex: number,
): ChitTransferInstallment {
  const object = assertObject(
    value,
    `chits[${chitIndex}].installments[${installmentIndex}]`,
    ["paid_on", "amount", "note"],
  );
  const paidOn = requiredString(object, "paid_on");
  if (!isCalendarDate(paidOn)) {
    throw new Error(`chits[${chitIndex}].installments[${installmentIndex}].paid_on must be YYYY-MM-DD`);
  }
  const amount = requiredNumber(object, "amount");
  validateMoney(amount, `chits[${chitIndex}].installments[${installmentIndex}].amount`);
  return {
    paid_on: paidOn,
    amount,
    note: requiredString(object, "note"),
  };
}

function parseChit(value: unknown, chitIndex: number): ChitTransferChit {
  const object = assertObject(
    value,
    `chits[${chitIndex}]`,
    ["name", "organizer", "chit_value", "expected_monthly", "total_installments", "start_month", "installments"],
  );
  const name = requiredString(object, "name").trim();
  if (!name) throw new Error(`chits[${chitIndex}].name is required`);
  const organizer = requiredString(object, "organizer").trim();
  if (!organizer) throw new Error(`chits[${chitIndex}].organizer is required`);

  const chitValue = requiredNumber(object, "chit_value");
  validateMoney(chitValue, `chits[${chitIndex}].chit_value`);
  const expectedMonthly = requiredNumber(object, "expected_monthly");
  validateMoney(expectedMonthly, `chits[${chitIndex}].expected_monthly`);

  const totalInstallments = requiredValue(object, "total_installments");
  if (
    typeof totalInstallments !== "number" ||
    !Number.isInteger(totalInstallments) ||
    totalInstallments < 1 ||
    totalInstallments > CHIT_ARCHIVE_MAX_INSTALLMENTS_PER_CHIT
  ) {
    throw new Error(`chits[${chitIndex}].total_installments must be between 1 and 360`);
  }

  const startMonth = requiredString(object, "start_month");
  if (!START_MONTH_RE.test(startMonth) || !isCalendarDate(startMonth)) {
    throw new Error(`chits[${chitIndex}].start_month must be YYYY-MM-01`);
  }

  const installmentValues = requiredArray(object, "installments");
  if (installmentValues.length > totalInstallments) {
    throw new Error(`chits[${chitIndex}] has more installments than total_installments`);
  }
  const installments = installmentValues.map((installment, installmentIndex) =>
    parseInstallment(installment, chitIndex, installmentIndex),
  );
  return {
    name,
    organizer,
    chit_value: chitValue,
    expected_monthly: expectedMonthly,
    total_installments: totalInstallments,
    start_month: startMonth,
    installments,
  };
}

export function parseChitTransferJSON(text: string): ChitTransferParseResult {
  const rawArchiveText = text.replace(/^\uFEFF/, "");
  try {
    const parsed = JSON.parse(rawArchiveText) as unknown;
    const object = assertObject(parsed, "archive", ["format", "version", "chits"]);
    if (requiredString(object, "format") !== "pennywise-chits") {
      throw new Error('archive format must be "pennywise-chits"');
    }
    const version = requiredValue(object, "version");
    if (typeof version !== "number" || !Number.isInteger(version)) {
      throw new Error("version must be an integer");
    }
    if (version !== 1) throw new Error(`unsupported archive version ${version}`);

    const values = requiredArray(object, "chits");
    if (values.length === 0) throw new Error("no chits to import");
    if (values.length > CHIT_ARCHIVE_MAX_CHITS) {
      throw new Error(`archive exceeds maximum of ${CHIT_ARCHIVE_MAX_CHITS} chits`);
    }
    const archive: ChitTransferArchive = {
      format: "pennywise-chits",
      version: 1,
      chits: values.map((chit, chitIndex) => parseChit(chit, chitIndex)),
    };
    const installmentCount = archive.chits.reduce(
      (count, chit) => count + chit.installments.length,
      0,
    );
    if (installmentCount > CHIT_ARCHIVE_MAX_INSTALLMENTS) {
      throw new Error(`archive exceeds maximum of ${CHIT_ARCHIVE_MAX_INSTALLMENTS} installments`);
    }
    const textBytes = archive.chits.reduce((count, chit) => {
      const chitText = `${chit.name}${chit.organizer}`;
      const installmentText = chit.installments.reduce((sum, installment) => sum + installment.note, "");
      return count + new TextEncoder().encode(`${chitText}${installmentText}`).byteLength;
    }, 0);
    if (textBytes > CHIT_ARCHIVE_MAX_TEXT_BYTES) {
      throw new Error("archive text content exceeds the maximum size of 1 MiB");
    }
    return { archive, rawArchiveText, fileError: "" };
  } catch (error) {
    return {
      archive: null,
      rawArchiveText,
      fileError: error instanceof Error ? error.message : "Invalid chit archive.",
    };
  }
}

export function chitTransferCounts(archive: ChitTransferArchive): {
  chits: number;
  installments: number;
} {
  return {
    chits: archive.chits.length,
    installments: archive.chits.reduce((count, chit) => count + chit.installments.length, 0),
  };
}
