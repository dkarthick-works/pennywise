package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ledger/backend/internal/db"
)

var (
	monthRe = regexp.MustCompile(`^\d{4}-\d{2}$`)
	yearRe  = regexp.MustCompile(`^\d{4}$`)
	dateRe  = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

const noExportRowsMessage = "no transactions to export for the selected date range"

// handleListTransactions returns the rows for ?month=YYYY-MM or ?year=YYYY,
// decorated with settlement links (settles) and the derived "settled" flag.
func (s *Server) handleListTransactions(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	ctx := r.Context()

	var (
		txns    []db.Transaction
		links   []db.SettlementLink
		settled []uuid.UUID
		err     error
	)

	if month := r.URL.Query().Get("month"); month != "" {
		if !monthRe.MatchString(month) {
			writeErr(w, http.StatusBadRequest, "month must be YYYY-MM")
			return
		}
		txns, err = s.q.ListTransactionsByMonth(ctx, db.ListTransactionsByMonthParams{UserID: uid, Month: month})
		if err == nil {
			links, err = s.q.ListSettlementLinksByMonth(ctx, db.ListSettlementLinksByMonthParams{UserID: uid, Month: month})
		}
		if err == nil {
			settled, err = s.q.SettledCreditIdsByMonth(ctx, db.SettledCreditIdsByMonthParams{UserID: uid, Month: month})
		}
	} else if year := r.URL.Query().Get("year"); year != "" {
		if !yearRe.MatchString(year) {
			writeErr(w, http.StatusBadRequest, "year must be YYYY")
			return
		}
		txns, err = s.q.ListTransactionsByYear(ctx, db.ListTransactionsByYearParams{UserID: uid, Year: year})
		if err == nil {
			links, err = s.q.ListSettlementLinksByYear(ctx, db.ListSettlementLinksByYearParams{UserID: uid, Year: year})
		}
		for _, l := range links {
			settled = append(settled, l.CreditID)
		}
	} else {
		writeErr(w, http.StatusBadRequest, "month or year query param required")
		return
	}

	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load transactions")
		return
	}

	// settlement_id -> [credit ids]
	bySettlement := map[uuid.UUID][]string{}
	for _, l := range links {
		bySettlement[l.SettlementID] = append(bySettlement[l.SettlementID], l.CreditID.String())
	}
	settledSet := map[uuid.UUID]bool{}
	for _, id := range settled {
		settledSet[id] = true
	}

	out := make([]TransactionDTO, 0, len(txns))
	for _, t := range txns {
		dto := txnToDTO(t)
		switch t.Kind {
		case db.TxnKindSettlement:
			if ids := bySettlement[t.ID]; ids != nil {
				dto.Settles = ids
			} else {
				dto.Settles = []string{}
			}
		case db.TxnKindCredit:
			dto.Settled = settledSet[t.ID]
		}
		out = append(out, dto)
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleExportTransactions(w http.ResponseWriter, r *http.Request) {
	from, to, err := validateExportRange(r.URL.Query().Get("from"), r.URL.Query().Get("to"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	txns, err := s.q.ListTransactionsByDateRange(r.Context(), db.ListTransactionsByDateRangeParams{
		UserID:   userID(r),
		FromDate: from,
		ToDate:   to,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not export transactions")
		return
	}
	if err := ensureExportTransactions(txns); err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}

	currency := "INR"
	settings, err := s.q.GetSettings(r.Context(), userID(r))
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusInternalServerError, "could not export transactions")
		return
	}
	if err == nil && settings.Currency != "" {
		currency = settings.Currency
	}

	filename := fmt.Sprintf("pennywise-transactions-%s_%s.csv", dateToString(from), dateToString(to))
	if err := writeCSV(w, filename, exportTransactionRows(txns, currency)); err != nil {
		return
	}
}

type txnInput struct {
	Section  string   `json:"section"`
	Category string   `json:"category"`
	Amount   float64  `json:"amount"`
	Date     string   `json:"date"`
	Kind     string   `json:"kind"`
	Settles  []string `json:"settles"`
}

func (s *Server) handleCreateTransaction(w http.ResponseWriter, r *http.Request) {
	var in txnInput
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if !validSection(in.Section) || !validKind(in.Kind) {
		writeErr(w, http.StatusBadRequest, "invalid section or kind")
		return
	}
	d, err := parseDate(in.Date)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "date must be YYYY-MM-DD")
		return
	}

	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create transaction")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := s.q.WithTx(tx)

	created, err := qtx.InsertTransaction(r.Context(), db.InsertTransactionParams{
		UserID: userID(r), Section: db.Section(in.Section), Category: in.Category,
		Amount: floatToNum(in.Amount), TxnDate: d, Kind: db.TxnKind(in.Kind),
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create transaction")
		return
	}
	if in.Kind == "settlement" {
		if err := replaceLinks(r.Context(), qtx, created.ID, in.Settles); err != nil {
			writeErr(w, http.StatusBadRequest, "could not link credits")
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create transaction")
		return
	}

	dto := txnToDTO(created)
	if in.Kind == "settlement" {
		dto.Settles = in.Settles
	}
	writeJSON(w, http.StatusCreated, dto)
}

func (s *Server) handleUpdateTransaction(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var patch struct {
		Section  *string   `json:"section"`
		Category *string   `json:"category"`
		Amount   *float64  `json:"amount"`
		Date     *string   `json:"date"`
		Kind     *string   `json:"kind"`
		Settles  *[]string `json:"settles"`
	}
	if err := readJSON(r, &patch); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	cur, err := s.q.GetTransaction(r.Context(), db.GetTransactionParams{ID: id, UserID: userID(r)})
	if err != nil {
		writeErr(w, http.StatusNotFound, "transaction not found")
		return
	}

	params := db.UpdateTransactionParams{
		ID: id, UserID: userID(r),
		Section: cur.Section, Category: cur.Category, Amount: cur.Amount, TxnDate: cur.TxnDate, Kind: cur.Kind,
	}
	if patch.Section != nil {
		if !validSection(*patch.Section) {
			writeErr(w, http.StatusBadRequest, "invalid section")
			return
		}
		params.Section = db.Section(*patch.Section)
	}
	if patch.Category != nil {
		params.Category = *patch.Category
	}
	if patch.Amount != nil {
		params.Amount = floatToNum(*patch.Amount)
	}
	if patch.Date != nil {
		d, err := parseDate(*patch.Date)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "date must be YYYY-MM-DD")
			return
		}
		params.TxnDate = d
	}
	if patch.Kind != nil {
		if !validKind(*patch.Kind) {
			writeErr(w, http.StatusBadRequest, "invalid kind")
			return
		}
		params.Kind = db.TxnKind(*patch.Kind)
	}

	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update transaction")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := s.q.WithTx(tx)

	updated, err := qtx.UpdateTransaction(r.Context(), params)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update transaction")
		return
	}

	// Reconcile settlement links: a row that is no longer a settlement loses all
	// links; otherwise apply the provided set when present.
	if updated.Kind != db.TxnKindSettlement {
		if err := qtx.DeleteSettlementLinks(r.Context(), updated.ID); err != nil {
			writeErr(w, http.StatusInternalServerError, "could not update links")
			return
		}
	} else if patch.Settles != nil {
		if err := replaceLinks(r.Context(), qtx, updated.ID, *patch.Settles); err != nil {
			writeErr(w, http.StatusBadRequest, "could not link credits")
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update transaction")
		return
	}

	dto := txnToDTO(updated)
	if updated.Kind == db.TxnKindSettlement {
		ids, _ := s.q.ListLinksForSettlement(r.Context(), updated.ID)
		dto.Settles = uuidsToStrings(ids)
	}
	writeJSON(w, http.StatusOK, dto)
}

