package api

import (
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ledger/backend/internal/db"
)

type DashboardMonthlyDTO struct {
	Month                   string  `json:"month"`
	Income                  float64 `json:"income"`
	CashFlow                float64 `json:"cash_flow"`
	MonthlyCost             float64 `json:"monthly_cost"`
	NetSaved                float64 `json:"net_saved"`
	SavingsRate             float64 `json:"savings_rate"`
	MonthlyDifference       float64 `json:"monthly_difference"`
	OutstandingCreditsCount int64   `json:"outstanding_credits_count"`
	OutstandingCreditsTotal float64 `json:"outstanding_credits_total"`
}

func (s *Server) handleGetDashboardMonthly(w http.ResponseWriter, r *http.Request) {
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

	row, err := s.q.SumDashboardMonthly(r.Context(), db.SumDashboardMonthlyParams{
		UserID:   userID(r),
		FromDate: fromDate,
		ToDate:   toDate,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load dashboard")
		return
	}

	writeJSON(w, http.StatusOK, dashboardMonthlyToDTO(month, row))
}

func monthDateRange(month string) (pgtype.Date, pgtype.Date, error) {
	start, err := time.Parse("2006-01", month)
	if err != nil {
		return pgtype.Date{}, pgtype.Date{}, err
	}
	return pgtype.Date{Time: start, Valid: true}, pgtype.Date{Time: start.AddDate(0, 1, 0), Valid: true}, nil
}

func dashboardMonthlyToDTO(month string, row db.SumDashboardMonthlyRow) DashboardMonthlyDTO {
	income := numToFloat(row.Income)
	cashFlow := numToFloat(row.CashFlow)
	monthlyCost := numToFloat(row.MonthlyCost)
	netSaved := income - cashFlow
	monthlyDifference := income - monthlyCost
	savingsRate := 0.0
	if income > 0 {
		savingsRate = (netSaved / income) * 100
	}

	return DashboardMonthlyDTO{
		Month:                   month,
		Income:                  income,
		CashFlow:                cashFlow,
		MonthlyCost:             monthlyCost,
		NetSaved:                netSaved,
		SavingsRate:             savingsRate,
		MonthlyDifference:       monthlyDifference,
		OutstandingCreditsCount: row.OutstandingCreditsCount,
		OutstandingCreditsTotal: numToFloat(row.OutstandingCreditsTotal),
	}
}
