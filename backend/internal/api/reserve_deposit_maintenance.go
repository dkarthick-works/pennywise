package api

import (
	"bytes"
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/ledger/backend/internal/db"
)

func (s *Server) handleUpdateReserveOperation(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var raw map[string]json.RawMessage
	if err := readJSON(r, &raw); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	operation, err := s.q.GetReserveOperationForUser(r.Context(), db.GetReserveOperationForUserParams{ID: id, UserID: userID(r)})
	if err != nil {
		writeReserveOperationLookupError(w, err, "could not update reserve operation")
		return
	}
	body, err := json.Marshal(raw)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	if operation.OperationType == "reserve_spend" {
		s.handleUpdateReserveSpending(w, r)
		return
	}
	if operation.OperationType == "deposit" {
		var input reserveDepositInput
		if err := json.Unmarshal(body, &input); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid request body")
			return
		}
		s.updateReserveDeposit(w, r, id, input)
		return
	}
	writeErr(w, http.StatusConflict, "operation cannot be edited; delete and recreate it")
}

func (s *Server) updateReserveDeposit(w http.ResponseWriter, r *http.Request, operationID uuid.UUID, input reserveDepositInput) {
	description, date, allocations, err := parseReserveDeposit(input)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	uid := userID(r)
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update reserve deposit")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := s.q.WithTx(tx)
	operation, err := qtx.GetReserveOperationForUserForUpdate(r.Context(), db.GetReserveOperationForUserForUpdateParams{ID: operationID, UserID: uid})
	if err != nil {
		writeReserveOperationLookupError(w, err, "could not update reserve deposit")
		return
	}
	if operation.OperationType != "deposit" {
		writeErr(w, http.StatusConflict, "operation cannot be edited; delete and recreate it")
		return
	}
	oldEntries, err := qtx.ListReserveEntriesForOperation(r.Context(), operationID)
	if err != nil || len(oldEntries) == 0 {
		writeErr(w, http.StatusInternalServerError, "could not update reserve deposit")
		return
	}
	ids := make([]uuid.UUID, 0, len(oldEntries)+len(allocations))
	seen := make(map[uuid.UUID]bool)
	for _, entry := range oldEntries {
		if !seen[entry.ReserveID] {
			ids = append(ids, entry.ReserveID)
			seen[entry.ReserveID] = true
		}
	}
	for _, allocation := range allocations {
		if !seen[allocation.reserveID] {
			ids = append(ids, allocation.reserveID)
			seen[allocation.reserveID] = true
		}
	}
	locked, err := qtx.LockAffectedReserves(r.Context(), db.LockAffectedReservesParams{UserID: uid, ReserveIds: ids})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update reserve deposit")
		return
	}
	if len(locked) != len(ids) {
		writeErr(w, http.StatusNotFound, "reserve not found")
		return
	}
	for _, reserve := range locked {
		if reserve.ArchivedAt.Valid {
			writeErr(w, http.StatusConflict, "archived reserves cannot receive allocations")
			return
		}
	}
	oldByReserve := make(map[uuid.UUID]*big.Int)
	newByReserve := make(map[uuid.UUID]*big.Int)
	for _, entry := range oldEntries {
		oldByReserve[entry.ReserveID] = numericCents(entry.Amount)
	}
	for _, allocation := range allocations {
		newByReserve[allocation.reserveID] = numericCents(allocation.amount)
	}
	for _, reserve := range locked {
		balance, err := qtx.ReserveBalance(r.Context(), reserve.ID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not update reserve deposit")
			return
		}
		oldAmount := oldByReserve[reserve.ID]
		if oldAmount == nil {
			oldAmount = new(big.Int)
		}
		newAmount := newByReserve[reserve.ID]
		if newAmount == nil {
			newAmount = new(big.Int)
		}
		result := new(big.Int).Sub(numericCents(balance), oldAmount)
		result.Add(result, newAmount)
		if result.Sign() < 0 {
			writeErr(w, http.StatusConflict, "deposit edit would overdraw "+reserve.Name)
			return
		}
	}
	updated, err := qtx.UpdateReserveOperation(r.Context(), db.UpdateReserveOperationParams{ID: operationID, UserID: uid, OccurredOn: date, Description: description, Note: strings.TrimSpace(input.Note)})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update reserve deposit")
		return
	}
	if err := qtx.DeleteReserveEntriesForOperation(r.Context(), operationID); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update reserve deposit")
		return
	}
	reserveNames := make(map[uuid.UUID]string, len(locked))
	for _, reserve := range locked {
		reserveNames[reserve.ID] = reserve.Name
	}
	entries := make([]ReserveEntryDTO, 0, len(allocations))
	total := new(big.Int)
	for _, allocation := range allocations {
		entry, err := qtx.InsertReserveEntry(r.Context(), db.InsertReserveEntryParams{OperationID: operationID, ReserveID: allocation.reserveID, Direction: "deposit", Amount: allocation.amount})
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not update reserve deposit")
			return
		}
		total.Add(total, numericCents(entry.Amount))
		entries = append(entries, ReserveEntryDTO{ID: entry.ID.String(), ReserveID: entry.ReserveID.String(), ReserveName: reserveNames[entry.ReserveID], Direction: entry.Direction, Amount: numericToJSONNumber(entry.Amount)})
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update reserve deposit")
		return
	}
	writeJSON(w, http.StatusOK, reserveOperationDTO(updated, centsToJSONNumber(total), entries))
}

func (s *Server) deleteReserveDeposit(w http.ResponseWriter, r *http.Request, operation db.ReserveOperation, qtx *db.Queries) {
	entries, err := qtx.ListReserveEntriesForOperation(r.Context(), operation.ID)
	if err != nil || len(entries) == 0 {
		writeErr(w, http.StatusInternalServerError, "could not delete reserve deposit")
		return
	}
	locked, err := qtx.LockAffectedReserves(r.Context(), db.LockAffectedReservesParams{UserID: userID(r), ReserveIds: reserveIDsFromEntries(entries)})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not delete reserve deposit")
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
			writeErr(w, http.StatusInternalServerError, "could not delete reserve deposit")
			return
		}
		for _, entry := range entries {
			if entry.ReserveID == reserve.ID && numericCents(balance).Cmp(numericCents(entry.Amount)) < 0 {
				writeErr(w, http.StatusConflict, "deposit cannot be deleted because "+reserve.Name+" has already been spent")
				return
			}
		}
	}
	deleted, err := qtx.DeleteAnyReserveOperation(r.Context(), db.DeleteAnyReserveOperationParams{ID: operation.ID, UserID: userID(r)})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not delete reserve deposit")
		return
	}
	if deleted != 1 {
		writeErr(w, http.StatusNotFound, "reserve operation not found")
		return
	}
}

func reserveIDsFromEntries(entries []db.ListReserveEntriesForOperationRow) []uuid.UUID {
	ids := uniqueReserveIDs(entries)
	return ids
}
func uniqueReserveIDs(entries []db.ListReserveEntriesForOperationRow) []uuid.UUID {
	seen := map[uuid.UUID]bool{}
	ids := make([]uuid.UUID, 0, len(entries))
	for _, entry := range entries {
		if !seen[entry.ReserveID] {
			ids = append(ids, entry.ReserveID)
			seen[entry.ReserveID] = true
		}
	}
	return ids
}
