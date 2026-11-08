package smspipeline

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresStore struct{ pool *pgxpool.Pool }

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore { return &PostgresStore{pool} }

// Cleanup also fences existing claims: after cancellation, a late provider reply
// cannot save a draft. No rejected/incomplete message enters a human-review queue.
const cancelIneligible = `UPDATE sms_suggestions s SET status='cancelled',body=NULL,sender=NULL,received_at=NULL,
 verification=NULL,claim_token=NULL,claimed_at=NULL,updated_at=$1
 WHERE s.status IN ('queued','classified','verifying','extracting','failed') AND (
 s.body IS NULL OR s.created_at < $1::timestamptz - interval '7 days' OR NOT EXISTS (
 SELECT 1 FROM sms_devices d,sms_sender_config c WHERE d.id=s.device_id AND d.user_id=s.user_id
 AND d.enabled AND d.revoked_at IS NULL AND d.consent_version=s.consent_version
 AND c.id=true AND s.sender=ANY(c.senders)))`

func (s *PostgresStore) Claim(ctx context.Context, now time.Time, lease time.Duration) (*Job, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, cancelIneligible, now); err != nil {
		return nil, err
	}
	// A crash consumes its attempt. Expired claims resume only their own stage.
	if _, err = tx.Exec(ctx, `UPDATE sms_suggestions SET
 status=CASE WHEN (status='verifying' AND verification_attempts>=3) OR (status='extracting' AND extraction_attempts>=3) THEN 'failed'
             WHEN status='verifying' THEN 'queued' ELSE 'classified' END,
 failed_stage=CASE WHEN status='verifying' THEN 'verification' ELSE 'extraction' END,
 last_error_code='claim_expired',claim_token=NULL,claimed_at=NULL,updated_at=$1
 WHERE status IN ('verifying','extracting') AND claimed_at < $2`, now, now.Add(-lease)); err != nil {
		return nil, err
	}
	var job Job
	var state string
	var raw []byte
	err = tx.QueryRow(ctx, `SELECT s.id,s.user_id,s.device_id,s.status,s.sender,s.body,s.received_at,
 COALESCE(NULLIF(u.currency,''),'INR'),s.verification FROM sms_suggestions s
 LEFT JOIN user_settings u ON u.user_id=s.user_id
 WHERE s.status IN ('queued','classified') AND s.next_attempt_at <= $1
 ORDER BY CASE WHEN s.status='classified' THEN 0 ELSE 1 END,s.created_at,s.id LIMIT 1
 FOR UPDATE OF s SKIP LOCKED`, now).Scan(&job.ID, &job.UserID, &job.DeviceID, &state, &job.Message.Sender, &job.Message.Body, &job.Message.ReceivedAt, &job.Message.Currency, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, tx.Commit(ctx)
	}
	if err != nil {
		return nil, err
	}
	job.ClaimToken = uuid.New()
	job.Stage = "verification"
	active := "verifying"
	if state == "classified" {
		job.Stage = "extraction"
		active = "extracting"
		if json.Unmarshal(raw, &job.Verification) != nil {
			_, err = tx.Exec(ctx, `UPDATE sms_suggestions SET status='failed',failed_stage='extraction',last_error_code='invalid_verification',updated_at=$2 WHERE id=$1`, job.ID, now)
			if err != nil {
				return nil, err
			}
			return nil, tx.Commit(ctx)
		}
	}
	_, err = tx.Exec(ctx, `UPDATE sms_suggestions SET status=$2,claim_token=$3,claimed_at=$4,updated_at=$4,
 verification_attempts=verification_attempts+CASE WHEN $2='verifying' THEN 1 ELSE 0 END,
 extraction_attempts=extraction_attempts+CASE WHEN $2='extracting' THEN 1 ELSE 0 END,
 attempts=attempts+1,failed_stage=NULL,last_error_code=NULL WHERE id=$1`, job.ID, active, job.ClaimToken, now)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &job, nil
}

