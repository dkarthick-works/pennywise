-- Lent tracking — a standalone ledger, deliberately isolated from `transactions`.
-- Money lent to another person is recorded here and nowhere else: it never
-- becomes a transaction row, so it does not touch the dashboard, cash flow,
-- savings rate, CSV export or category suggestions. Lent money is tracked, not
-- budgeted.
--
-- Open vs settled is NOT stored. It is derived as
--   amount - COALESCE(SUM(lent_repayments.amount), 0) > 0
-- so it can never drift out of sync with the repayment rows.

CREATE TABLE lents (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    counterparty TEXT NOT NULL,
    amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    lent_on      DATE NOT NULL,
    due_on       DATE,
    note         TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT lents_due_after_lent_chk CHECK (due_on IS NULL OR due_on >= lent_on)
);
CREATE INDEX lents_user_idx ON lents (user_id, lent_on DESC);

-- One row per repayment instalment, so a loan can be paid back in parts and the
-- full history is preserved.
CREATE TABLE lent_repayments (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lent_id    UUID NOT NULL REFERENCES lents(id) ON DELETE CASCADE,
    amount     NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    repaid_on  DATE NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX lent_repayments_lent_idx ON lent_repayments (lent_id, repaid_on);
