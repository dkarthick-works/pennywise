package api

import (
	"errors"
	"math/big"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ledger/backend/internal/db"
)

type conversionInput struct {
	Allocations []reserveAllocationInput `json:"allocations"`
}

func (s *Server) handleConvertIncomeToReserves(w http.ResponseWriter, r *http.Request) {
	txnID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var input conversionInput
	if err := readJSON(r, &input); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(input.Allocations) == 0 {
		writeErr(w, http.StatusBadRequest, "at least one allocation is required")
		return
	}
	uid := userID(r)
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not convert income")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := s.q.WithTx(tx)
	source, err := qtx.GetIncomeTransactionForConversion(r.Context(), db.GetIncomeTransactionForConversionParams{ID: txnID, UserID: uid})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "eligible income transaction not found")
		} else {
			writeErr(w, http.StatusInternalServerError, "could not convert income")
		}
		return
	}
	if strings.TrimSpace(source.Category) == "" {
		writeErr(w, http.StatusConflict, "income transaction has no description")
		return
	}
	allocations, err := parseConversionAllocations(input.Allocations)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if totalNumericCents(allocations).Cmp(numericCents(source.Amount)) != 0 {
		writeErr(w, http.StatusBadRequest, "allocation total must equal the income amount")
		return
	}
	ids := make([]uuid.UUID, len(allocations))
	for i, a := range allocations {
		ids[i] = a.reserveID
	}
	locked, err := qtx.LockAffectedReserves(r.Context(), db.LockAffectedReservesParams{UserID: uid, ReserveIds: ids})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not convert income")
		return
	}
	if len(locked) != len(allocations) {
		writeErr(w, http.StatusNotFound, "reserve not found")
		return
	}
	for _, reserve := range locked {
		if reserve.ArchivedAt.Valid {
			writeErr(w, http.StatusConflict, "archived reserves cannot receive allocations")
			return
		}
	}
	operation, err := qtx.InsertReserveOperation(r.Context(), db.InsertReserveOperationParams{UserID: uid, OperationType: "deposit", OccurredOn: source.TxnDate, Description: source.Category, Note: ""})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not convert income")
		return
	}
	reserveNames := make(map[uuid.UUID]string, len(locked))
	for _, reserve := range locked {
		reserveNames[reserve.ID] = reserve.Name
	}
	entries := make([]ReserveEntryDTO, 0, len(allocations))
	for _, allocation := range allocations {
		entry, err := qtx.InsertReserveEntry(r.Context(), db.InsertReserveEntryParams{OperationID: operation.ID, ReserveID: allocation.reserveID, Direction: "deposit", Amount: allocation.amount})
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not convert income")
			return
		}
		entries = append(entries, ReserveEntryDTO{ID: entry.ID.String(), ReserveID: entry.ReserveID.String(), ReserveName: reserveNames[entry.ReserveID], Direction: entry.Direction, Amount: numericToJSONNumber(entry.Amount)})
	}
	if _, err := qtx.DeleteTransactionForUser(r.Context(), db.DeleteTransactionForUserParams{ID: txnID, UserID: uid}); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not convert income")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not convert income")
		return
	}
	writeJSON(w, http.StatusCreated, reserveOperationDTO(operation, numericToJSONNumber(source.Amount), entries))
}

func parseConversionAllocations(inputs []reserveAllocationInput) ([]parsedReserveAllocation, error) {
	seen := map[uuid.UUID]bool{}
	out := make([]parsedReserveAllocation, 0, len(inputs))
	for _, input := range inputs {
		id, err := uuid.Parse(input.ReserveID)
		if err != nil {
			return nil, errors.New("allocation reserve_id must be a valid UUID")
		}
		if seen[id] {
			return nil, errors.New("each reserve may be allocated only once")
		}
		seen[id] = true
		amount, err := decimalToNumeric(input.Amount)
		if err != nil {
			return nil, err
		}
		if amount.Int == nil || amount.Int.Sign() <= 0 {
			return nil, errors.New("allocation amount must be greater than zero")
		}
		out = append(out, parsedReserveAllocation{reserveID: id, amount: amount})
	}
	return out, nil
}

func totalNumericCents(allocations []parsedReserveAllocation) *big.Int {
	total := new(big.Int)
	for _, allocation := range allocations {
		total.Add(total, numericCents(allocation.amount))
	}
	return total
}

func (s *Server) handleConvertReserveDepositToIncome(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	uid := userID(r)
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not convert reserve deposit")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := s.q.WithTx(tx)
	operation, err := qtx.GetReserveOperationForUserForUpdate(r.Context(), db.GetReserveOperationForUserForUpdateParams{ID: id, UserID: uid})
	if err != nil {
		writeReserveOperationLookupError(w, err, "could not convert reserve deposit")
		return
	}
	if operation.OperationType != "deposit" {
		writeErr(w, http.StatusConflict, "only reserve deposits can be converted to income")
		return
	}
	entries, err := qtx.ListReserveEntriesForOperation(r.Context(), id)
	if err != nil || len(entries) == 0 {
		writeErr(w, http.StatusInternalServerError, "could not convert reserve deposit")
		return
	}
	locked, err := qtx.LockAffectedReserves(r.Context(), db.LockAffectedReservesParams{UserID: uid, ReserveIds: uniqueReserveIDs(entries)})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not convert reserve deposit")
		return
	}
	if len(locked) != len(uniqueReserveIDs(entries)) {
		writeErr(w, http.StatusNotFound, "reserve not found")
		return
	}
	for _, reserve := range locked {
		if reserve.ArchivedAt.Valid {
			writeErr(w, http.StatusConflict, "archived reserve operations cannot be changed")
			return
		}
		balance, err := qtx.ReserveBalance(r.Context(), reserve.ID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not convert reserve deposit")
			return
		}
		for _, entry := range entries {
			if entry.ReserveID == reserve.ID && numericCents(balance).Cmp(numericCents(entry.Amount)) < 0 {
				writeErr(w, http.StatusConflict, "deposit cannot be converted because an allocation has already been spent")
				return
			}
		}
	}
	total := new(big.Int)
	for _, entry := range entries {
		total.Add(total, numericCents(entry.Amount))
	}
	amount := centsToNumeric(total)
	created, err := qtx.InsertIncomeTransaction(r.Context(), db.InsertIncomeTransactionParams{UserID: uid, Category: operation.Description, Amount: amount, TxnDate: operation.OccurredOn})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not convert reserve deposit")
		return
	}
	if _, err := qtx.DeleteAnyReserveOperation(r.Context(), db.DeleteAnyReserveOperationParams{ID: id, UserID: uid}); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not convert reserve deposit")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not convert reserve deposit")
		return
	}
	writeJSON(w, http.StatusCreated, txnToDTO(created))
}

func centsToNumeric(cents *big.Int) pgtype.Numeric {
	abs := new(big.Int).Set(cents)
	sign := int32(1)
	if abs.Sign() < 0 {
		sign = -1
		abs.Abs(abs)
	}
	return pgtype.Numeric{Int: new(big.Int).Mul(abs, big.NewInt(int64(sign))), Exp: -2, Valid: true}
}
