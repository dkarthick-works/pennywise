-- SMS source rows remain the durable processing queue. Drafts never enter the ledger automatically.
UPDATE sms_suggestions SET status='rejected',body=NULL,sender=NULL,received_at=NULL
WHERE status='uncertain';
ALTER TABLE sms_suggestions DROP CONSTRAINT sms_suggestions_status_check;
ALTER TABLE sms_suggestions ADD CONSTRAINT sms_suggestions_status_check CHECK (status IN
 ('queued','verifying','classified','extracting','rejected','failed','pending_review','approved','ignored','cancelled'));
ALTER TABLE sms_suggestions ADD CONSTRAINT sms_suggestions_id_user_unique UNIQUE(id,user_id);
ALTER TABLE sms_suggestions
 ADD COLUMN verification_attempts INTEGER NOT NULL DEFAULT 0 CHECK (verification_attempts >= 0),
 ADD COLUMN extraction_attempts INTEGER NOT NULL DEFAULT 0 CHECK (extraction_attempts >= 0),
 ADD COLUMN verification JSONB,
 ADD COLUMN verification_usage JSONB,
 ADD COLUMN extraction_usage JSONB,
 ADD COLUMN claim_token UUID,
 ADD COLUMN claimed_at TIMESTAMPTZ,
 ADD COLUMN next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 ADD COLUMN failed_stage TEXT CHECK (failed_stage IN ('verification','extraction')),
 ADD COLUMN last_error_code TEXT,
 ADD COLUMN rejection_reason TEXT;
DROP INDEX sms_suggestions_pending_idx;
CREATE INDEX sms_suggestions_pending_idx ON sms_suggestions(next_attempt_at,created_at,id)
 WHERE status IN ('queued','classified','verifying','extracting');

CREATE TABLE sms_transaction_drafts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 source_sms_id UUID NOT NULL UNIQUE,
 section section,
 category TEXT NOT NULL CHECK (length(btrim(category)) BETWEEN 1 AND 200),
 amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
 txn_date DATE NOT NULL,
 kind txn_kind NOT NULL CHECK (kind IN ('cash','credit')),
 currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
 direction TEXT NOT NULL CHECK (direction IN ('debit','credit')),
 event_type TEXT NOT NULL,
 warnings JSONB NOT NULL DEFAULT '[]',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE (id,user_id),
 FOREIGN KEY (source_sms_id,user_id) REFERENCES sms_suggestions(id,user_id) ON DELETE CASCADE,
 CHECK (section IS DISTINCT FROM 'income'::section OR kind='cash')
);
CREATE INDEX sms_transaction_drafts_user_idx ON sms_transaction_drafts(user_id,created_at DESC,id);
