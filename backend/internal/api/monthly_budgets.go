package api

import (
	"errors"
	"math"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ledger/backend/internal/db"
)

const monthlyBudgetMax = 999999999999.99

type MonthlyBudgetDTO struct {
	Month     string  `json:"month"`
	Essential float64 `json:"essential"`
	Flexible  float64 `json:"flexible"`
	Daily     float64 `json:"daily"`
}

type monthlyBudgetRequest struct {
	Essential *float64 `json:"essential"`
	Flexible  *float64 `json:"flexible"`
	Daily     *float64 `json:"daily"`
}

func (s *Server) handleListMonthlyBudgets(w http.ResponseWriter, r *http.Request) {
	rows, err := s.q.ListMonthlyBudgets(r.Context(), userID(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load budgets")
		return
	}

	out := make([]MonthlyBudgetDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, monthlyBudgetToDTO(row))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleGetMonthlyBudget(w http.ResponseWriter, r *http.Request) {
	month := chi.URLParam(r, "month")
	monthDate, err := monthlyBudgetDate(month)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "month must be YYYY-MM")
		return
	}

	row, err := s.q.GetMonthlyBudget(r.Context(), db.GetMonthlyBudgetParams{
		UserID: userID(r),
		Month:  monthDate,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusOK, MonthlyBudgetDTO{Month: month})
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load budget")
		return
	}

	writeJSON(w, http.StatusOK, monthlyBudgetToDTO(row))
}

func (s *Server) handlePutMonthlyBudget(w http.ResponseWriter, r *http.Request) {
	month := chi.URLParam(r, "month")
	monthDate, err := monthlyBudgetDate(month)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "month must be YYYY-MM")
		return
	}

	var body monthlyBudgetRequest
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if body.Essential == nil || body.Flexible == nil || body.Daily == nil {
		writeErr(w, http.StatusBadRequest, "essential, flexible, and daily are required")
		return
	}
	for field, value := range map[string]float64{
		"essential": *body.Essential,
		"flexible":  *body.Flexible,
		"daily":     *body.Daily,
	} {
		if err := validateMonthlyBudget(value, field); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
	}

	row, err := s.q.UpsertMonthlyBudget(r.Context(), db.UpsertMonthlyBudgetParams{
		UserID:          userID(r),
		Month:           monthDate,
		BudgetEssential: floatToNum(*body.Essential),
		BudgetFlexible:  floatToNum(*body.Flexible),
		BudgetDaily:     floatToNum(*body.Daily),
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update budget")
		return
	}

	writeJSON(w, http.StatusOK, monthlyBudgetToDTO(row))
}

func monthlyBudgetDate(month string) (pgtype.Date, error) {
	if !monthRe.MatchString(month) {
		return pgtype.Date{}, errors.New("month must be YYYY-MM")
	}
	fromDate, _, err := monthDateRange(month)
	return fromDate, err
}

func monthlyBudgetToDTO(row db.MonthlyBudget) MonthlyBudgetDTO {
	return MonthlyBudgetDTO{
		Month:     row.Month.Time.Format("2006-01"),
		Essential: numToFloat(row.BudgetEssential),
		Flexible:  numToFloat(row.BudgetFlexible),
		Daily:     numToFloat(row.BudgetDaily),
	}
}

func validateMonthlyBudget(value float64, field string) error {
	if value < 0 || math.IsNaN(value) || math.IsInf(value, 0) {
		return errors.New(field + " must be zero or greater")
	}
	if value > monthlyBudgetMax {
		return errors.New(field + " exceeds maximum")
	}
	if math.Abs(value*100-math.Round(value*100)) > 1e-6 {
		return errors.New(field + " must have at most two decimal places")
	}
	return nil
}
