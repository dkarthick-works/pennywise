package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ledger/backend/internal/db"
	"github.com/ledger/backend/internal/money"
)

type reserveTransferInput struct {
	FromReserveID string       `json:"from_reserve_id"`
	ToReserveID   string       `json:"to_reserve_id"`
	Amount        money.Number `json:"amount"`
	Date          string       `json:"date"`
	Note          string       `json:"note"`
}

func parseReserveTransfer(in reserveTransferInput) (uuid.UUID, uuid.UUID, pgtype.Numeric, pgtype.Date, string, error) {
	from, err := uuid.Parse(in.FromReserveID)
	if err != nil {
		return uuid.Nil, uuid.Nil, pgtype.Numeric{}, pgtype.Date{}, "", errors.New("from_reserve_id must be a valid UUID")
	}
	to, err := uuid.Parse(in.ToReserveID)
	if err != nil {
		return uuid.Nil, uuid.Nil, pgtype.Numeric{}, pgtype.Date{}, "", errors.New("to_reserve_id must be a valid UUID")
	}
	if from == to {
		return uuid.Nil, uuid.Nil, pgtype.Numeric{}, pgtype.Date{}, "", errors.New("source and destination reserves must differ")
	}
	amount, err := decimalToNumeric(in.Amount)
	if err != nil {
		return uuid.Nil, uuid.Nil, pgtype.Numeric{}, pgtype.Date{}, "", err
	}
	if amount.Int == nil || amount.Int.Sign() <= 0 {
		return uuid.Nil, uuid.Nil, pgtype.Numeric{}, pgtype.Date{}, "", errors.New("amount must be greater than zero")
	}
	date, err := parseDate(in.Date)
	if err != nil {
		return uuid.Nil, uuid.Nil, pgtype.Numeric{}, pgtype.Date{}, "", errors.New("date must be a valid YYYY-MM-DD date")
	}
	return from, to, amount, date, strings.TrimSpace(in.Note), nil
}

func (s *Server) handleCreateReserveTransfer(w http.ResponseWriter, r *http.Request) {
	var body reserveTransferInput
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	fromID, toID, amount, date, note, err := parseReserveTransfer(body)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	uid := userID(r)
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create reserve transfer")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := s.q.WithTx(tx)
	locked, err := qtx.LockAffectedReserves(r.Context(), db.LockAffectedReservesParams{UserID: uid, ReserveIds: []uuid.UUID{fromID, toID}})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create reserve transfer")
		return
	}
	if len(locked) != 2 {
		writeErr(w, http.StatusNotFound, "reserve not found")
		return
	}
	reserveNames := make(map[uuid.UUID]string, 2)
	for _, reserve := range locked {
		if reserve.ArchivedAt.Valid {
			writeErr(w, http.StatusConflict, "archived reserves cannot receive transfers")
			return
		}
		reserveNames[reserve.ID] = reserve.Name
	}
	balance, err := qtx.ReserveBalance(r.Context(), fromID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create reserve transfer")
		return
	}
	if numericCents(balance).Cmp(numericCents(amount)) < 0 {
		writeErr(w, http.StatusConflict, "insufficient balance in "+reserveNames[fromID])
		return
	}
	operation, err := qtx.InsertReserveOperation(r.Context(), db.InsertReserveOperationParams{UserID: uid, OperationType: "transfer", OccurredOn: date, Description: "Transfer between reserves", Note: note})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create reserve transfer")
		return
	}
	withdrawal, err := qtx.InsertReserveEntry(r.Context(), db.InsertReserveEntryParams{OperationID: operation.ID, ReserveID: fromID, Direction: "withdrawal", Amount: amount})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create reserve transfer")
		return
	}
	deposit, err := qtx.InsertReserveEntry(r.Context(), db.InsertReserveEntryParams{OperationID: operation.ID, ReserveID: toID, Direction: "deposit", Amount: amount})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create reserve transfer")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create reserve transfer")
		return
	}
	entries := []ReserveEntryDTO{
		{ID: withdrawal.ID.String(), ReserveID: fromID.String(), ReserveName: reserveNames[fromID], Direction: withdrawal.Direction, Amount: numericToJSONNumber(withdrawal.Amount)},
		{ID: deposit.ID.String(), ReserveID: toID.String(), ReserveName: reserveNames[toID], Direction: deposit.Direction, Amount: numericToJSONNumber(deposit.Amount)},
	}
	writeJSON(w, http.StatusCreated, reserveOperationDTO(operation, numericToJSONNumber(amount), entries))
}

