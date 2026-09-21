package api

import (
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/ledger/backend/internal/db"
	"github.com/ledger/backend/internal/money"
)

type reserveIncomeTransferInput struct {
	ReserveID   string       `json:"reserve_id"`
	Amount      money.Number `json:"amount"`
	Date        string       `json:"date"`
	Description string       `json:"description"`
	Note        string       `json:"note"`
}

func (s *Server) handleCreateReserveIncomeTransfer(w http.ResponseWriter, r *http.Request) {
	var input reserveIncomeTransferInput
	if err := readJSON(r, &input); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	reserveID, err := uuid.Parse(input.ReserveID)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "reserve_id must be a valid UUID")
		return
	}
	amount, err := decimalToNumeric(input.Amount)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if amount.Int == nil || amount.Int.Sign() <= 0 {
		writeErr(w, http.StatusBadRequest, "amount must be greater than zero")
		return
	}
	date, err := parseDate(input.Date)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "date must be a valid YYYY-MM-DD date")
		return
	}
	uid := userID(r)
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not move reserve money to income")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := s.q.WithTx(tx)
	reserve, err := qtx.GetReserveForUserForUpdate(r.Context(), db.GetReserveForUserForUpdateParams{ID: reserveID, UserID: uid})
	if err != nil {
		writeReserveLookupError(w, err, "could not move reserve money to income")
		return
	}
	if reserve.ArchivedAt.Valid {
		writeErr(w, http.StatusConflict, "archived reserves cannot receive income transfers")
		return
	}
	balance, err := qtx.ReserveBalance(r.Context(), reserveID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not move reserve money to income")
		return
	}
	if numericCents(balance).Cmp(numericCents(amount)) < 0 {
		writeErr(w, http.StatusConflict, "insufficient balance in "+reserve.Name)
		return
	}
	description := strings.TrimSpace(input.Description)
	if description == "" {
		description = "From " + reserve.Name
	}
	operation, err := qtx.InsertReserveOperation(r.Context(), db.InsertReserveOperationParams{UserID: uid, OperationType: "move_to_income", OccurredOn: date, Description: description, Note: strings.TrimSpace(input.Note)})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not move reserve money to income")
		return
	}
	entry, err := qtx.InsertReserveEntry(r.Context(), db.InsertReserveEntryParams{OperationID: operation.ID, ReserveID: reserveID, Direction: "withdrawal", Amount: amount})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not move reserve money to income")
		return
	}
	created, err := qtx.InsertIncomeTransaction(r.Context(), db.InsertIncomeTransactionParams{UserID: uid, Category: description, Amount: amount, TxnDate: date})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not move reserve money to income")
		return
	}
	if err := qtx.InsertReserveOperationTransaction(r.Context(), db.InsertReserveOperationTransactionParams{ReserveOperationID: operation.ID, TransactionID: created.ID, Role: "funding_income"}); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not move reserve money to income")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not move reserve money to income")
		return
	}
	writeJSON(w, http.StatusCreated, reserveOperationDTO(operation, numericToJSONNumber(entry.Amount), []ReserveEntryDTO{{ID: entry.ID.String(), ReserveID: reserveID.String(), ReserveName: reserve.Name, Direction: entry.Direction, Amount: numericToJSONNumber(entry.Amount)}}))
}

func (s *Server) deleteReserveIncomeTransfer(w http.ResponseWriter, r *http.Request, operation db.ReserveOperation, qtx *db.Queries) {
	entries, err := qtx.ListReserveEntriesForOperation(r.Context(), operation.ID)
	if err != nil || len(entries) != 1 {
		writeErr(w, http.StatusInternalServerError, "could not delete reserve income transfer")
		return
	}
	reserve, err := qtx.GetReserveForUserForUpdate(r.Context(), db.GetReserveForUserForUpdateParams{ID: entries[0].ReserveID, UserID: userID(r)})
	if err != nil {
		writeReserveLookupError(w, err, "could not delete reserve income transfer")
		return
	}
	if reserve.ArchivedAt.Valid {
		writeErr(w, http.StatusConflict, "archived reserve operations cannot be changed")
		return
	}
	links, err := qtx.ListReserveOperationTransactions(r.Context(), db.ListReserveOperationTransactionsParams{ReserveOperationID: operation.ID, UserID: userID(r)})
	if err != nil || len(links) != 1 {
		writeErr(w, http.StatusInternalServerError, "could not delete reserve income transfer")
		return
	}
	if _, err := qtx.DeleteTransactionForUser(r.Context(), db.DeleteTransactionForUserParams{ID: links[0].TransactionID, UserID: userID(r)}); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not delete reserve income transfer")
		return
	}
	if _, err := qtx.DeleteAnyReserveOperation(r.Context(), db.DeleteAnyReserveOperationParams{ID: operation.ID, UserID: userID(r)}); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not delete reserve income transfer")
		return
	}
}
