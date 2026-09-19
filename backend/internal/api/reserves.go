package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ledger/backend/internal/db"
)

const maxActiveReserves = 5

type ReserveDTO struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	IsGeneral bool    `json:"is_general"`
	Archived  bool    `json:"archived"`
	Balance   float64 `json:"balance"`
}

type reserveNameInput struct {
	Name string `json:"name"`
}

func reserveToDTO(id uuid.UUID, name string, isGeneral, archived bool, balance float64) ReserveDTO {
	return ReserveDTO{ID: id.String(), Name: name, IsGeneral: isGeneral, Archived: archived, Balance: balance}
}

func parseReserveName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", errors.New("reserve name is required")
	}
	if utf8.RuneCountInString(name) > 80 {
		return "", errors.New("reserve name must be 80 characters or fewer")
	}
	return name, nil
}

func reserveID(r *http.Request) (uuid.UUID, error) {
	return uuid.Parse(chi.URLParam(r, "id"))
}

func (s *Server) handleListReserves(w http.ResponseWriter, r *http.Request) {
	includeArchived := false
	if raw := r.URL.Query().Get("include_archived"); raw != "" {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "include_archived must be true or false")
			return
		}
		includeArchived = value
	}
	rows, err := s.q.ListReserves(r.Context(), db.ListReservesParams{UserID: userID(r), IncludeArchived: includeArchived})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load reserves")
		return
	}
	out := make([]ReserveDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, reserveToDTO(row.ID, row.Name, row.IsGeneral, row.ArchivedAt.Valid, numToFloat(row.Balance)))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleCreateReserve(w http.ResponseWriter, r *http.Request) {
	var body reserveNameInput
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	name, err := parseReserveName(body.Name)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create reserve")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := s.q.WithTx(tx)
	uid := userID(r)
	if _, err := qtx.LockUserForReserveCount(r.Context(), uid); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create reserve")
		return
	}
	exists, err := qtx.ReserveNameExists(r.Context(), db.ReserveNameExistsParams{UserID: uid, Name: name, ExcludeID: uuid.Nil})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create reserve")
		return
	}
	if exists {
		writeErr(w, http.StatusConflict, "reserve name already exists")
		return
	}
	count, err := qtx.CountActiveReserves(r.Context(), uid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create reserve")
		return
	}
	if count >= maxActiveReserves {
		writeErr(w, http.StatusConflict, "a maximum of 5 active reserves is allowed")
		return
	}
	created, err := qtx.CreateReserve(r.Context(), db.CreateReserveParams{UserID: uid, Name: name})
	if err != nil {
		if isUniqueViolation(err) {
			writeErr(w, http.StatusConflict, "reserve name already exists")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not create reserve")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create reserve")
		return
	}
	writeJSON(w, http.StatusCreated, reserveToDTO(created.ID, created.Name, created.IsGeneral, created.ArchivedAt.Valid, 0))
}

func (s *Server) handleRenameReserve(w http.ResponseWriter, r *http.Request) {
	id, err := reserveID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var body reserveNameInput
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	name, err := parseReserveName(body.Name)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	uid := userID(r)
	reserve, err := s.q.GetReserveForUser(r.Context(), db.GetReserveForUserParams{ID: id, UserID: uid})
	if err != nil {
		writeReserveLookupError(w, err, "could not rename reserve")
		return
	}
	if reserve.ArchivedAt.Valid {
		writeErr(w, http.StatusConflict, "archived reserves cannot be renamed")
		return
	}
	exists, err := s.q.ReserveNameExists(r.Context(), db.ReserveNameExistsParams{UserID: uid, Name: name, ExcludeID: id})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not rename reserve")
		return
	}
	if exists {
		writeErr(w, http.StatusConflict, "reserve name already exists")
		return
	}
	if _, err := s.q.RenameReserve(r.Context(), db.RenameReserveParams{Name: name, ID: id, UserID: uid}); err != nil {
		if isUniqueViolation(err) {
			writeErr(w, http.StatusConflict, "reserve name already exists")
			return
		}
		writeReserveLookupError(w, err, "could not rename reserve")
		return
	}
	updated, err := s.q.GetReserveForUser(r.Context(), db.GetReserveForUserParams{ID: id, UserID: uid})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not rename reserve")
		return
	}
	writeJSON(w, http.StatusOK, reserveToDTO(updated.ID, updated.Name, updated.IsGeneral, updated.ArchivedAt.Valid, numToFloat(updated.Balance)))
}

func writeReserveLookupError(w http.ResponseWriter, err error, fallback string) {
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusNotFound, "reserve not found")
		return
	}
	writeErr(w, http.StatusInternalServerError, fallback)
}
