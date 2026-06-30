package api

import (
	"net/http"

	"github.com/ledger/backend/internal/db"
)

type GroupSpendItemDTO struct {
	GroupID   string  `json:"group_id"`
	GroupName string  `json:"group_name"`
	Total     float64 `json:"total"`
}

func (s *Server) handleGetGroupSpend(w http.ResponseWriter, r *http.Request) {
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

	rows, err := s.q.SumSpendByGroupsForMonth(r.Context(), db.SumSpendByGroupsForMonthParams{
		FromDate: fromDate,
		ToDate:   toDate,
		UserID:   userID(r),
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load group spend")
		return
	}

	out := make([]GroupSpendItemDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, GroupSpendItemDTO{
			GroupID:   row.GroupID.String(),
			GroupName: row.GroupName,
			Total:     numToFloat(row.Total),
		})
	}
	writeJSON(w, http.StatusOK, out)
}
