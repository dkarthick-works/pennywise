package smspipeline

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

var ErrNotRetryable = errors.New("SMS job is not retryable")

// RetryFailed is owner-scoped and only resumes the failed stage. Rejected,
// cancelled, expired or already-reviewed jobs cannot be resurrected here.
func (s *PostgresStore) RetryFailed(ctx context.Context, owner, id uuid.UUID, now time.Time) error {
	tag, err := s.pool.Exec(ctx, `UPDATE sms_suggestions s SET
 status=CASE WHEN s.failed_stage='extraction' THEN 'classified' ELSE 'queued' END,
 verification_attempts=CASE WHEN s.failed_stage='verification' THEN 0 ELSE s.verification_attempts END,
 extraction_attempts=CASE WHEN s.failed_stage='extraction' THEN 0 ELSE s.extraction_attempts END,
 claim_token=NULL,claimed_at=NULL,last_error_code=NULL,failed_stage=NULL,next_attempt_at=$3,updated_at=$3
 FROM sms_devices d,sms_sender_config c
 WHERE s.id=$1 AND s.user_id=$2 AND s.status='failed' AND s.failed_stage IN ('verification','extraction')
 AND s.body IS NOT NULL AND s.created_at >= $3::timestamptz - interval '7 days'
 AND (s.failed_stage!='extraction' OR s.verification IS NOT NULL)
 AND d.id=s.device_id AND d.user_id=s.user_id AND d.enabled AND d.revoked_at IS NULL
 AND d.consent_version=s.consent_version AND c.id=true AND s.sender=ANY(c.senders)`, id, owner, now)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrNotRetryable
	}
	return nil
}
