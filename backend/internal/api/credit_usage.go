package api

import (
	"context"
	"net/http"

	"github.com/google/uuid"

	"github.com/ledger/backend/internal/db"
)

const isoDate = "2006-01-02"

// CreditUsageBucketDTO is a summed credit window with inclusive display dates.
type CreditUsageBucketDTO struct {
	From  string  `json:"from"`
	To    string  `json:"to"`
	Total float64 `json:"total"`
	Count int64   `json:"count"`
}

// CreditBillingCycleBucketDTO adds the configured statement day to a bucket.
type CreditBillingCycleBucketDTO struct {
	StatementDay int     `json:"statement_day"`
	From         string  `json:"from"`
	To           string  `json:"to"`
	Total        float64 `json:"total"`
	Count        int64   `json:"count"`
}

// CreditUsageDTO is the dashboard summary payload. BillingCycle is a pointer so
// it serializes as explicit null when no statement day is configured.
type CreditUsageDTO struct {
	Month         string                       `json:"month"`
	CalendarMonth CreditUsageBucketDTO         `json:"calendar_month"`
	BillingCycle  *CreditBillingCycleBucketDTO `json:"billing_cycle"`
}

// CreditTransactionsDTO is the authoritative drill-down payload for one view.
type CreditTransactionsDTO struct {
	Month        string           `json:"month"`
	View         string           `json:"view"`
	From         string           `json:"from"`
	To           string           `json:"to"`
	Total        float64          `json:"total"`
	Count        int64            `json:"count"`
	Transactions []TransactionDTO `json:"transactions"`
}

// sumCreditUsage runs the shared credit aggregate over a half-open window.
func (s *Server) sumCreditUsage(ctx context.Context, uid uuid.UUID, rng dateRange) (float64, int64, error) {
	row, err := s.q.SumCreditUsage(ctx, db.SumCreditUsageParams{
		UserID:   uid,
		FromDate: rng.queryFrom,
		ToDate:   rng.queryTo,
	})
	if err != nil {
		return 0, 0, err
	}
	return numToFloat(row.Total), row.Count, nil
}

// handleGetCreditUsage returns calendar-month and (when configured)
// statement-cycle credit spend for the selected month. Both windows are derived
// solely from the month parameter, never from today's date.
func (s *Server) handleGetCreditUsage(w http.ResponseWriter, r *http.Request) {
	month := r.URL.Query().Get("month")
	if !monthRe.MatchString(month) {
		writeErr(w, http.StatusBadRequest, "month must be YYYY-MM")
		return
	}

	calRange, err := calendarMonthRange(month)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "month must be YYYY-MM")
		return
	}

	uid := userID(r)
	ctx := r.Context()

	calTotal, calCount, err := s.sumCreditUsage(ctx, uid, calRange)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load credit usage")
		return
	}

	out := CreditUsageDTO{
		Month: month,
		CalendarMonth: CreditUsageBucketDTO{
			From:  calRange.displayFrom.Format(isoDate),
			To:    calRange.displayTo.Format(isoDate),
			Total: calTotal,
			Count: calCount,
		},
	}

	settings, err := s.q.GetSettings(ctx, uid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load credit usage")
		return
	}
	if settings.CreditStatementDay != nil {
		day := int(*settings.CreditStatementDay)
		cycleRange, err := statementCycleRange(month, day)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not load credit usage")
			return
		}
		cycleTotal, cycleCount, err := s.sumCreditUsage(ctx, uid, cycleRange)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not load credit usage")
			return
		}
		out.BillingCycle = &CreditBillingCycleBucketDTO{
			StatementDay: day,
			From:         cycleRange.displayFrom.Format(isoDate),
			To:           cycleRange.displayTo.Format(isoDate),
			Total:        cycleTotal,
			Count:        cycleCount,
		}
	}

	writeJSON(w, http.StatusOK, out)
}

// handleGetCreditTransactions returns the authoritative credit rows for either
// the calendar-month or statement-cycle window. It reuses the same range
// helpers and aggregate as the summary endpoint so totals reconcile exactly.
func (s *Server) handleGetCreditTransactions(w http.ResponseWriter, r *http.Request) {
	month := r.URL.Query().Get("month")
	if !monthRe.MatchString(month) {
		writeErr(w, http.StatusBadRequest, "month must be YYYY-MM")
		return
	}

	view := r.URL.Query().Get("view")
	if view == "" {
		view = "calendar"
	}
	if view != "calendar" && view != "billing" {
		writeErr(w, http.StatusBadRequest, "view must be calendar or billing")
		return
	}

	uid := userID(r)
	ctx := r.Context()

	var rng dateRange
	if view == "billing" {
		settings, err := s.q.GetSettings(ctx, uid)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not load credit transactions")
			return
		}
		if settings.CreditStatementDay == nil {
			writeErr(w, http.StatusBadRequest, "set a credit statement day to view the billing cycle")
			return
		}
		rng, err = statementCycleRange(month, int(*settings.CreditStatementDay))
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not load credit transactions")
			return
		}
	} else {
		var err error
		rng, err = calendarMonthRange(month)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "month must be YYYY-MM")
			return
		}
	}

	rows, err := s.q.ListCreditTransactionsByDateRange(ctx, db.ListCreditTransactionsByDateRangeParams{
		UserID:   uid,
		FromDate: rng.queryFrom,
		ToDate:   rng.queryTo,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load credit transactions")
		return
	}

	// Use the same aggregate as the summary endpoint for total/count so detail
	// metadata never drifts from re-summing float64 values.
	total, count, err := s.sumCreditUsage(ctx, uid, rng)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load credit transactions")
		return
	}

	txns := make([]TransactionDTO, 0, len(rows))
	for _, t := range rows {
		txns = append(txns, txnToDTO(t))
	}

	writeJSON(w, http.StatusOK, CreditTransactionsDTO{
		Month:        month,
		View:         view,
		From:         rng.displayFrom.Format(isoDate),
		To:           rng.displayTo.Format(isoDate),
		Total:        total,
		Count:        count,
		Transactions: txns,
	})
}
