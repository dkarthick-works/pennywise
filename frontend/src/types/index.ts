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
