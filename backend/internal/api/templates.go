package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/ledger/backend/internal/db"
)

func (s *Server) handleGetTemplates(w http.ResponseWriter, r *http.Request) {
	tpl, err := s.loadTemplates(r)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load templates")
		return
	}
	writeJSON(w, http.StatusOK, tpl)
}

// handlePutTemplates replaces the ordered template list for one section.
func (s *Server) handlePutTemplates(w http.ResponseWriter, r *http.Request) {
	section := db.Section(chi.URLParam(r, "section"))
	if section != db.SectionEssential && section != db.SectionFlexible {
		writeErr(w, http.StatusBadRequest, "section must be essential or flexible")
		return
	}
	var body struct {
		Labels []string `json:"labels"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not save templates")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := s.q.WithTx(tx)

	if err := qtx.DeleteTemplatesBySection(r.Context(), db.DeleteTemplatesBySectionParams{UserID: userID(r), Section: section}); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not save templates")
		return
	}
	for i, label := range body.Labels {
		if label == "" {
			continue
		}
		if _, err := qtx.InsertTemplate(r.Context(), db.InsertTemplateParams{
			UserID: userID(r), Section: section, Label: label, Position: int32(i),
		}); err != nil {
			writeErr(w, http.StatusInternalServerError, "could not save templates")
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not save templates")
		return
	}

	s.handleGetTemplates(w, r)
}
