package api

import (
	"net/http"

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
