package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// All review operations lock the same source and draft rows. A completed source
// stays completed even if its ledger transaction is later deleted.
func lockSMSDraft(r *http.Request, tx pgx.Tx, rawID string, revision int) (uuid.UUID, error) {
	id, err := uuid.Parse(rawID)
	if err != nil {
		return uuid.Nil, smsHTTPError{400, "invalid SMS draft id"}
	}
	var source uuid.UUID
	var status string
	var current int
	err = tx.QueryRow(r.Context(), `SELECT s.id,s.status,d.revision FROM sms_transaction_drafts d
 JOIN sms_suggestions s ON s.id=d.source_sms_id AND s.user_id=d.user_id
 WHERE d.id=$1 AND d.user_id=$2 FOR UPDATE OF s,d`, id, userID(r)).Scan(&source, &status, &current)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, smsHTTPError{404, "SMS draft not found"}
	}
	if err != nil {
		return uuid.Nil, err
	}
	if status != "pending_review" {
		return uuid.Nil, smsHTTPError{409, "draft already reviewed or unavailable; refresh the list"}
	}
	if current != revision {
		return uuid.Nil, smsHTTPError{409, "draft changed in another session; refresh before reviewing"}
	}
	return source, nil
}
func writeSMSReviewError(w http.ResponseWriter, err error) {
	var e smsHTTPError
	if errors.As(err, &e) {
		writeErr(w, e.code, e.message)
		return
	}
	writeErr(w, 500, "could not update SMS draft")
}

type smsDraftEdit struct {
	txnInput
	Revision int `json:"revision"`
}

func (s *Server) handleUpdateSMSDraft(w http.ResponseWriter, r *http.Request) {
	var in smsDraftEdit
	if err := readJSON(r, &in); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	var section *string
	if in.Section != "" {
		section = &in.Section
	}
	// A saved draft may have no section; approval always requires one.
	values := transactionValues{Section: section, Category: &in.Category, Amount: numberOrNil(in.Amount), Date: &in.Date, Kind: &in.Kind}
	issues := validateTransactionValues(values, true, false)
	if section == nil {
		filtered := issues[:0]
		for _, i := range issues {
			if i.Field != "section" {
				filtered = append(filtered, i)
			}
		}
		issues = filtered
	}
	if len(issues) > 0 {
		writeJSON(w, 400, map[string]any{"error": "validation failed", "issues": issues})
		return
	}
	amount, _ := decimalToNumeric(in.Amount)
	if amount.Int.Sign() <= 0 {
		writeErr(w, 400, "SMS draft amount must be greater than zero")
		return
	}
	date, _ := parseDate(in.Date)
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeSMSReviewError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	source, err := lockSMSDraft(r, tx, chi.URLParam(r, "id"), in.Revision)
	if err != nil {
		writeSMSReviewError(w, err)
		return
	}
	_, err = tx.Exec(r.Context(), `UPDATE sms_transaction_drafts SET section=$2,category=$3,amount=$4,txn_date=$5,kind=$6,revision=revision+1,updated_at=now() WHERE source_sms_id=$1`, source, section, strings.TrimSpace(in.Category), amount, date, in.Kind)
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeSMSReviewError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleIgnoreSMSDraft(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Revision int `json:"revision"`
	}
	if err := readJSON(r, &in); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeSMSReviewError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	source, err := lockSMSDraft(r, tx, chi.URLParam(r, "id"), in.Revision)
	if err != nil {
		writeSMSReviewError(w, err)
		return
	}
	_, err = tx.Exec(r.Context(), `UPDATE sms_suggestions SET status='ignored',updated_at=now() WHERE id=$1`, source)
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeSMSReviewError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
