// ─── Core domain types — mirror the Go API JSON exactly ───────────────────

export type Section = "essential" | "flexible" | "daily" | "income";
export type TxnKind = "cash" | "credit" | "settlement";

export interface Transaction {
  id: string;
  section: Section;
  category: string;
  amount: number;
  date: string;      // YYYY-MM-DD
  kind: TxnKind;
  settles?: string[]; // settlement rows: linked credit ids
  settled?: boolean;  // credit rows: cleared by a settlement
}

export interface ImportRowPayload {
  date: string;
  section: Section;
  category: string;
  amount: number;
  kind: TxnKind;
}

export interface ImportResult {
  imported: number;
  months: string[];
}

export interface ImportValidationError {
  error: string;
  rows?: { index: number; fields: Record<string, string> }[];
}

// ─── Settings / templates ─────────────────────────────────────────────────

export interface Budgets {
  essential: number;
  flexible: number;
  daily: number;
}

export interface Templates {
  essential: string[];
  flexible: string[];
}

export interface Settings {
  budgets: Budgets;
  currency: string;
  theme: string;
  templates: Templates;
  // Statement closing day (1..31), or null when the credit billing cycle is
  // not configured. Explicit null, never omitted.
  credit_statement_day: number | null;
  // Per-period credit spending threshold (rupees, up to two decimals), or null
  // when disabled. Explicit null, never omitted.
  credit_spending_threshold: number | null;
}

// ─── Month state ──────────────────────────────────────────────────────────

export interface MonthState {
  month: string; // YYYY-MM
  closed: boolean;
  seeded: boolean;
}

export interface OpenMonthResponse extends MonthState {
  transactions: Transaction[];
}

// ─── Auth ─────────────────────────────────────────────────────────────────

export interface Profile {
  user_id: string;
  email: string;
  display_name: string;
}

export interface LoginRequest  { email: string; password: string; }
export interface SignupRequest { email: string; password: string; }
export interface TokenResponse { access_token: string; }

// ─── Insights ─────────────────────────────────────────────────────────────

export interface MonthEssentialTotal {
  month: string;
  amount: number;
}

export interface EmergencyFundTier {
  multiplier: number;
  amount: number;
}

export interface EmergencyFundTiers {
  bare: EmergencyFundTier;
  comfort: EmergencyFundTier;
  luxury: EmergencyFundTier;
}

export interface Insights {
  seed_amount: number;
  seed_month: string;
  lookback_months: string[];
  monthly_totals: MonthEssentialTotal[];
  emergency_fund: EmergencyFundTiers;
}

// ─── Dashboard ─────────────────────────────────────────────────────────────

export interface DashboardMonthly {
  month: string;
  income: number;
  cash_flow: number;
  monthly_cost: number;
  net_saved: number;
  savings_rate: number;
  monthly_difference: number;
  outstanding_credits_count: number;
  outstanding_credits_total: number;
}

// ─── Credit usage (calendar month + statement cycle) ────────────────────────

export interface CreditUsageBucket {
  from: string; // YYYY-MM-DD inclusive
  to: string;   // YYYY-MM-DD inclusive
  total: number;
  count: number;
}

export interface CreditBillingCycleBucket extends CreditUsageBucket {
  statement_day: number;
}

export interface CreditUsageSummary {
  month: string;
  calendar_month: CreditUsageBucket;
  billing_cycle: CreditBillingCycleBucket | null;
}

export type CreditTransactionView = "calendar" | "billing";

export interface CreditTransactionsResponse {
  month: string;
  view: CreditTransactionView;
  from: string;
  to: string;
  total: number;
  count: number;
  transactions: Transaction[];
}

export interface CategoryGroupSpend {
  group_id: string;
  group_name: string;
  total: number;
}

export interface CategoryGroupTransactions {
  group_id: string;
  group_name: string;
  month: string;
  total: number;
  transactions: Transaction[];
}

// ─── Category grouping ──────────────────────────────────────────────────────

export interface CategoryMappingBrief {
  id: string;
  raw_category: string;
}

export interface CategoryGroup {
  id: string;
  name: string;
  mappings: CategoryMappingBrief[];
}

export interface CategoryMapping {
  id: string;
  raw_category: string;
  group_id: string;
  group_name?: string;
}

// ─── Transaction name suggestions ─────────────────────────────────────────

export type TransactionNameSuggestionSection = "daily" | "income";

export interface TransactionNameSuggestion {
  name: string;
}

export interface TransactionNameSuggestionsResponse {
  items: TransactionNameSuggestion[];
}

// ─── Lent tracking ─────────────────────────────────────────────────────────

export type LentStatus = "open" | "settled";
export type LentListStatus = "open" | "settled" | "all";

export interface Lent {
  id: string;
  counterparty: string;
  amount: number;
  lent_on: string;
  due_on: string | null;
  note: string;
  repaid_total: number;
  outstanding: number;
  status: LentStatus;
  repayments?: LentRepayment[]; // only present on GET /:id
}

export interface LentRepayment {
  id: string;
  lent_id: string;
  amount: number;
  repaid_on: string;
  note: string;
}

export interface LentInput {
  counterparty: string;
  amount: number;
  lent_on: string;
  due_on?: string | null;
  note: string;
}

export interface RepaymentInput {
  amount: number;
  repaid_on: string;
  note: string;
}

// ─── Chit funds (isolated from ledger transactions) ───────────────────────

export type ChitStatus = "active" | "completed";

export interface ChitSummary {
  id: string;
  name: string;
  organizer: string;
  chit_value: number;
  expected_monthly: number;
  total_installments: number;
  start_month: string; // YYYY-MM-01
  installment_count: number;
  total_paid: number;
  status: ChitStatus;
}

export interface ChitInstallment {
  id: string;
  paid_on: string;
  amount: number;
  note: string;
  created_at?: string;
}

export interface ChitDetail extends ChitSummary {
  installments: ChitInstallment[];
}

/** Complete-object body for create/update. start_month is YYYY-MM-01. */
export interface ChitInput {
  name: string;
  organizer: string;
  chit_value: number;
  expected_monthly: number;
  total_installments: number;
  start_month: string;
}

export interface ChitInstallmentInput {
  paid_on: string;
  amount: number;
  note: string;
}
