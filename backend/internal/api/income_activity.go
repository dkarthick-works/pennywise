package api

import (
	"net/http"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ledger/backend/internal/db"
	"github.com/ledger/backend/internal/money"
)

type IncomeActivityItemDTO struct {
	Source             string            `json:"source"`
	Nature             string            `json:"nature"`
	CountsAsIncome     bool              `json:"counts_as_income"`
	TransactionID      *string           `json:"transaction_id"`
	ReserveOperationID *string           `json:"reserve_operation_id"`
	Description        string            `json:"description"`
	Amount             money.Number      `json:"amount"`
	Date               string            `json:"date"`
	ReserveName        *string           `json:"reserve_name"`
	Allocations        []ReserveEntryDTO `json:"allocations"`
	CreatedAt          string            `json:"created_at"`
	sortID             string
}

func (s *Server) handleIncomeActivity(w http.ResponseWriter, r *http.Request) {
	month := r.URL.Query().Get("month")
	parsedMonth, err := time.Parse("2006-01", month)
	if err != nil || !monthRe.MatchString(month) {
		writeErr(w, http.StatusBadRequest, "month must be YYYY-MM")
		return
	}
	from := pgtype.Date{Time: parsedMonth, Valid: true}
	to := pgtype.Date{Time: parsedMonth.AddDate(0, 1, 0), Valid: true}
	uid := userID(r)

	transactionRows, err := s.q.ListIncomeActivityTransactions(r.Context(), db.ListIncomeActivityTransactionsParams{
		UserID: uid, FromDate: from, ToDate: to,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load income activity")
		return
	}
	depositRows, err := s.q.ListDepositOperationHistory(r.Context(), db.ListDepositOperationHistoryParams{
		UserID: uid, FromDate: from, ToDate: to, ReserveID: "",
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load income activity")
		return
	}

	items := make([]IncomeActivityItemDTO, 0, len(transactionRows)+len(depositRows))
	for _, row := range transactionRows {
		transactionID := row.ID.String()
		item := IncomeActivityItemDTO{
			Source: "normal_transaction", Nature: "normal_income", CountsAsIncome: true,
			TransactionID: &transactionID, Description: row.Category, Amount: numericToJSONNumber(row.Amount),
			Date: dateToString(row.TxnDate), Allocations: make([]ReserveEntryDTO, 0),
			CreatedAt: row.CreatedAt.Time.Format(time.RFC3339Nano), sortID: transactionID,
		}
		if row.ReserveOperationID != "" {
			operationID := row.ReserveOperationID
			item.Nature = "from_reserve"
			item.ReserveOperationID = &operationID
			if row.ReserveName != "" {
				reserveName := row.ReserveName
				item.ReserveName = &reserveName
			}
		}
		items = append(items, item)
	}
	for _, operation := range depositOperationDTOs(depositRows) {
		operationID := operation.ID
		items = append(items, IncomeActivityItemDTO{
			Source: "reserve_deposit", Nature: "sent_to_reserves", CountsAsIncome: false,
			ReserveOperationID: &operationID, Description: operation.Description, Amount: operation.Total,
			Date: operation.Date, Allocations: operation.Entries, CreatedAt: operation.CreatedAt, sortID: operation.ID,
		})
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].Date != items[j].Date {
			return items[i].Date > items[j].Date
		}
		return items[i].sortID > items[j].sortID
	})
	writeJSON(w, http.StatusOK, items)
}
