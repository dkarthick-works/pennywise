-- Optimistic review version prevents an older tab from approving overwritten edits.
ALTER TABLE sms_transaction_drafts ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0);