func (s *Server) handleDeleteTransaction(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := s.q.DeleteTransaction(r.Context(), db.DeleteTransactionParams{ID: id, UserID: userID(r)}); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not delete transaction")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleOpenCredits(w http.ResponseWriter, r *http.Request) {
	section := chi.URLParam(r, "section")
	if !validSection(section) {
		writeErr(w, http.StatusBadRequest, "invalid section")
		return
	}
	exclude := uuid.Nil
	if ex := r.URL.Query().Get("exclude"); ex != "" {
		if id, err := uuid.Parse(ex); err == nil {
			exclude = id
		}
	}
	rows, err := s.q.OpenCreditsForSection(r.Context(), db.OpenCreditsForSectionParams{
		UserID: userID(r), Section: db.Section(section), ExcludeSettlement: exclude,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load open credits")
		return
	}
	out := make([]TransactionDTO, 0, len(rows))
	for _, t := range rows {
		out = append(out, txnToDTO(t))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleDailySuggestions(w http.ResponseWriter, r *http.Request) {
	cats, err := s.q.DailyCategorySuggestions(r.Context(), userID(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load suggestions")
		return
	}
	if cats == nil {
		cats = []string{}
	}
	writeJSON(w, http.StatusOK, cats)
}

func (s *Server) handleIncomeSuggestions(w http.ResponseWriter, r *http.Request) {
	cats, err := s.q.IncomeCategorySuggestions(r.Context(), userID(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load suggestions")
		return
	}
	if cats == nil {
		cats = []string{}
	}
	writeJSON(w, http.StatusOK, cats)
}

// ---- helpers --------------------------------------------------------------

func replaceLinks(ctx context.Context, q *db.Queries, settlementID uuid.UUID, creditIDs []string) error {
	if err := q.DeleteSettlementLinks(ctx, settlementID); err != nil {
		return err
	}
	for _, raw := range creditIDs {
		cid, err := uuid.Parse(raw)
		if err != nil {
			return err
		}
		if err := q.InsertSettlementLink(ctx, db.InsertSettlementLinkParams{SettlementID: settlementID, CreditID: cid}); err != nil {
			return err
		}
	}
	return nil
}

func uuidsToStrings(ids []uuid.UUID) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		out = append(out, id.String())
	}
	return out
}

func validSection(s string) bool {
	return s == "essential" || s == "flexible" || s == "daily" || s == "income"
}

func validKind(k string) bool {
	return k == "cash" || k == "credit" || k == "settlement"
}

func validateExportRange(fromRaw, toRaw string) (pgFrom pgtype.Date, pgTo pgtype.Date, err error) {
	if !dateRe.MatchString(fromRaw) || !dateRe.MatchString(toRaw) {
		return pgtype.Date{}, pgtype.Date{}, errors.New("from and to must be YYYY-MM-DD")
	}
	from, err := parseDate(fromRaw)
	if err != nil {
		return pgtype.Date{}, pgtype.Date{}, errors.New("from and to must be valid dates")
	}
	to, err := parseDate(toRaw)
	if err != nil {
		return pgtype.Date{}, pgtype.Date{}, errors.New("from and to must be valid dates")
	}
	if from.Time.After(to.Time) {
		return pgtype.Date{}, pgtype.Date{}, errors.New("from date must be before or equal to to date")
	}
	if inclusiveMonthSpan(from.Time, to.Time) > 6 {
		return pgtype.Date{}, pgtype.Date{}, errors.New("date range must not exceed 6 months")
	}
	return from, to, nil
}

func inclusiveMonthSpan(from, to time.Time) int {
	return (to.Year()-from.Year())*12 + int(to.Month()-from.Month()) + 1
}

func ensureExportTransactions(txns []db.Transaction) error {
	for _, t := range txns {
		if t.Kind != db.TxnKindSettlement {
			return nil
		}
	}
	return errors.New(noExportRowsMessage)
}

func exportTransactionRows(txns []db.Transaction, currency string) [][]string {
	rows := [][]string{{"id", "date", "section", "category", "amount", "currency", "kind"}}
	for _, t := range txns {
		if t.Kind == db.TxnKindSettlement {
			continue
		}
		rows = append(rows, []string{
			t.ID.String(),
			dateToString(t.TxnDate),
			string(t.Section),
			t.Category,
			fmt.Sprintf("%.2f", numToFloat(t.Amount)),
			currency,
			string(t.Kind),
		})
	}
	return rows
}
