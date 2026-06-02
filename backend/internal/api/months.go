package api

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/ledger/backend/internal/db"
)

func (s *Server) handleGetMonth(w http.ResponseWriter, r *http.Request) {
	month := chi.URLParam(r, "month")
	if !monthRe.MatchString(month) {
		writeErr(w, http.StatusBadRequest, "month must be YYYY-MM")
		return
	}
	st, err := s.q.GetMonthState(r.Context(), db.GetMonthStateParams{UserID: userID(r), Month: month})
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusOK, MonthStateDTO{Month: month, Closed: false, Seeded: false})
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load month state")
		return
	}
	writeJSON(w, http.StatusOK, MonthStateDTO{Month: st.Month, Closed: st.Closed, Seeded: st.Seeded})
}

func (s *Server) handleSetMonthClosed(w http.ResponseWriter, r *http.Request) {
	month := chi.URLParam(r, "month")
	if !monthRe.MatchString(month) {
		writeErr(w, http.StatusBadRequest, "month must be YYYY-MM")
		return
	}
	var body struct {
		Closed bool `json:"closed"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	st, err := s.q.UpsertMonthClosed(r.Context(), db.UpsertMonthClosedParams{UserID: userID(r), Month: month, Closed: body.Closed})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update month")
		return
	}
	writeJSON(w, http.StatusOK, MonthStateDTO{Month: st.Month, Closed: st.Closed, Seeded: st.Seeded})
}

// handleOpenMonth clones the essential + flexible templates (blank amounts) into
// a month the first time it is opened, then returns that month's transactions.
// Mirrors the prototype's auto-clone-on-navigation behaviour, server-side.
func (s *Server) handleOpenMonth(w http.ResponseWriter, r *http.Request) {
	month := chi.URLParam(r, "month")
	if !monthRe.MatchString(month) {
		writeErr(w, http.StatusBadRequest, "month must be YYYY-MM")
		return
	}
	uid := userID(r)
	ctx := r.Context()

	st, err := s.q.GetMonthState(ctx, db.GetMonthStateParams{UserID: uid, Month: month})
	seeded := err == nil && st.Seeded
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusInternalServerError, "could not open month")
		return
	}

	if !seeded {
		tmpls, err := s.q.ListTemplates(ctx, uid)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not open month")
			return
		}
		tx, err := s.pool.Begin(ctx)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not open month")
			return
		}
		defer tx.Rollback(ctx)
		qtx := s.q.WithTx(tx)

		first, _ := parseDate(month + "-01")
		for _, t := range tmpls {
			if _, err := qtx.InsertTransaction(ctx, db.InsertTransactionParams{
				UserID: uid, Section: t.Section, Category: t.Label,
				Amount: floatToNum(0), TxnDate: first, Kind: db.TxnKindCash,
			}); err != nil {
				writeErr(w, http.StatusInternalServerError, "could not open month")
				return
			}
		}
		if _, err := qtx.MarkMonthSeeded(ctx, db.MarkMonthSeededParams{UserID: uid, Month: month}); err != nil {
			writeErr(w, http.StatusInternalServerError, "could not open month")
			return
		}
		if err := tx.Commit(ctx); err != nil {
			writeErr(w, http.StatusInternalServerError, "could not open month")
			return
		}
	}

	// re-read fresh state, then hand off to the list handler shape
	closed := false
	if st, err := s.q.GetMonthState(ctx, db.GetMonthStateParams{UserID: uid, Month: month}); err == nil {
		closed = st.Closed
	}
	txns, err := s.q.ListTransactionsByMonth(ctx, db.ListTransactionsByMonthParams{UserID: uid, Month: month})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load month")
		return
	}
	out := make([]TransactionDTO, 0, len(txns))
	for _, t := range txns {
		out = append(out, txnToDTO(t))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"month":        month,
		"closed":       closed,
		"seeded":       true,
		"transactions": out,
	})
}
