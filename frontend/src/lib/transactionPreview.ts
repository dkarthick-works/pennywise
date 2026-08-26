import { monthKey } from "./dates";
import { amountHasAtMostTwoDecimals, countDecimalPlaces } from "./parseAmount";
import type {
  Section,
  TransactionParseIssue,
  TransactionPreview,
  TxnKind,
} from "../types";

export const OUT_OF_MONTH_DATE_MESSAGE = "Date must be in the selected month";

const SECTIONS = new Set<Section>(["essential", "flexible", "daily", "income"]);
const PREVIEW_KINDS = new Set<TxnKind>(["cash", "credit"]);

export interface PreviewRow {
  clientId: string;
  section: Section | null;
  category: string;
  amount: number | null;
  amountDecimalPlaces: number;
  date: string;
  kind: TxnKind | null;
  issues: TransactionParseIssue[];
  saveError: string;
}

export function asSection(value: string | null | undefined): Section | null {
  if (value && SECTIONS.has(value as Section)) return value as Section;
  return null;
}

export function asKind(value: string | null | undefined): TxnKind | null {
  if (value === "cash" || value === "credit" || value === "settlement") return value;
  return null;
}

export function toPreviewRow(preview: TransactionPreview, clientId: string): PreviewRow {
  const amount = preview.amount;
  return {
    clientId,
    section: asSection(preview.section),
    category: preview.category ?? "",
    amount,
    amountDecimalPlaces: countDecimalPlaces(amount),
    date: preview.date ?? "",
    kind: asKind(preview.kind),
    issues: preview.issues ?? [],
    saveError: "",
  };
}

export function clearFieldIssues(
  issues: TransactionParseIssue[],
  field: string
): TransactionParseIssue[] {
  return issues.filter((issue) => {
    if (issue.field !== field) return true;
    return (
      !issue.code.startsWith("missing_") &&
      !issue.code.startsWith("ambiguous_") &&
      issue.code !== "unsupported_settlement"
    );
  });
}

function dateLooksValid(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  return utc.getUTCFullYear() === y && utc.getUTCMonth() === m - 1 && utc.getUTCDate() === d;
}

export function localPreviewIssues(row: PreviewRow, month: string): TransactionParseIssue[] {
  const issues: TransactionParseIssue[] = [];
  if (!row.section) {
    issues.push({ field: "section", code: "missing_section", message: "Section is required" });
  }
  if (!row.category.trim()) {
    issues.push({ field: "category", code: "missing_category", message: "Transaction name is required" });
  }
  if (row.amount == null || !(row.amount > 0)) {
    issues.push({ field: "amount", code: "missing_amount", message: "Amount must be greater than 0" });
  } else if (!amountHasAtMostTwoDecimals(row.amountDecimalPlaces)) {
    issues.push({
      field: "amount",
      code: "invalid_amount",
      message: "Amount must have at most two decimal places",
    });
  }
  if (!row.date || !dateLooksValid(row.date)) {
    issues.push({ field: "date", code: "missing_date", message: "Date is required" });
  } else if (monthKey(row.date) !== month) {
    issues.push({ field: "date", code: "out_of_month", message: OUT_OF_MONTH_DATE_MESSAGE });
  }
  if (!row.kind || !PREVIEW_KINDS.has(row.kind)) {
    issues.push({
      field: "kind",
      code: row.kind === "settlement" ? "unsupported_settlement" : "missing_kind",
      message:
        row.kind === "settlement"
          ? "Settlement transactions are not supported here"
          : "Kind is required",
    });
  }
  return issues;
}

export function remainingBackendIssues(row: PreviewRow): TransactionParseIssue[] {
  return row.issues.filter((issue) => {
    if (issue.code.startsWith("missing_")) return false;
    if (issue.code === "unsupported_settlement" && row.kind && row.kind !== "settlement") return false;
    return issue.code.startsWith("ambiguous_") || issue.code === "unsupported_settlement";
  });
}

export function previewReadiness(row: PreviewRow, month: string): {
  ready: boolean;
  issues: TransactionParseIssue[];
} {
  const issues = [...localPreviewIssues(row, month), ...remainingBackendIssues(row)];
  const seen = new Set<string>();
  const deduped: TransactionParseIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.field}\0${issue.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(issue);
  }
  return { ready: deduped.length === 0, issues: deduped };
}

export function fieldIssues(
  issues: TransactionParseIssue[],
  field: string
): TransactionParseIssue[] {
  return issues.filter((issue) => issue.field === field);
}

export function otherIssues(issues: TransactionParseIssue[]): TransactionParseIssue[] {
  return issues.filter((issue) => issue.field === "transaction");
}
