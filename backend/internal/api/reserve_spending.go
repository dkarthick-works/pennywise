package api

import (
	"errors"
	"math/big"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ledger/backend/internal/db"
	"github.com/ledger/backend/internal/money"
)

type reserveSpendingInput struct {
	ReserveID   string       `json:"reserve_id"`
	Amount      money.Number `json:"amount"`
	Date        string       `json:"date"`
	Description string       `json:"description"`
	Note        string       `json:"note"`
}

func parseReserveSpending(in reserveSpendingInput) (uuid.UUID, pgtype.Numeric, pgtype.Date, string, string, error) {
	reserveID, err := uuid.Parse(in.ReserveID)
	if err != nil {
		return uuid.Nil, pgtype.Numeric{}, pgtype.Date{}, "", "", errors.New("reserve_id must be a valid UUID")
	}
	amount, err := decimalToNumeric(in.Amount)
	if err != nil {
		return uuid.Nil, pgtype.Numeric{}, pgtype.Date{}, "", "", err
	}
	if amount.Int == nil || amount.Int.Sign() <= 0 {
		return uuid.Nil, pgtype.Numeric{}, pgtype.Date{}, "", "", errors.New("amount must be greater than zero")
	}
	date, err := parseDate(in.Date)
	if err != nil {
		return uuid.Nil, pgtype.Numeric{}, pgtype.Date{}, "", "", errors.New("date must be a valid YYYY-MM-DD date")
	}
	description := strings.TrimSpace(in.Description)
	if description == "" {
		return uuid.Nil, pgtype.Numeric{}, pgtype.Date{}, "", "", errors.New("description is required")
	}
	if utf8.RuneCountInString(description) > maxReserveDescriptionRunes {
		return uuid.Nil, pgtype.Numeric{}, pgtype.Date{}, "", "", errors.New("description must be 200 characters or fewer")
	}
	return reserveID, amount, date, description, strings.TrimSpace(in.Note), nil
}

func (s *Server) handleCreateReserveSpending(w http.ResponseWriter, r *http.Request) {
	var body reserveSpendingInput
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	reserveID, amount, date, description, note, err := parseReserveSpending(body)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	uid := userID(r)
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not record reserve spending")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := s.q.WithTx(tx)
	reserve, err := qtx.GetReserveForUserForUpdate(r.Context(), db.GetReserveForUserForUpdateParams{ID: reserveID, UserID: uid})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "reserve not found")
		} else {
			writeErr(w, http.StatusInternalServerError, "could not record reserve spending")
		}
		return
	}
	if reserve.ArchivedAt.Valid {
		writeErr(w, http.StatusConflict, "archived reserves cannot receive spending")
		return
	}
	balance, err := qtx.ReserveBalance(r.Context(), reserveID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not record reserve spending")
		return
	}
	if numericCents(balance).Cmp(numericCents(amount)) < 0 {
		writeErr(w, http.StatusConflict, "insufficient balance in "+reserve.Name)
		return
	}
	operation, err := qtx.InsertReserveOperation(r.Context(), db.InsertReserveOperationParams{
		UserID: uid, OperationType: "reserve_spend", OccurredOn: date, Description: description, Note: note,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not record reserve spending")
		return
	}
	entry, err := qtx.InsertReserveEntry(r.Context(), db.InsertReserveEntryParams{
		OperationID: operation.ID, ReserveID: reserveID, Direction: "withdrawal", Amount: amount,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not record reserve spending")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not record reserve spending")
		return
	}
	writeJSON(w, http.StatusCreated, reserveOperationDTO(operation, numericToJSONNumber(entry.Amount), []ReserveEntryDTO{{
		ID: entry.ID.String(), ReserveID: reserveID.String(), ReserveName: reserve.Name,
		Direction: entry.Direction, Amount: numericToJSONNumber(entry.Amount),
	}}))
}