func (s *Server) handleArchiveReserve(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	uid := userID(r)
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not archive reserve")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := s.q.WithTx(tx)
	reserve, err := qtx.GetReserveForUserForUpdate(r.Context(), db.GetReserveForUserForUpdateParams{ID: id, UserID: uid})
	if err != nil {
		writeReserveLookupError(w, err, "could not archive reserve")
		return
	}
	if reserve.IsGeneral {
		writeErr(w, http.StatusConflict, "general reserve cannot be archived")
		return
	}
	if reserve.ArchivedAt.Valid {
		writeErr(w, http.StatusConflict, "reserve is already archived")
		return
	}
	balance, err := qtx.ReserveBalance(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not archive reserve")
		return
	}
	if numericCents(balance).Sign() != 0 {
		writeErr(w, http.StatusConflict, "reserve must have a zero balance before it can be archived")
		return
	}
	if _, err := qtx.ArchiveReserve(r.Context(), db.ArchiveReserveParams{ID: id, UserID: uid}); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not archive reserve")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not archive reserve")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDeleteReserve(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	uid := userID(r)
	reserve, err := s.q.GetReserveForUser(r.Context(), db.GetReserveForUserParams{ID: id, UserID: uid})
	if err != nil {
		writeReserveLookupError(w, err, "could not delete reserve")
		return
	}
	if reserve.IsGeneral {
		writeErr(w, http.StatusConflict, "general reserve cannot be deleted")
		return
	}
	if reserve.ArchivedAt.Valid {
		writeErr(w, http.StatusConflict, "archived reserves cannot be deleted")
		return
	}
	deleted, err := s.q.DeleteReserve(r.Context(), db.DeleteReserveParams{ID: id, UserID: uid})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not delete reserve")
		return
	}
	if deleted != 1 {
		writeErr(w, http.StatusConflict, "reserve with ledger entries cannot be deleted")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDeleteReserveTransfer(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	uid := userID(r)
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not delete reserve transfer")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := s.q.WithTx(tx)
	operation, err := qtx.GetReserveOperationForUserForUpdate(r.Context(), db.GetReserveOperationForUserForUpdateParams{ID: id, UserID: uid})
	if err != nil {
		writeReserveOperationLookupError(w, err, "could not delete reserve transfer")
		return
	}
	if operation.OperationType != "transfer" {
		writeErr(w, http.StatusConflict, "operation cannot be deleted independently")
		return
	}
	entries, err := qtx.ListReserveEntriesForOperation(r.Context(), id)
	if err != nil || len(entries) != 2 {
		writeErr(w, http.StatusInternalServerError, "could not delete reserve transfer")
		return
	}
	reserveIDs := []uuid.UUID{entries[0].ReserveID, entries[1].ReserveID}
	locked, err := qtx.LockAffectedReserves(r.Context(), db.LockAffectedReservesParams{UserID: uid, ReserveIds: reserveIDs})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not delete reserve transfer")
		return
	}
	if len(locked) != 2 {
		writeErr(w, http.StatusNotFound, "reserve not found")
		return
	}
	reserveNames := make(map[uuid.UUID]string, len(locked))
	for _, reserve := range locked {
		if reserve.ArchivedAt.Valid {
			writeErr(w, http.StatusConflict, "archived reserve operations cannot be changed")
			return
		}
		reserveNames[reserve.ID] = reserve.Name
	}
	for _, entry := range entries {
		if entry.Direction != "deposit" {
			continue
		}
		balance, err := qtx.ReserveBalance(r.Context(), entry.ReserveID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not delete reserve transfer")
			return
		}
		if numericCents(balance).Cmp(numericCents(entry.Amount)) < 0 {
			writeErr(w, http.StatusConflict, "insufficient balance in "+reserveNames[entry.ReserveID])
			return
		}
	}
	if _, err := qtx.DeleteTransferOperation(r.Context(), db.DeleteTransferOperationParams{ID: id, UserID: uid}); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not delete reserve transfer")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not delete reserve transfer")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
