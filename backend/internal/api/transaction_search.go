package api

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/ledger/backend/internal/db"
)

const invalidSearchCursor = "cursor is invalid or belongs to a different search"

var searchAmountRE = regexp.MustCompile(`^-?[0-9]{1,12}(\.[0-9]{1,2})?$`)

type transactionSearchResponse struct {
	Items      []TransactionDTO `json:"items"`
	NextCursor *string          `json:"next_cursor"`
	HasMore    bool             `json:"has_more"`
}

type transactionSearchCursor struct {
	Version int       `json:"v"`
	Binding string    `json:"b"`
	Tier    int32     `json:"t"`
	Score   int32     `json:"s"`
	Date    string    `json:"d"`
	ID      uuid.UUID `json:"id"`
}

// Limit is intentionally excluded: callers can change page size mid-search.
func transactionSearchBinding(uid uuid.UUID, values url.Values) string {
	selected := url.Values{}
	for _, key := range []string{"q", "section", "kind", "from", "to", "min_amount", "max_amount"} {
		selected.Set(key, strings.TrimSpace(values.Get(key)))
	}
	// Preserve existing relevance cursors, including explicit default selection.
	if sort := strings.TrimSpace(values.Get("sort")); sort != "" && sort != "relevance" {
		selected.Set("sort", sort)
	}
	sum := sha256.Sum256([]byte(uid.String() + "|" + selected.Encode()))
	return hex.EncodeToString(sum[:])
}

func encodeTransactionSearchCursor(c transactionSearchCursor, secret string) string {
	payload, _ := json.Marshal(c)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	return base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func decodeTransactionSearchCursor(raw, binding, secret string) (transactionSearchCursor, error) {
	var c transactionSearchCursor
	fail := errors.New(invalidSearchCursor)
	if len(raw) > 1024 {
		return c, fail
	}
	parts := strings.Split(raw, ".")
	if len(parts) != 2 {
		return c, fail
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return c, fail
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return c, fail
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return c, fail
	}
	if json.Unmarshal(payload, &c) != nil || c.Version != 1 || c.Binding != binding || c.Tier < 0 || c.Tier > 3 || c.Score < 0 || c.Score > 1000000 || c.ID == uuid.Nil {
		return c, fail
	}
	if _, err := parseDate(c.Date); err != nil {
		return c, fail
	}
	return c, nil
}

func parseTransactionSearchParams(values url.Values) (db.SearchTransactionsParams, int, error) {
	p := db.SearchTransactionsParams{Search: strings.TrimSpace(values.Get("q"))}
	fail := func(message string) (db.SearchTransactionsParams, int, error) { return p, 0, errors.New(message) }
	if !utf8.ValidString(p.Search) || strings.ContainsRune(p.Search, 0) || normalizedSearchRuneCount(p.Search) == 0 || utf8.RuneCountInString(p.Search) > 100 {
		return fail("q must contain between 1 and 100 characters")
	}
	p.SortMode = strings.TrimSpace(values.Get("sort"))
	if p.SortMode == "" {
		p.SortMode = "relevance"
	}
	switch p.SortMode {
	case "relevance", "date_asc", "date_desc":
	default:
		return fail("sort must be relevance, date_asc, or date_desc")
	}
	limit := 20
	if raw := values.Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 100 {
			return fail("limit must be an integer between 1 and 100")
		}
		limit = n
	}
	if raw := strings.TrimSpace(values.Get("section")); raw != "" {
		if !validSection(raw) {
			return fail(invalidTransactionNameSectionMessage)
		}
		p.Section = &raw
	}
	if raw := strings.TrimSpace(values.Get("kind")); raw != "" {
		if !validKind(raw) {
			return fail("kind must be cash, credit, or settlement")
		}
		p.Kind = &raw
	}
	for _, filter := range []struct {
		key  string
		dest *pgtype.Date
	}{{"from", &p.FromDate}, {"to", &p.ToDate}} {
		if raw := strings.TrimSpace(values.Get(filter.key)); raw != "" {
			d, err := parseDate(raw)
			if err != nil || d.Time.Year() < 1 {
				return fail(filter.key + " must be YYYY-MM-DD")
			}
			*filter.dest = d
		}
	}
	if p.FromDate.Valid && p.ToDate.Valid && p.FromDate.Time.After(p.ToDate.Time) {
		return fail("from must be on or before to")
	}
	for _, filter := range []struct {
		key  string
		dest *pgtype.Numeric
	}{{"min_amount", &p.MinAmount}, {"max_amount", &p.MaxAmount}} {
		if raw := strings.TrimSpace(values.Get(filter.key)); raw != "" {
			if !searchAmountRE.MatchString(raw) {
				return fail(filter.key + " must be a decimal with at most 12 integer digits and 2 decimal places")
			}
			if err := filter.dest.Scan(raw); err != nil {
				return fail("invalid " + filter.key)
			}
		}
	}
	if p.MinAmount.Valid && p.MaxAmount.Valid {
		min, _ := new(big.Rat).SetString(strings.TrimSpace(values.Get("min_amount")))
		max, _ := new(big.Rat).SetString(strings.TrimSpace(values.Get("max_amount")))
		if min.Cmp(max) > 0 {
			return fail("min_amount must be at most max_amount")
		}
	}
	p.ResultLimit = int32(limit + 1)
	return p, limit, nil
}

func (s *Server) handleSearchTransactions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	values := r.URL.Query()
	params, limit, err := parseTransactionSearchParams(values)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	params.UserID = userID(r)
	binding := transactionSearchBinding(params.UserID, values)
	if raw := values.Get("cursor"); raw != "" {
		c, err := decodeTransactionSearchCursor(raw, binding, s.cfg.JWTSecret)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		params.HasCursor = true
		params.CursorTier, params.CursorScore, params.CursorID = c.Tier, c.Score, c.ID
		params.CursorDate, _ = parseDate(c.Date)
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not search transactions")
		return
	}
	defer tx.Rollback(context.Background())
	// Pin fuzzy membership for stable pagination; this setting never leaks to the pool.
	if _, err = tx.Exec(ctx, "SET LOCAL pg_trgm.similarity_threshold = 0.3"); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not search transactions")
		return
	}
	rows, err := s.q.WithTx(tx).SearchTransactions(ctx, params)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not search transactions")
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not search transactions")
		return
	}
	out := transactionSearchResponse{Items: make([]TransactionDTO, 0, limit), HasMore: len(rows) > limit}
	if out.HasMore {
		rows = rows[:limit]
	}
	for _, row := range rows {
		dto := txnToDTO(row.Transaction)
		if row.Transaction.Kind == db.TxnKindCredit {
			dto.Settled = row.Settled
		}
		if row.Transaction.Kind == db.TxnKindSettlement {
			dto.Settles = uuidsToStrings(row.Settles)
		}
		out.Items = append(out.Items, dto)
	}
	if out.HasMore {
		last := rows[len(rows)-1]
		cursor := encodeTransactionSearchCursor(transactionSearchCursor{
			Version: 1, Binding: binding, Tier: last.MatchTier, Score: last.Score,
			Date: dateToString(last.Transaction.TxnDate), ID: last.Transaction.ID,
		}, s.cfg.JWTSecret)
		out.NextCursor = &cursor
	}
	writeJSON(w, http.StatusOK, out)
}
