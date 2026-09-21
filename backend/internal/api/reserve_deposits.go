package api

import (
	"errors"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ledger/backend/internal/db"
	"github.com/ledger/backend/internal/money"
)

const maxReserveDescriptionRunes = 200

type reserveAllocationInput struct {
	ReserveID string       `json:"reserve_id"`
	Amount    money.Number `json:"amount"`
}

type reserveDepositInput struct {
	Description string                   `json:"description"`
	Date        string                   `json:"date"`
	Note        string                   `json:"note"`
	Allocations []reserveAllocationInput `json:"allocations"`
}

type ReserveEntryDTO struct {
	ID          string       `json:"id"`
	ReserveID   string       `json:"reserve_id"`
	ReserveName string       `json:"reserve_name"`
	Direction   string       `json:"direction"`
	Amount      money.Number `json:"amount"`
}

type ReserveOperationDTO struct {
	ID            string            `json:"id"`
	OperationType string            `json:"operation_type"`
	Date          string            `json:"date"`
	Description   string            `json:"description"`
	Note          string            `json:"note"`
	Total         money.Number      `json:"total"`
	Entries       []ReserveEntryDTO `json:"entries"`
	CreatedAt     string            `json:"created_at"`
	UpdatedAt     string            `json:"updated_at"`
	Editable      bool              `json:"editable"`
	Deletable     bool              `json:"deletable"`
}

type parsedReserveAllocation struct {
	reserveID uuid.UUID
	amount    pgtype.Numeric
}

func parseReserveDeposit(in reserveDepositInput) (string, pgtype.Date, []parsedReserveAllocation, error) {
	description := strings.TrimSpace(in.Description)
	if description == "" {
		return "", pgtype.Date{}, nil, errors.New("description is required")
	}
	if utf8.RuneCountInString(description) > maxReserveDescriptionRunes {
		return "", pgtype.Date{}, nil, errors.New("description must be 200 characters or fewer")
	}
	occurredOn, err := parseDate(in.Date)
	if err != nil {
		return "", pgtype.Date{}, nil, errors.New("date must be a valid YYYY-MM-DD date")
	}
	if len(in.Allocations) == 0 {
		return "", pgtype.Date{}, nil, errors.New("at least one allocation is required")
	}
	if len(in.Allocations) > maxActiveReserves {
		return "", pgtype.Date{}, nil, errors.New("a deposit can have at most 5 allocations")
	}

	seen := make(map[uuid.UUID]struct{}, len(in.Allocations))
	parsed := make([]parsedReserveAllocation, 0, len(in.Allocations))
	for _, allocation := range in.Allocations {
		reserveID, err := uuid.Parse(allocation.ReserveID)
		if err != nil {
			return "", pgtype.Date{}, nil, errors.New("allocation reserve_id must be a valid UUID")
		}
		if _, exists := seen[reserveID]; exists {
			return "", pgtype.Date{}, nil, errors.New("each reserve may be allocated only once")
		}
		seen[reserveID] = struct{}{}
		amount, err := decimalToNumeric(allocation.Amount)
		if err != nil {
			return "", pgtype.Date{}, nil, err
		}
		if amount.Int == nil || amount.Int.Sign() <= 0 {
			return "", pgtype.Date{}, nil, errors.New("allocation amount must be greater than zero")
		}
		parsed = append(parsed, parsedReserveAllocation{reserveID: reserveID, amount: amount})
	}
	return description, occurredOn, parsed, nil
}

func (s *Server) handleCreateReserveDeposit(w http.ResponseWriter, r *http.Request) {
	var body reserveDepositInput
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	description, occurredOn, allocations, err := parseReserveDeposit(body)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	reserveIDs := make([]uuid.UUID, len(allocations))
	for i, allocation := range allocations {
		reserveIDs[i] = allocation.reserveID
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create reserve deposit")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := s.q.WithTx(tx)
	locked, err := qtx.LockAffectedReserves(r.Context(), db.LockAffectedReservesParams{UserID: userID(r), ReserveIds: reserveIDs})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create reserve deposit")
		return
	}
	if len(locked) != len(allocations) {
		writeErr(w, http.StatusNotFound, "reserve not found")
		return
	}
	reserveNames := make(map[uuid.UUID]string, len(locked))
	for _, reserve := range locked {
		if reserve.ArchivedAt.Valid {
			writeErr(w, http.StatusConflict, "archived reserves cannot receive allocations")
			return
		}
		reserveNames[reserve.ID] = reserve.Name
	}

	operation, err := qtx.InsertReserveOperation(r.Context(), db.InsertReserveOperationParams{
		UserID: userID(r), OperationType: "deposit", OccurredOn: occurredOn,
		Description: description, Note: strings.TrimSpace(body.Note),
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create reserve deposit")
		return
	}
	entries := make([]ReserveEntryDTO, 0, len(allocations))
	totalCents := new(big.Int)
	for _, allocation := range allocations {
		entry, err := qtx.InsertReserveEntry(r.Context(), db.InsertReserveEntryParams{
			OperationID: operation.ID, ReserveID: allocation.reserveID, Direction: "deposit", Amount: allocation.amount,
		})
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not create reserve deposit")
			return
		}
		totalCents.Add(totalCents, numericCents(entry.Amount))
		entries = append(entries, ReserveEntryDTO{
			ID: entry.ID.String(), ReserveID: entry.ReserveID.String(), ReserveName: reserveNames[entry.ReserveID],
			Direction: entry.Direction, Amount: numericToJSONNumber(entry.Amount),
		})
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create reserve deposit")
		return
	}
	writeJSON(w, http.StatusCreated, reserveOperationDTO(operation, centsToJSONNumber(totalCents), entries))
}

