import type { ChitInput, ChitInstallmentInput, ChitStatus } from "../types";

export const CHIT_NAME_MAX = 120;
export const CHIT_NOTE_MAX = 500;
export const CHIT_INSTALLMENTS_MAX = 360;

/** Frontend month input YYYY-MM → API YYYY-MM-01 */
export function monthToStartMonth(ym: string): string {
  if (!/^\d{4}-\d{2}$/.test(ym)) return "";
  return `${ym}-01`;
}

/** API YYYY-MM-01 → frontend YYYY-MM */
export function startMonthToMonth(iso: string): string {
  if (/^\d{4}-\d{2}-01$/.test(iso)) return iso.slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(iso)) return iso;
  return "";
}

export function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function derivedStatus(installmentCount: number, totalInstallments: number): ChitStatus {
  return installmentCount >= totalInstallments ? "completed" : "active";
}

export function paymentVariance(expectedMonthly: number, actualPaid: number): number {
  return expectedMonthly - actualPaid;
}

export function validateChitForm(form: {
  name: string;
  organizer: string;
  chit_value: number;
  expected_monthly: number;
  total_installments: number;
  start_month_ym: string;
}): string | null {
  const name = form.name.trim();
  const organizer = form.organizer.trim();
  if (!name) return "name is required";
  if (name.length > CHIT_NAME_MAX) return "name is too long";
  if (!organizer) return "organizer is required";
  if (organizer.length > CHIT_NAME_MAX) return "organizer is too long";
  if (!(form.chit_value > 0)) return "chit value must be greater than zero";
  if (!(form.expected_monthly > 0)) return "expected installment must be greater than zero";
  if (
    !Number.isInteger(form.total_installments) ||
    form.total_installments < 1 ||
    form.total_installments > CHIT_INSTALLMENTS_MAX
  ) {
    return "total installments must be between 1 and 360";
  }
  if (!monthToStartMonth(form.start_month_ym)) return "start month is required";
  return null;
}

export function toChitInput(form: {
  name: string;
  organizer: string;
  chit_value: number;
  expected_monthly: number;
  total_installments: number;
  start_month_ym: string;
}): ChitInput {
  return {
    name: form.name.trim(),
    organizer: form.organizer.trim(),
    chit_value: form.chit_value,
    expected_monthly: form.expected_monthly,
    total_installments: form.total_installments,
    start_month: monthToStartMonth(form.start_month_ym),
  };
}

export function validateInstallmentForm(form: ChitInstallmentInput): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.paid_on)) return "paid on must be a valid date";
  if (!(form.amount > 0)) return "amount must be greater than zero";
  if (form.note.length > CHIT_NOTE_MAX) return "note is too long";
  return null;
}

export function emptyChitForm() {
  return {
    name: "",
    organizer: "",
    chit_value: 0,
    expected_monthly: 0,
    total_installments: 20,
    start_month_ym: currentYearMonth(),
  };
}
