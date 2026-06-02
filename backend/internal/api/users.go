package api

import (
	"context"
	"errors"
	"log"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/ledger/backend/internal/auth"
	"github.com/ledger/backend/internal/db"
)

// ensureUser mirrors the Goauth subject into our DB on first sight and
// initialises settings + template labels for brand-new accounts.
func (s *Server) ensureUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := auth.FromContext(r.Context())
		if !ok {
			writeErr(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if err := s.provisionUser(r.Context(), id); err != nil {
			log.Printf("provision user %s: %v", id.UserID, err)
			writeErr(w, http.StatusInternalServerError, "could not provision account")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) provisionUser(ctx context.Context, id auth.Identity) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	qtx := s.q.WithTx(tx)

	if _, err := qtx.UpsertUser(ctx, db.UpsertUserParams{ID: id.UserID, Email: id.Email}); err != nil {
		return err
	}

	// EnsureSettings inserts the user's settings row on first sight.
	// No templates or transactions are created — users configure everything themselves.
	if _, err := qtx.EnsureSettings(ctx, id.UserID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}

	return tx.Commit(ctx)
}

func (s *Server) handleGetProfile(w http.ResponseWriter, r *http.Request) {
	u, err := s.q.GetUser(r.Context(), userID(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load profile")
		return
	}
	writeJSON(w, http.StatusOK, ProfileDTO{UserID: u.ID.String(), Email: u.Email, DisplayName: u.DisplayName})
}

func (s *Server) handleUpdateProfile(w http.ResponseWriter, r *http.Request) {
	var body struct {
		DisplayName string `json:"display_name"`
		Email       string `json:"email"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	u, err := s.q.UpdateUserProfile(r.Context(), db.UpdateUserProfileParams{
		ID: userID(r), DisplayName: body.DisplayName, Email: body.Email,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update profile")
		return
	}
	writeJSON(w, http.StatusOK, ProfileDTO{UserID: u.ID.String(), Email: u.Email, DisplayName: u.DisplayName})
}
