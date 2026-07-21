-- Chit funds — a standalone ledger, deliberately isolated from `transactions`.
-- Installments recorded here never become transaction rows, so they do not
-- touch the dashboard, cash flow, savings rate, CSV export, or category
-- suggestions.
--
-- One installment row = one complete installment. Split payments are not
-- supported in V1. Progress/status are derived from COUNT(installments)
-- vs total_installments (never stored).

CREATE TABLE chits (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name               TEXT NOT NULL,
    organizer          TEXT NOT NULL,
    chit_value         NUMERIC(14,2) NOT NULL CHECK (chit_value > 0),
    expected_monthly   NUMERIC(14,2) NOT NULL CHECK (expected_monthly > 0),
    total_installments INT NOT NULL CHECK (total_installments > 0 AND total_installments <= 360),
    start_month        DATE NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chits_start_month_first_day_chk
        CHECK (start_month = date_trunc('month', start_month)::date),
    CONSTRAINT chits_name_nonempty_chk CHECK (length(btrim(name)) > 0),
    CONSTRAINT chits_organizer_nonempty_chk CHECK (length(btrim(organizer)) > 0)
);
CREATE INDEX chits_user_idx ON chits (user_id, created_at DESC);

CREATE TABLE chit_installments (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chit_id    UUID NOT NULL REFERENCES chits(id) ON DELETE CASCADE,
    amount     NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    paid_on    DATE NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX chit_installments_chit_idx
    ON chit_installments (chit_id, paid_on, created_at, id);
