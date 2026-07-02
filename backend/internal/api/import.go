package api

import (
	"net/http"
	"sort"
	"strings"

	"github.com/ledger/backend/internal/db"
)

const (
	maxImportRows        = 2000
	importRowCapMessage  = "import exceeds maximum of 2000 rows"
	importNoRowsMessage  = "no rows to import"
	importFailedMessage  = "could not import transactions"
)

type importRowInput struct {
	Date     string  `json:"date"`
	Section  string  `json:"section"`
	Category string  `json:"category"`
	Amount   float64 `json:"amount"`
	Kind     string  `json:"kind"`
}

type importRequest struct {
	Rows []importRowInput `json:"rows"`
}

type importRowFieldErrors map[string]string

type importRowError struct {
	Index  int                  `json:"index"`
	Fields importRowFieldErrors `json:"fields"`
}

type importValidationError struct {
	Rows []importRowError
}

func (e *importValidationError) Error() string {
	return "validation failed"
}

type importResult struct {
	Imported int      `json:"imported"`
	Months   []string `json:"months"`
}

func validImportKind(k string) bool {
	return validKind(k) && k != "settlement"
}

func validateImportRow(row importRowInput) importRowFieldErrors {
	fields := make(importRowFieldErrors)

	if !dateRe.MatchString(row.Date) {
		fields["date"] = "must be YYYY-MM-DD"
	} else if _, err := parseDate(row.Date); err != nil {
		fields["date"] = "must be a valid date"
	}

	if !validSection(row.Section) {
		fields["section"] = "must be essential, flexible, daily, or income"
	}

	if row.Kind == "settlement" {
		fields["kind"] = "settlement rows cannot be imported"
	} else if !validImportKind(row.Kind) {
		fields["kind"] = "must be cash or credit"
	}

	if row.Amount < 0 {
		fields["amount"] = "must be zero or greater"
	}

	if strings.TrimSpace(row.Category) == "" {
		fields["category"] = "is required"
	}

	if row.Section == "income" && row.Kind != "" && row.Kind != "cash" {
		fields["kind"] = "income must be cash"
	}
	if row.Kind == "credit" && row.Section == "income" {
		fields["kind"] = "credit cannot be used with income"
	}

	return fields
}

func validateImportRows(rows []importRowInput) []importRowError {
	var out []importRowError
	for i, row := range rows {
		if fields := validateImportRow(row); len(fields) > 0 {
			out = append(out, importRowError{Index: i, Fields: fields})
		}
	}
	return out
}

func monthFromImportDate(date string) (string, error) {
	d, err := parseDate(date)
	if err != nil {
		return "", err
	}
	return d.Time.Format("2006-01"), nil
}

func (s *Server) handleImportTransactions(w http.ResponseWriter, r *http.Request) {
	var in importRequest
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	if len(in.Rows) == 0 {
		writeErr(w, http.StatusBadRequest, importNoRowsMessage)
		return
	}
	if len(in.Rows) > maxImportRows {
		writeErr(w, http.StatusBadRequest, importRowCapMessage)
		return
	}

	if rowErrors := validateImportRows(in.Rows); len(rowErrors) > 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "validation failed",
			"rows":  rowErrors,
		})
		return
	}

	uid := userID(r)
	ctx := r.Context()

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, importFailedMessage)
		return
	}
	defer tx.Rollback(ctx)
	qtx := s.q.WithTx(tx)

	monthSet := make(map[string]struct{})
	for _, row := range in.Rows {
		d, err := parseDate(row.Date)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "validation failed")
			return
		}
		if _, err := qtx.InsertTransaction(ctx, db.InsertTransactionParams{
			UserID:   uid,
			Section:  db.Section(row.Section),
			Category: strings.TrimSpace(row.Category),
			Amount:   floatToNum(row.Amount),
			TxnDate:  d,
			Kind:     db.TxnKind(row.Kind),
		}); err != nil {
			writeErr(w, http.StatusInternalServerError, importFailedMessage)
			return
		}
		mk, err := monthFromImportDate(row.Date)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, importFailedMessage)
			return
		}
		monthSet[mk] = struct{}{}
	}

	months := make([]string, 0, len(monthSet))
	for mk := range monthSet {
		if _, err := qtx.MarkMonthSeeded(ctx, db.MarkMonthSeededParams{UserID: uid, Month: mk}); err != nil {
			writeErr(w, http.StatusInternalServerError, importFailedMessage)
			return
		}
		months = append(months, mk)
	}
	sort.Strings(months)

	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, importFailedMessage)
		return
	}

	writeJSON(w, http.StatusCreated, importResult{Imported: len(in.Rows), Months: months})
}