func (s *Server) handleListReserveOperations(w http.ResponseWriter, r *http.Request) {
	year := s.now().Year()
	if raw := r.URL.Query().Get("year"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || len(raw) != 4 || parsed < 1 || parsed >= 9999 {
			writeErr(w, http.StatusBadRequest, "year must be YYYY")
			return
		}
		year = parsed
	}
	reserveFilter := r.URL.Query().Get("reserve_id")
	if reserveFilter != "" {
		if _, err := uuid.Parse(reserveFilter); err != nil {
			writeErr(w, http.StatusBadRequest, "reserve_id must be a valid UUID")
			return
		}
	}
	from := pgtype.Date{Time: time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC), Valid: true}
	to := pgtype.Date{Time: time.Date(year+1, 1, 1, 0, 0, 0, 0, time.UTC), Valid: true}
	rows, err := s.q.ListReserveOperationHistory(r.Context(), db.ListReserveOperationHistoryParams{UserID: userID(r), FromDate: from, ToDate: to, ReserveID: reserveFilter})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load reserve operations")
		return
	}
	writeJSON(w, http.StatusOK, depositOperationDTOs(rows))
}

func depositOperationDTOs(rows []db.ListReserveOperationHistoryRow) []ReserveOperationDTO {
	operations := make([]ReserveOperationDTO, 0)
	indices := make(map[uuid.UUID]int)
	totals := make(map[uuid.UUID]*big.Int)
	actionable := make(map[uuid.UUID]bool)
	for _, row := range rows {
		index, exists := indices[row.ID]
		if !exists {
			index = len(operations)
			indices[row.ID] = index
			totals[row.ID] = new(big.Int)
			operations = append(operations, ReserveOperationDTO{
				ID: row.ID.String(), OperationType: row.OperationType, Date: dateToString(row.OccurredOn),
				Description: row.Description, Note: row.Note, Entries: make([]ReserveEntryDTO, 0),
				CreatedAt: row.CreatedAt.Time.Format(time.RFC3339Nano), UpdatedAt: row.UpdatedAt.Time.Format(time.RFC3339Nano),
				Editable: (row.OperationType == "deposit" || row.OperationType == "reserve_spend") && row.ActionEligible, Deletable: (row.OperationType == "deposit" || row.OperationType == "reserve_spend" || row.OperationType == "transfer" || row.OperationType == "move_to_income" || row.OperationType == "funded_expense") && row.ActionEligible,
			})
		}
		if _, exists := actionable[row.ID]; !exists {
			actionable[row.ID] = true
		}
		actionable[row.ID] = actionable[row.ID] && row.ActionEligible
		if row.OperationType != "transfer" || row.Direction == "withdrawal" {
			totals[row.ID].Add(totals[row.ID], numericCents(row.Amount))
		}
		operations[index].Entries = append(operations[index].Entries, ReserveEntryDTO{
			ID: row.EntryID.String(), ReserveID: row.ReserveID.String(), ReserveName: row.ReserveName,
			Direction: row.Direction, Amount: numericToJSONNumber(row.Amount),
		})
	}
	for id, index := range indices {
		operations[index].Total = centsToJSONNumber(totals[id])
		operations[index].Editable = (operations[index].OperationType == "deposit" || operations[index].OperationType == "reserve_spend") && actionable[id]
		operations[index].Deletable = (operations[index].OperationType == "deposit" || operations[index].OperationType == "reserve_spend" || operations[index].OperationType == "transfer" || operations[index].OperationType == "move_to_income" || operations[index].OperationType == "funded_expense") && actionable[id]
	}
	return operations
}

func reserveOperationDTO(operation db.ReserveOperation, total money.Number, entries []ReserveEntryDTO) ReserveOperationDTO {
	return ReserveOperationDTO{
		ID: operation.ID.String(), OperationType: operation.OperationType, Date: dateToString(operation.OccurredOn),
		Description: operation.Description, Note: operation.Note, Total: total, Entries: entries,
		CreatedAt: operation.CreatedAt.Time.Format(time.RFC3339Nano), UpdatedAt: operation.UpdatedAt.Time.Format(time.RFC3339Nano),
		Editable: operation.OperationType == "deposit" || operation.OperationType == "reserve_spend", Deletable: operation.OperationType == "deposit" || operation.OperationType == "reserve_spend" || operation.OperationType == "transfer" || operation.OperationType == "move_to_income" || operation.OperationType == "funded_expense",
	}
}

func numericCents(number pgtype.Numeric) *big.Int {
	cents := new(big.Int).Set(number.Int)
	power := int(number.Exp) + 2
	if power > 0 {
		cents.Mul(cents, new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(power)), nil))
	} else if power < 0 {
		cents.Quo(cents, new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(-power)), nil))
	}
	return cents
}

func centsToJSONNumber(cents *big.Int) money.Number {
	sign := ""
	absolute := new(big.Int).Set(cents)
	if absolute.Sign() < 0 {
		sign = "-"
		absolute.Abs(absolute)
	}
	quotient, remainder := new(big.Int), new(big.Int)
	quotient.QuoRem(absolute, big.NewInt(100), remainder)
	if remainder.Sign() == 0 {
		return money.Number(sign + quotient.String())
	}
	return money.Number(sign + quotient.String() + "." + leftPadTwo(remainder.String()))
}

func leftPadTwo(value string) string {
	if len(value) == 1 {
		return "0" + value
	}
	return value
}
