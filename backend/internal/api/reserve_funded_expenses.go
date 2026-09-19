package api

import (
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/ledger/backend/internal/db"
	"github.com/ledger/backend/internal/money"
)

type fundedExpenseInput struct {
	ReserveID string       `json:"reserve_id"`
	Amount    money.Number `json:"amount"`
	Date      string       `json:"date"`
	Section   string       `json:"section"`
	Category  string       `json:"category"`
	Note      string       `json:"note"`
}

func (s *Server) handleCreateFundedExpense(w http.ResponseWriter, r *http.Request) {
	var input fundedExpenseInput
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
	if input.Section != "essential" && input.Section != "flexible" && input.Section != "daily" {
		writeErr(w, http.StatusBadRequest, "section must be essential, flexible, or daily")
		return
	}
	date, err := parseDate(input.Date)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "date must be a valid YYYY-MM-DD date")
		return
	}
	category := strings.TrimSpace(input.Category)
	if category == "" {
		writeErr(w, http.StatusBadRequest, "category is required")
		return
	}
	if utf8.RuneCountInString(category) > maxReserveDescriptionRunes {
		writeErr(w, http.StatusBadRequest, "category must be 200 characters or fewer")
		return
	}
	uid := userID(r)
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create funded expense")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := s.q.WithTx(tx)
	reserve, err := qtx.GetReserveForUserForUpdate(r.Context(), db.GetReserveForUserForUpdateParams{ID: reserveID, UserID: uid})
	if err != nil {
		writeReserveLookupError(w, err, "could not create funded expense")
		return
	}
	if reserve.ArchivedAt.Valid {
		writeErr(w, http.StatusConflict, "archived reserves cannot receive funded expenses")
		return
	}
	balance, err := qtx.ReserveBalance(r.Context(), reserveID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create funded expense")
		return
	}
	if numericCents(balance).Cmp(numericCents(amount)) < 0 {
		writeErr(w, http.StatusConflict, "insufficient balance in "+reserve.Name)
		return
	}
	operation, err := qtx.InsertReserveOperation(r.Context(), db.InsertReserveOperationParams{UserID: uid, OperationType: "funded_expense", OccurredOn: date, Description: category, Note: strings.TrimSpace(input.Note)})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create funded expense")
		return
	}
	withdrawal, err := qtx.InsertReserveEntry(r.Context(), db.InsertReserveEntryParams{OperationID: operation.ID, ReserveID: reserveID, Direction: "withdrawal", Amount: amount})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create funded expense")
		return
	}
	income, err := qtx.InsertIncomeTransaction(r.Context(), db.InsertIncomeTransactionParams{UserID: uid, Category: "From " + reserve.Name + " · " + category, Amount: amount, TxnDate: date})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create funded expense")
		return
	}
	expense, err := qtx.InsertTransaction(r.Context(), db.InsertTransactionParams{UserID: uid, Section: db.Section(input.Section), Category: category, Amount: amount, TxnDate: date, Kind: db.TxnKindCash})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create funded expense")
		return
	}
	if err := qtx.InsertReserveOperationTransaction(r.Context(), db.InsertReserveOperationTransactionParams{ReserveOperationID: operation.ID, TransactionID: income.ID, Role: "funding_income"}); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create funded expense")
		return
	}
	if err := qtx.InsertReserveOperationTransaction(r.Context(), db.InsertReserveOperationTransactionParams{ReserveOperationID: operation.ID, TransactionID: expense.ID, Role: "funded_expense"}); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create funded expense")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create funded expense")
		return
	}
	writeJSON(w, http.StatusCreated, reserveOperationDTO(operation, numericToJSONNumber(amount), []ReserveEntryDTO{{ID: withdrawal.ID.String(), ReserveID: reserveID.String(), ReserveName: reserve.Name, Direction: withdrawal.Direction, Amount: numericToJSONNumber(withdrawal.Amount)}}))
}

func (s *Server) deleteFundedExpense(w http.ResponseWriter, r *http.Request, operation db.ReserveOperation, qtx *db.Queries) {
	entries, err := qtx.ListReserveEntriesForOperation(r.Context(), operation.ID)
	if err != nil || len(entries) != 1 {
		writeErr(w, http.StatusInternalServerError, "could not delete funded expense")
		return
	}
	reserve, err := qtx.GetReserveForUserForUpdate(r.Context(), db.GetReserveForUserForUpdateParams{ID: entries[0].ReserveID, UserID: userID(r)})
	if err != nil {
		writeReserveLookupError(w, err, "could not delete funded expense")
		return
	}
	if reserve.ArchivedAt.Valid {
		writeErr(w, http.StatusConflict, "archived reserve operations cannot be changed")
		return
	}
	links, err := qtx.ListReserveOperationTransactions(r.Context(), db.ListReserveOperationTransactionsParams{ReserveOperationID: operation.ID, UserID: userID(r)})
	if err != nil || len(links) != 2 {
		writeErr(w, http.StatusInternalServerError, "could not delete funded expense")
		return
	}
	for _, link := range links {
		if _, err := qtx.DeleteTransactionForUser(r.Context(), db.DeleteTransactionForUserParams{ID: link.TransactionID, UserID: userID(r)}); err != nil {
			writeErr(w, http.StatusInternalServerError, "could not delete funded expense")
			return
		}
	}
	if _, err := qtx.DeleteAnyReserveOperation(r.Context(), db.DeleteAnyReserveOperationParams{ID: operation.ID, UserID: userID(r)}); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not delete funded expense")
		return
	}
}