// withClaim locks in the same order as device consent changes: device, then
// source. The configuration read lock prevents a removal racing the commit.
func (s *PostgresStore) withClaim(ctx context.Context, job Job, now time.Time, action func(pgx.Tx) error) (bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	var enabled bool
	var consent int64
	var revoked *time.Time
	err = tx.QueryRow(ctx, `SELECT enabled,consent_version,revoked_at FROM sms_devices WHERE id=$1 AND user_id=$2 FOR SHARE`, job.DeviceID, job.UserID).Scan(&enabled, &consent, &revoked)
	if err != nil {
		return false, err
	}
	var senders []string
	if err = tx.QueryRow(ctx, `SELECT senders FROM sms_sender_config WHERE id=true FOR SHARE`).Scan(&senders); err != nil {
		return false, err
	}
	var state string
	var claim *uuid.UUID
	var sourceConsent int64
	var sender *string
	var created time.Time
	var hasBody bool
	err = tx.QueryRow(ctx, `SELECT status,claim_token,consent_version,sender,created_at,body IS NOT NULL
 FROM sms_suggestions WHERE id=$1 AND user_id=$2 FOR UPDATE`, job.ID, job.UserID).Scan(&state, &claim, &sourceConsent, &sender, &created, &hasBody)
	if err != nil {
		return false, err
	}
	expected := "verifying"
	if job.Stage == "extraction" {
		expected = "extracting"
	}
	if state != expected || claim == nil || *claim != job.ClaimToken {
		return false, ErrStaleClaim
	}
	allowed := false
	if sender != nil {
		for _, value := range senders {
			if *sender == value {
				allowed = true
				break
			}
		}
	}
	if !enabled || revoked != nil || consent != sourceConsent || !allowed || !hasBody || created.Before(now.Add(-7*24*time.Hour)) {
		_, err = tx.Exec(ctx, `UPDATE sms_suggestions SET status='cancelled',body=NULL,sender=NULL,received_at=NULL,
   verification=NULL,claim_token=NULL,claimed_at=NULL,updated_at=$2 WHERE id=$1`, job.ID, now)
		if err != nil {
			return false, err
		}
		return false, tx.Commit(ctx)
	}
	if action != nil {
		if err = action(tx); err != nil {
			return false, err
		}
	}
	return true, tx.Commit(ctx)
}
func (s *PostgresStore) Eligible(ctx context.Context, job Job, now time.Time) (bool, error) {
	return s.withClaim(ctx, job, now, nil)
}
func (s *PostgresStore) Verified(ctx context.Context, job Job, result VerificationResult, now time.Time) error {
	_, err := s.withClaim(ctx, job, now, func(tx pgx.Tx) error {
		usage, _ := json.Marshal(result.Usage)
		if !result.Decision.Eligible {
			_, err := tx.Exec(ctx, `UPDATE sms_suggestions SET status='rejected',rejection_reason=$2,body=NULL,sender=NULL,received_at=NULL,
    verification=NULL,verification_usage=$3,claim_token=NULL,claimed_at=NULL,updated_at=$4 WHERE id=$1`, job.ID, result.Decision.Reason, usage, now)
			return err
		}
		raw, _ := json.Marshal(result.Decision)
		_, err := tx.Exec(ctx, `UPDATE sms_suggestions SET status='classified',verification=$2,verification_usage=$3,
   claim_token=NULL,claimed_at=NULL,next_attempt_at=$4,updated_at=$4 WHERE id=$1`, job.ID, raw, usage, now)
		return err
	})
	return err
}
func (s *PostgresStore) Extracted(ctx context.Context, job Job, draft Draft, usage Usage, now time.Time) error {
	_, err := s.withClaim(ctx, job, now, func(tx pgx.Tx) error {
		warnings, _ := json.Marshal(draft.Warnings)
		_, err := tx.Exec(ctx, `INSERT INTO sms_transaction_drafts(user_id,source_sms_id,section,category,amount,txn_date,kind,currency,direction,event_type,warnings)
   VALUES($1,$2,$3::section,$4,$5::numeric,$6::date,$7::txn_kind,$8,$9,$10,$11)
   ON CONFLICT(source_sms_id) DO NOTHING`, job.UserID, job.ID, draft.Section, draft.Category, draft.Amount.String(), draft.Date, draft.Kind, draft.Currency, draft.Direction, draft.EventType, warnings)
		if err != nil {
			return err
		}
		rawUsage, _ := json.Marshal(usage)
		_, err = tx.Exec(ctx, `UPDATE sms_suggestions SET status='pending_review',extraction_usage=$2,
   body=NULL,sender=NULL,received_at=NULL,verification=NULL,claim_token=NULL,claimed_at=NULL,updated_at=$3 WHERE id=$1`, job.ID, rawUsage, now)
		return err
	})
	return err
}
func (s *PostgresStore) Failed(ctx context.Context, job Job, code string, now time.Time) error {
	_, err := s.withClaim(ctx, job, now, func(tx pgx.Tx) error {
		var attempts int
		if err := tx.QueryRow(ctx, `SELECT CASE WHEN $2='verification' THEN verification_attempts ELSE extraction_attempts END
   FROM sms_suggestions WHERE id=$1`, job.ID, job.Stage).Scan(&attempts); err != nil {
			return err
		}
		state := "queued"
		if job.Stage == "extraction" {
			state = "classified"
		}
		if attempts >= 3 {
			state = "failed"
		}
		next := now.Add(time.Duration(1<<min(attempts, 6)) * 15 * time.Second)
		_, err := tx.Exec(ctx, `UPDATE sms_suggestions SET status=$2,last_error_code=$3,failed_stage=$4,
   next_attempt_at=$5,claim_token=NULL,claimed_at=NULL,updated_at=$6 WHERE id=$1`, job.ID, state, code, job.Stage, next, now)
		return err
	})
	return err
}
