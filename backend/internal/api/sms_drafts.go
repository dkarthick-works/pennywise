package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/ledger/backend/internal/money"
	"github.com/ledger/backend/internal/smspipeline"
)

func (s *Server) handleListSMSDrafts(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	offset := 0
	if raw := r.URL.Query().Get("offset"); raw != "" {
		var err error
		offset, err = strconv.Atoi(raw)
		if err != nil || offset < 0 || offset > 10000 {
			writeErr(w, 400, "offset must be between 0 and 10000")
			return
		}
	}
	rows, err := s.pool.Query(r.Context(), `SELECT d.id,d.source_sms_id,d.section,d.category,d.amount::text,
 to_char(d.txn_date,'YYYY-MM-DD'),d.kind,d.currency,d.direction,d.event_type,d.warnings,d.revision,
 EXISTS(SELECT 1 FROM transactions t WHERE t.user_id=d.user_id AND t.txn_date=d.txn_date AND t.amount=d.amount)
 FROM sms_transaction_drafts d JOIN sms_suggestions s ON s.id=d.source_sms_id AND s.user_id=d.user_id
 WHERE d.user_id=$1 AND s.status='pending_review' ORDER BY d.txn_date DESC,d.created_at DESC,d.id DESC LIMIT 51 OFFSET $2`, userID(r), offset)
	if err != nil {
		writeErr(w, 500, "could not load SMS drafts")
		return
	}
	defer rows.Close()
	type draftDTO struct {
		Revision            int          `json:"revision"`
		PossibleDuplicate   bool         `json:"possible_duplicate"`
		ID                  string       `json:"id"`
		SourceSMSID         string       `json:"source_sms_id"`
		Section             *string      `json:"section"`
		Category            string       `json:"category"`
		Amount              money.Number `json:"amount"`
		Date                string       `json:"date"`
		Kind                string       `json:"kind"`
		Currency            string       `json:"currency"`
		Direction           string       `json:"direction"`
		EventType           string       `json:"event_type"`
		Warnings            []string     `json:"warnings"`
		SectionIsSuggestion bool         `json:"section_is_suggestion"`
	}
	out := []draftDTO{}
	for rows.Next() {
		var d draftDTO
		var amount string
		var warnings []byte
		if err = rows.Scan(&d.ID, &d.SourceSMSID, &d.Section, &d.Category, &amount, &d.Date, &d.Kind, &d.Currency, &d.Direction, &d.EventType, &warnings, &d.Revision, &d.PossibleDuplicate); err != nil {
			writeErr(w, 500, "could not load SMS drafts")
			return
		}
		d.Amount = money.Number(amount)
		d.SectionIsSuggestion = true
		if json.Unmarshal(warnings, &d.Warnings) != nil {
			writeErr(w, 500, "could not load SMS drafts")
			return
		}
		out = append(out, d)
	}
	if rows.Err() != nil {
		writeErr(w, 500, "could not load SMS drafts")
		return
	}
	var next *int
	if len(out) > 50 {
		value := offset + 50
		next = &value
		out = out[:50]
	}
	writeJSON(w, 200, map[string]any{"drafts": out, "next_offset": next})
}
func (s *Server) handleListSMSJobs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	status := r.URL.Query().Get("status")
	if status != "" && status != "failed" {
		writeErr(w, 400, "unsupported status filter")
		return
	}
	offset := 0
	if raw := r.URL.Query().Get("offset"); raw != "" {
		var err error
		offset, err = strconv.Atoi(raw)
		if err != nil || offset < 0 || offset > 10000 {
			writeErr(w, 400, "invalid offset")
			return
		}
	}
	rows, err := s.pool.Query(r.Context(), `SELECT id,status,verification_attempts,extraction_attempts,
 COALESCE(failed_stage,''),COALESCE(last_error_code,''),COALESCE(rejection_reason,'')
 FROM sms_suggestions WHERE user_id=$1 AND ($2='' OR status=$2) ORDER BY created_at DESC,id DESC LIMIT 100 OFFSET $3`, userID(r), status, offset)
	if err != nil {
		writeErr(w, 500, "could not load SMS processing status")
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, status, stage, code, reason string
		var verificationAttempts, extractionAttempts int
		if rows.Scan(&id, &status, &verificationAttempts, &extractionAttempts, &stage, &code, &reason) != nil {
			writeErr(w, 500, "could not load SMS processing status")
			return
		}
		out = append(out, map[string]any{"id": id, "status": status, "verification_attempts": verificationAttempts,
			"extraction_attempts": extractionAttempts, "failed_stage": stage, "error_code": code, "rejection_reason": reason})
	}
	if rows.Err() != nil {
		writeErr(w, 500, "could not load SMS processing status")
		return
	}
	writeJSON(w, 200, out)
}
func (s *Server) handleRetrySMSJob(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, 400, "invalid SMS job id")
		return
	}
	err = smspipeline.NewPostgresStore(s.pool).RetryFailed(r.Context(), userID(r), id, s.now())
	if errors.Is(err, smspipeline.ErrNotRetryable) {
		writeErr(w, 409, "job unavailable, expired, cancelled, rejected, or not failed")
		return
	}
	if err != nil {
		writeErr(w, 500, "could not retry SMS job")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
