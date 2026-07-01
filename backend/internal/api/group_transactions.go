package api

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ledger/backend/internal/db"
)

type CategoryGroupTransactionsDTO struct {
	GroupID      string           `json:"group_id"`
	GroupName    string           `json:"group_name"`
	Month        string           `json:"month"`
	Total        float64          `json:"total"`
	Transactions []TransactionDTO `json:"transactions"`
}

func (s *Server) handleGetCategoryGroupTransactions(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}

	month := r.URL.Query().Get("month")
	if !monthRe.MatchString(month) {
		writeErr(w, http.StatusBadRequest, "month must be YYYY-MM")
		return
	}
	fromDate, toDate, err := monthDateRange(month)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "month must be YYYY-MM")
		return
	}

	uid := userID(r)
	grp, err := s.q.GetCategoryGroup(r.Context(), db.GetCategoryGroupParams{
		ID:     id,
		UserID: uid,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "category group not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not load category group")
		return
	}

	rows, err := s.q.ListTransactionsByGroupForMonth(r.Context(), db.ListTransactionsByGroupForMonthParams{
		UserID:   uid,
		FromDate: fromDate,
		ToDate:   toDate,
		GroupID:  id,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load category group transactions")
		return
	}
	total, err := s.q.SumTransactionsByGroupForMonth(r.Context(), db.SumTransactionsByGroupForMonthParams{
		UserID:   uid,
		FromDate: fromDate,
		ToDate:   toDate,
		GroupID:  id,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load category group transactions")
		return
	}

	out := make([]TransactionDTO, 0, len(rows))
	for _, t := range rows {
		out = append(out, txnToDTO(t))
	}
	writeJSON(w, http.StatusOK, CategoryGroupTransactionsDTO{
		GroupID:      grp.ID.String(),
		GroupName:    grp.Name,
		Month:        month,
		Total:        numToFloat(total),
		Transactions: out,
	})
}
