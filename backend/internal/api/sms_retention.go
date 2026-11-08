package api

import (
	"context"
	"log"
	"time"
)

func (s *Server) expireSMSPayloads(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `UPDATE sms_suggestions SET body=NULL,sender=NULL,received_at=NULL,verification=NULL,claim_token=NULL,claimed_at=NULL,
    status=CASE WHEN status IN ('queued','verifying','classified','extracting','failed') THEN 'cancelled' ELSE status END,
    updated_at=now() WHERE created_at < now()-interval '7 days' AND body IS NOT NULL`)
	return err
}

// RunSMSRetention is maintenance only, not an AI worker. Fingerprints remain for
// deduplication, but raw SMS has a seven-day TTL, including while AI is disabled.
// Run once at startup and hourly thereafter; stop before closing the pool.
func (s *Server) RunSMSRetention(ctx context.Context) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		cleanupCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		err := s.expireSMSPayloads(cleanupCtx)
		cancel()
		if err != nil && ctx.Err() == nil {
			log.Print("SMS payload retention cleanup failed; will retry")
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
