package api

import (
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ledger/backend/internal/db"
)

type DashboardMonthlyDTO struct {
	Month                   string  `json:"month"`
	Income                  float64 `json:"income"`
	CashSpending            float64 `json:"cash_spending"`
	RemainingBalance        float64 `json:"remaining_balance"`
	FreeMoney               float64 `json:"free_money"`
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

	ctx := r.Context()
	uid := userID(r)
	row, err := s.q.SumDashboardMonthly(ctx, db.SumDashboardMonthlyParams{
		UserID:   uid,
		FromDate: fromDate,
		ToDate:   toDate,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load dashboard")
		return
	}

	budget, err := s.q.GetMonthlyBudget(ctx, db.GetMonthlyBudgetParams{UserID: uid, Month: fromDate})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusInternalServerError, "could not load dashboard")
		return
	}
	bareMinimumRemaining := numToFloat(budget.BudgetEssential) - numToFloat(row.EssentialSum)
	subscriptionsRemaining := numToFloat(budget.BudgetFlexible) - numToFloat(row.FlexibleSum)
	dailyRemaining := numToFloat(budget.BudgetDaily) - numToFloat(row.DailySum)
	budgetRemaining := bareMinimumRemaining + subscriptionsRemaining + dailyRemaining

	writeJSON(w, http.StatusOK, dashboardMonthlyToDTO(month, row, budgetRemaining))
}

func monthDateRange(month string) (pgtype.Date, pgtype.Date, error) {
	start, err := time.Parse("2006-01", month)
	if err != nil {
		return pgtype.Date{}, pgtype.Date{}, err
	}
	return pgtype.Date{Time: start, Valid: true}, pgtype.Date{Time: start.AddDate(0, 1, 0), Valid: true}, nil
}

func dashboardMonthlyToDTO(month string, row db.SumDashboardMonthlyRow, budgetRemaining float64) DashboardMonthlyDTO {
	income := numToFloat(row.Income)
	cashSpending := numToFloat(row.CashFlow)
	monthlyCost := numToFloat(row.MonthlyCost)
	remainingBalance := income - cashSpending
	freeMoney := remainingBalance - budgetRemaining
	monthlyDifference := income - monthlyCost
	savingsRate := 0.0
	if income > 0 {
		savingsRate = (remainingBalance / income) * 100
	}

	return DashboardMonthlyDTO{
		Month:                   month,
		Income:                  income,
		CashSpending:            cashSpending,
		RemainingBalance:        remainingBalance,
		FreeMoney:               freeMoney,
		CashFlow:                cashSpending,
		MonthlyCost:             monthlyCost,
		NetSaved:                remainingBalance,
		SavingsRate:             savingsRate,
		MonthlyDifference:       monthlyDifference,
		OutstandingCreditsCount: row.OutstandingCreditsCount,
		OutstandingCreditsTotal: numToFloat(row.OutstandingCreditsTotal),
	}
}
