import Papa from "papaparse";
import type { Section, TxnKind } from "../types";

export const MAX_IMPORT_ROWS = 2000;

export const IMPORT_ROW_CAP_MESSAGE = "import exceeds maximum of 2000 rows";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SECTIONS: Section[] = ["essential", "flexible", "daily", "income"];

export interface ImportDraftRow {
  date: string;
  section: Section;
  category: string;
  amount: number;
  kind: TxnKind;
}

export type ImportFieldErrors = Partial<Record<keyof ImportDraftRow, string>>;

export interface ImportParsedRow {
  row: ImportDraftRow;
  errors: ImportFieldErrors;
}

export interface ParseImportResult {
  rows: ImportParsedRow[];
  fileError: string | null;
}

function isCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validImportKind(kind: string): kind is TxnKind {
  return kind === "cash" || kind === "credit";
}

function parseAmount(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n;
}

function isBlankDataRow(values: string[]): boolean {
  return values.every((v) => v.trim() === "");
}

function headerIndex(headers: string[], name: string): number {
  const lower = name.toLowerCase();
  return headers.findIndex((h) => h.trim().toLowerCase() === lower);
}

export function validateImportRow(row: ImportDraftRow): ImportFieldErrors {
  const errors: ImportFieldErrors = {};

  if (!DATE_RE.test(row.date)) {
    errors.date = "must be YYYY-MM-DD";
  } else if (!isCalendarDate(row.date)) {
    errors.date = "must be a valid date";
  }

  if (!SECTIONS.includes(row.section)) {
    errors.section = "must be essential, flexible, daily, or income";
  }

  if (row.kind === "settlement") {
    errors.kind = "settlement rows cannot be imported";
  } else if (!validImportKind(row.kind)) {
    errors.kind = "must be cash or credit";
  }

  if (row.amount < 0 || Number.isNaN(row.amount)) {
    errors.amount = "must be zero or greater";
  }

  if (!row.category.trim()) {
    errors.category = "is required";
  }

  if (row.section === "income" && row.kind !== "cash") {
    errors.kind = "income must be cash";
  }
  if (row.kind === "credit" && row.section === "income") {
    errors.kind = "credit cannot be used with income";
  }

  return errors;
}

export function countRowErrors(rows: ImportParsedRow[]): number {
  return rows.filter((r) => Object.keys(r.errors).length > 0).length;
}

export function allRowsValid(rows: ImportParsedRow[]): boolean {
  return rows.length > 0 && countRowErrors(rows) === 0;
}

export function toImportPayload(rows: ImportParsedRow[]): ImportDraftRow[] {
  return rows.map((r) => ({
    date: r.row.date,
    section: r.row.section,
    category: r.row.category.trim(),
    amount: r.row.amount,
    kind: r.row.kind,
  }));
}

export function parseImportCSV(text: string): ParseImportResult {
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const parsed = Papa.parse<string[]>(stripped, {
    skipEmptyLines: false,
    dynamicTyping: false,
  });

  if (parsed.errors.length > 0) {
    return { rows: [], fileError: "Could not parse CSV file." };
  }

  const records = parsed.data.filter((row) => !isBlankDataRow(row));
  if (records.length === 0) {
    return { rows: [], fileError: "CSV file is empty." };
  }

  const headers = records[0].map((h) => h.trim());
  const required = ["date", "section", "category", "amount", "kind"] as const;
  for (const col of required) {
    if (headerIndex(headers, col) < 0) {
      return { rows: [], fileError: `Missing required column: ${col}` };
    }
  }

  const dataRows = records.slice(1).filter((row) => !isBlankDataRow(row));
  if (dataRows.length === 0) {
    return { rows: [], fileError: "CSV has a header but no data rows." };
  }
  if (dataRows.length > MAX_IMPORT_ROWS) {
    return { rows: [], fileError: IMPORT_ROW_CAP_MESSAGE };
  }

  const idx = {
    date: headerIndex(headers, "date"),
    section: headerIndex(headers, "section"),
    category: headerIndex(headers, "category"),
    amount: headerIndex(headers, "amount"),
    kind: headerIndex(headers, "kind"),
  };

  const rows: ImportParsedRow[] = dataRows.map((cells) => {
    const amountRaw = cells[idx.amount] ?? "";
    const parsedAmount = parseAmount(amountRaw);
    const sectionRaw = (cells[idx.section] ?? "").trim().toLowerCase();
    const kindRaw = (cells[idx.kind] ?? "").trim().toLowerCase();

    const row: ImportDraftRow = {
      date: (cells[idx.date] ?? "").trim(),
      section: sectionRaw as Section,
      category: cells[idx.category] ?? "",
      amount: parsedAmount ?? Number.NaN,
      kind: kindRaw as TxnKind,
    };

    const errors = validateImportRow(row);
    if (parsedAmount === null) {
      errors.amount = "must be a number";
    }

    return { row, errors };
  });

  return { rows, fileError: null };
}

export function revalidateRows(rows: ImportParsedRow[]): ImportParsedRow[] {
  return rows.map((r) => ({
    row: r.row,
    errors: validateImportRow(r.row),
  }));
}