func (s *Server) handleUpdateReserveSpending(w http.ResponseWriter, r *http.Request) {
	operationID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var body reserveSpendingInput
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	newReserveID, newAmount, date, description, note, err := parseReserveSpending(body)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	uid := userID(r)
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update reserve spending")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := s.q.WithTx(tx)
	operation, err := qtx.GetReserveOperationForUserForUpdate(r.Context(), db.GetReserveOperationForUserForUpdateParams{ID: operationID, UserID: uid})
	if err != nil {
		writeReserveOperationLookupError(w, err, "could not update reserve spending")
		return
	}
	if operation.OperationType != "reserve_spend" {
		writeErr(w, http.StatusConflict, "operation cannot be edited; delete and recreate it")
		return
	}
	entries, err := qtx.ListReserveEntriesForOperation(r.Context(), operationID)
	if err != nil || len(entries) != 1 {
		writeErr(w, http.StatusInternalServerError, "could not update reserve spending")
		return
	}
	oldReserveID := entries[0].ReserveID
	ids := []uuid.UUID{oldReserveID}
	if newReserveID != oldReserveID {
		ids = append(ids, newReserveID)
	}
	locked, err := qtx.LockAffectedReserves(r.Context(), db.LockAffectedReservesParams{UserID: uid, ReserveIds: ids})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update reserve spending")
		return
	}
	if len(locked) != len(ids) {
		writeErr(w, http.StatusNotFound, "reserve not found")
		return
	}
	reserveNames := make(map[uuid.UUID]string, len(locked))
	for _, reserve := range locked {
		if reserve.ArchivedAt.Valid {
			writeErr(w, http.StatusConflict, "archived reserves cannot receive spending")
			return
		}
		reserveNames[reserve.ID] = reserve.Name
	}
	oldBalance, err := qtx.ReserveBalance(r.Context(), oldReserveID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update reserve spending")
		return
	}
	newReserveBalance, err := qtx.ReserveBalance(r.Context(), newReserveID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update reserve spending")
		return
	}
	if newReserveID == oldReserveID {
		adjustedBalance := new(big.Int).Add(numericCents(oldBalance), numericCents(entries[0].Amount))
		if adjustedBalance.Cmp(numericCents(newAmount)) < 0 {
			writeErr(w, http.StatusConflict, "insufficient balance in "+reserveNames[oldReserveID])
			return
		}
	} else if numericCents(newReserveBalance).Cmp(numericCents(newAmount)) < 0 {
		writeErr(w, http.StatusConflict, "insufficient balance in "+reserveNames[newReserveID])
		return
	}
	updated, err := qtx.UpdateReserveOperation(r.Context(), db.UpdateReserveOperationParams{ID: operationID, UserID: uid, OccurredOn: date, Description: description, Note: note})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update reserve spending")
		return
	}
	entry, err := qtx.UpdateReserveEntry(r.Context(), db.UpdateReserveEntryParams{ID: entries[0].ID, OperationID: operationID, ReserveID: newReserveID, Amount: newAmount})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update reserve spending")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update reserve spending")
		return
	}
	reserveName := reserveNames[newReserveID]
	writeJSON(w, http.StatusOK, reserveOperationDTO(updated, numericToJSONNumber(entry.Amount), []ReserveEntryDTO{{ID: entry.ID.String(), ReserveID: entry.ReserveID.String(), ReserveName: reserveName, Direction: entry.Direction, Amount: numericToJSONNumber(entry.Amount)}}))
}

func (s *Server) handleDeleteReserveSpending(w http.ResponseWriter, r *http.Request) {
	operationID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not delete reserve spending")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := s.q.WithTx(tx)
	operation, err := qtx.GetReserveOperationForUserForUpdate(r.Context(), db.GetReserveOperationForUserForUpdateParams{ID: operationID, UserID: userID(r)})
	if err != nil {
		writeReserveOperationLookupError(w, err, "could not delete reserve spending")
		return
	}
	if operation.OperationType != "reserve_spend" {
		writeErr(w, http.StatusConflict, "operation cannot be deleted independently")
		return
	}
	entries, err := qtx.ListReserveEntriesForOperation(r.Context(), operationID)
	if err != nil || len(entries) != 1 {
		writeErr(w, http.StatusInternalServerError, "could not delete reserve spending")
		return
	}
	reserve, err := qtx.GetReserveForUserForUpdate(r.Context(), db.GetReserveForUserForUpdateParams{ID: entries[0].ReserveID, UserID: userID(r)})
	if err != nil {
		writeReserveLookupError(w, err, "could not delete reserve spending")
		return
	}
	if reserve.ArchivedAt.Valid {
		writeErr(w, http.StatusConflict, "archived reserve operations cannot be changed")
		return
	}
	deleted, err := qtx.DeleteReserveOperation(r.Context(), db.DeleteReserveOperationParams{ID: operationID, UserID: userID(r)})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not delete reserve spending")
		return
	}
	if deleted != 1 {
		writeErr(w, http.StatusNotFound, "reserve operation not found")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not delete reserve spending")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeReserveOperationLookupError(w http.ResponseWriter, err error, fallback string) {
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusNotFound, "reserve operation not found")
		return
	}
	writeErr(w, http.StatusInternalServerError, fallback)
}
