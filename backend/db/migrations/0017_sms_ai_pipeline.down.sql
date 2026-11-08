-- Draft rollback discards unsaved drafts; take a database backup before using it.
UPDATE sms_suggestions SET status='cancelled'
WHERE status='pending_review' AND id IN (SELECT source_sms_id FROM sms_transaction_drafts);
DROP TABLE sms_transaction_drafts;
ALTER TABLE sms_suggestions DROP CONSTRAINT sms_suggestions_id_user_unique;
UPDATE sms_suggestions SET status=CASE WHEN status='verifying' THEN 'queued'
 WHEN status='extracting' THEN 'classified' WHEN status='failed' THEN 'cancelled' ELSE status END,
 body=CASE WHEN status='failed' THEN NULL ELSE body END,
 sender=CASE WHEN status='failed' THEN NULL ELSE sender END,
 received_at=CASE WHEN status='failed' THEN NULL ELSE received_at END;
ALTER TABLE sms_suggestions DROP CONSTRAINT sms_suggestions_status_check;
ALTER TABLE sms_suggestions ADD CONSTRAINT sms_suggestions_status_check CHECK (status IN
 ('queued','classified','rejected','uncertain','pending_review','approved','ignored','cancelled'));
-- Drop the index before its next_attempt_at column (which would auto-drop it).
DROP INDEX sms_suggestions_pending_idx;
ALTER TABLE sms_suggestions DROP COLUMN verification_attempts,DROP COLUMN extraction_attempts,
 DROP COLUMN verification,DROP COLUMN verification_usage,DROP COLUMN extraction_usage,
 DROP COLUMN claim_token,DROP COLUMN claimed_at,DROP COLUMN next_attempt_at,
 DROP COLUMN failed_stage,DROP COLUMN last_error_code,DROP COLUMN rejection_reason;
CREATE INDEX sms_suggestions_pending_idx ON sms_suggestions(id) WHERE status IN ('queued','classified');
