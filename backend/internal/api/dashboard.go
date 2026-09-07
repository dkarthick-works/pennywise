package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ledger/backend/internal/db"
)

type DashboardMonthlyDTO struct {
	Month                        string  `json:"month"`
	Income                       float64 `json:"income"`
	CashSpending                 float64 `json:"cash_spending"`
	RemainingBalance             float64 `json:"remaining_balance"`
	FreeMoney                    float64 `json:"free_money"`
	BareMinimumSum               float64 `json:"bare_minimum_sum"`
	BareMinimumBudget            float64 `json:"bare_minimum_budget"`
	BareMinimumRemaining         float64 `json:"bare_minimum_remaining"`
	SubscriptionsSum             float64 `json:"subscriptions_sum"`
	SubscriptionsBudget          float64 `json:"subscriptions_budget"`
	SubscriptionsBudgetRemaining float64 `json:"subscriptions_budget_remaining"`
	DailySum                     float64 `json:"daily_sum"`
	DailyBudget                  float64 `json:"daily_budget"`
	DailyBudgetRemaining         float64 `json:"daily_budget_remaining"`
	CashFlow                     float64 `json:"cash_flow"`
	MonthlyCost                  float64 `json:"monthly_cost"`
	NetSaved                     float64 `json:"net_saved"`
	SavingsRate                  float64 `json:"savings_rate"`
	MonthlyDifference            float64 `json:"monthly_difference"`
	OutstandingCreditsCount      int64   `json:"outstanding_credits_count"`
	OutstandingCreditsTotal      float64 `json:"outstanding_credits_total"`
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

	result, err := loadDashboardMonthly(r.Context(), s.q, userID(r), month, fromDate, toDate)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load dashboard")
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// Shared by the dashboard and event suggestions; preserves the existing formula.
func loadDashboardMonthly(ctx context.Context, q *db.Queries, uid uuid.UUID, month string, fromDate, toDate pgtype.Date) (DashboardMonthlyDTO, error) {
	row, err := q.SumDashboardMonthly(ctx, db.SumDashboardMonthlyParams{
		UserID:   uid,
		FromDate: fromDate,
		ToDate:   toDate,
	})
	if err != nil {
		return DashboardMonthlyDTO{}, err
	}

	budget, err := q.GetMonthlyBudget(ctx, db.GetMonthlyBudgetParams{UserID: uid, Month: fromDate})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return DashboardMonthlyDTO{}, err
	}
	bareMinimumRemaining := numToFloat(budget.BudgetEssential) - numToFloat(row.EssentialSum)
	subscriptionsRemaining := numToFloat(budget.BudgetFlexible) - numToFloat(row.FlexibleSum)
	dailyRemaining := numToFloat(budget.BudgetDaily) - numToFloat(row.DailySum)
	budgetRemaining := bareMinimumRemaining + subscriptionsRemaining + dailyRemaining

	result := dashboardMonthlyToDTO(month, row, budgetRemaining)
	result.BareMinimumSum = numToFloat(row.EssentialSum)
	result.BareMinimumBudget = numToFloat(budget.BudgetEssential)
	result.BareMinimumRemaining = bareMinimumRemaining
	result.SubscriptionsSum = numToFloat(row.FlexibleSum)
	result.SubscriptionsBudget = numToFloat(budget.BudgetFlexible)
	result.SubscriptionsBudgetRemaining = subscriptionsRemaining
	result.DailySum = numToFloat(row.DailySum)
	result.DailyBudget = numToFloat(budget.BudgetDaily)
	result.DailyBudgetRemaining = dailyRemaining
	return result, nil
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
