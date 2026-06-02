-- Ledger schema — initial migration
-- Core concept: every transaction has ONE date + a KIND.
--   cash       -> incurred AND paid same day (counts in both views)
--   credit     -> incurred now, no cash has left yet (Incurred view only)
--   settlement -> cash paid out to clear one or more earlier credits (Cash-Out view only)
-- All rows are scoped to a user (id mirrors the external Goauth user_id UUID).

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE section  AS ENUM ('essential', 'flexible', 'daily');
CREATE TYPE txn_kind AS ENUM ('cash', 'credit', 'settlement');

-- ---------------------------------------------------------------------------
-- Users — thin mirror of the Goauth subject (for FK integrity + email cache).
-- We never store passwords here; auth lives entirely in the Goauth service.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id           UUID PRIMARY KEY,                 -- = Goauth user_id
    email        TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Per-user settings: monthly income, per-section budgets (global, not per
-- month — matching the prototype), plus currency/theme preferences.
-- ---------------------------------------------------------------------------
CREATE TABLE user_settings (
    user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    income           NUMERIC(14,2) NOT NULL DEFAULT 165000,
    budget_essential NUMERIC(14,2) NOT NULL DEFAULT 95000,
    budget_flexible  NUMERIC(14,2) NOT NULL DEFAULT 7000,
    budget_daily     NUMERIC(14,2) NOT NULL DEFAULT 28000,
    currency         TEXT NOT NULL DEFAULT 'INR',
    theme            TEXT NOT NULL DEFAULT 'light',
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Template rows (only essential + flexible use these). Ordered per section.
-- Auto-cloned into every new month with blank amounts.
-- ---------------------------------------------------------------------------
CREATE TABLE templates (
    id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    section  section NOT NULL,
    label    TEXT NOT NULL,
    position INTEGER NOT NULL,
    CONSTRAINT templates_section_chk CHECK (section IN ('essential', 'flexible'))
);
CREATE INDEX templates_user_section_idx ON templates (user_id, section, position);

-- ---------------------------------------------------------------------------
-- Transactions — the heart of the app.
-- ---------------------------------------------------------------------------
CREATE TABLE transactions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    section    section NOT NULL,
    category   TEXT NOT NULL DEFAULT '',
    amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
    txn_date   DATE NOT NULL,
    kind       txn_kind NOT NULL DEFAULT 'cash',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Month/year lookups filter on to_char(txn_date,...), but that expression is
-- not IMMUTABLE (locale-dependent) so it cannot be indexed directly. A plain
-- (user_id, txn_date) index serves range scans well enough at this scale.
CREATE INDEX transactions_user_date_idx    ON transactions (user_id, txn_date);
CREATE INDEX transactions_user_section_idx ON transactions (user_id, section, txn_date);

-- ---------------------------------------------------------------------------
-- Settlement links: one settlement transaction clears one-or-more credit
-- transactions (many-to-many within the same section).
-- ---------------------------------------------------------------------------
CREATE TABLE settlement_links (
    settlement_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    credit_id     UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    PRIMARY KEY (settlement_id, credit_id)
);
CREATE INDEX settlement_links_credit_idx ON settlement_links (credit_id);

-- ---------------------------------------------------------------------------
-- Month bookkeeping: cosmetic "closed" flag + "seeded" flag tracking whether
-- this month has already had its templates cloned in.
-- ---------------------------------------------------------------------------
CREATE TABLE month_state (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month   CHAR(7) NOT NULL,         -- 'YYYY-MM'
    closed  BOOLEAN NOT NULL DEFAULT false,
    seeded  BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (user_id, month)
);
