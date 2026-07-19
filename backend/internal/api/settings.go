package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/ledger/backend/internal/db"
)

func (s *Server) loadTemplates(r *http.Request) (TemplatesDTO, error) {
	rows, err := s.q.ListTemplates(r.Context(), userID(r))
	if err != nil {
		return TemplatesDTO{}, err
	}
	tpl := TemplatesDTO{Essential: []string{}, Flexible: []string{}}
	for _, t := range rows {
		switch t.Section {
		case db.SectionEssential:
			tpl.Essential = append(tpl.Essential, t.Label)
		case db.SectionFlexible:
			tpl.Flexible = append(tpl.Flexible, t.Label)
		}
	}
	return tpl, nil
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	st, err := s.q.GetSettings(r.Context(), userID(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load settings")
		return
	}
	tpl, err := s.loadTemplates(r)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load templates")
		return
	}
	writeJSON(w, http.StatusOK, settingsToDTO(st, tpl))
}

func (s *Server) handleUpdateBudgets(w http.ResponseWriter, r *http.Request) {
	var body BudgetsDTO
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := s.q.UpdateBudgets(r.Context(), db.UpdateBudgetsParams{
		UserID:          userID(r),
		BudgetEssential: floatToNum(body.Essential),
		BudgetFlexible:  floatToNum(body.Flexible),
		BudgetDaily:     floatToNum(body.Daily),
	}); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update budgets")
		return
	}
	s.handleGetSettings(w, r)
}

func (s *Server) handleUpdatePreferences(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Currency string `json:"currency"`
		Theme    string `json:"theme"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := s.q.UpdatePreferences(r.Context(), db.UpdatePreferencesParams{
		UserID:   userID(r),
		Currency: body.Currency,
		Theme:    body.Theme,
	}); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update preferences")
		return
	}
	s.handleGetSettings(w, r)
}

// handleUpdateCreditStatementDay sets or clears the credit card statement
// closing day. It is deliberately separate from preferences so a currency/theme
// save can never disturb the cycle, and vice versa.
//
// The property must be present. An explicit JSON null clears the cycle; an
// integer 1..31 sets it. Decimals, strings, and out-of-range values are 400s.
func (s *Server) handleUpdateCreditStatementDay(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CreditStatementDay *json.RawMessage `json:"credit_statement_day"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if body.CreditStatementDay == nil {
		writeErr(w, http.StatusBadRequest, "credit_statement_day is required")
		return
	}

	var day *int16
	if strings.TrimSpace(string(*body.CreditStatementDay)) != "null" {
		var n int
		if err := json.Unmarshal(*body.CreditStatementDay, &n); err != nil {
			writeErr(w, http.StatusBadRequest, "credit_statement_day must be an integer 1..31 or null")
			return
		}
		if n < 1 || n > 31 {
			writeErr(w, http.StatusBadRequest, "credit_statement_day must be between 1 and 31")
			return
		}
		v := int16(n)
		day = &v
	}

	if _, err := s.q.UpdateCreditStatementDay(r.Context(), db.UpdateCreditStatementDayParams{
		UserID:             userID(r),
		CreditStatementDay: day,
	}); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update credit statement day")
		return
	}
	s.handleGetSettings(w, r)
}
