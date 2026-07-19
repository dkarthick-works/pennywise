package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/ledger/backend/internal/db"
)

// creditThresholdMax is the largest value representable by NUMERIC(14,2).
var creditThresholdMax, _ = new(big.Rat).SetString("999999999999.99")

// plainDecimalRe matches a non-negative JSON number literal without exponent
// notation. It deliberately rejects "+1", ".5", "1.", "1e3", quoted strings,
// and booleans so the threshold contract stays lexical and exact.
var plainDecimalRe = regexp.MustCompile(`^[0-9]+(\.[0-9]+)?$`)

func (s *Server) loadTemplates(r *http.Request) (TemplatesDTO, error) {
	rows, err := s.q.ListTemplates(r.Context(), userID(r))
	if err != nil {
		return TemplatesDTO{}, err
	}
	tpl := TemplatesDTO{Essential: []string{}, Flexible: []string{}}
	for _, t := range rows {
		switch t.Section {
		case db.SectionEssential:
			tpl.Essential = append(tpl.Essential, t.Label)
		case db.SectionFlexible:
			tpl.Flexible = append(tpl.Flexible, t.Label)
		}
	}
	return tpl, nil
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	st, err := s.q.GetSettings(r.Context(), userID(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load settings")
		return
	}
	tpl, err := s.loadTemplates(r)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load templates")
		return
	}
	writeJSON(w, http.StatusOK, settingsToDTO(st, tpl))
}

func (s *Server) handleUpdateBudgets(w http.ResponseWriter, r *http.Request) {
	var body BudgetsDTO
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := s.q.UpdateBudgets(r.Context(), db.UpdateBudgetsParams{
		UserID:          userID(r),
		BudgetEssential: floatToNum(body.Essential),
		BudgetFlexible:  floatToNum(body.Flexible),
		BudgetDaily:     floatToNum(body.Daily),
	}); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update budgets")
		return
	}
	s.handleGetSettings(w, r)
}

func (s *Server) handleUpdatePreferences(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Currency string `json:"currency"`
		Theme    string `json:"theme"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := s.q.UpdatePreferences(r.Context(), db.UpdatePreferencesParams{
		UserID:   userID(r),
		Currency: body.Currency,
		Theme:    body.Theme,
	}); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update preferences")
		return
	}
	s.handleGetSettings(w, r)
}

// handleUpdateCreditStatementDay sets or clears the credit card statement
// closing day. It is deliberately separate from preferences so a currency/theme
// save can never disturb the cycle, and vice versa.
//
// The property must be present. An explicit JSON null clears the cycle; an
// integer 1..31 sets it. Decimals, strings, and out-of-range values are 400s.
//
// A non-pointer json.RawMessage is used (not *json.RawMessage) so a missing
// property (len 0) is reliably distinguishable from an explicit null ("null") —
// a *json.RawMessage decodes both to nil.
func (s *Server) handleUpdateCreditStatementDay(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CreditStatementDay json.RawMessage `json:"credit_statement_day"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(body.CreditStatementDay) == 0 {
		writeErr(w, http.StatusBadRequest, "credit_statement_day is required")
		return
	}

	raw := bytes.TrimSpace(body.CreditStatementDay)
	var day *int16
	if !bytes.Equal(raw, []byte("null")) {
		var n int
		if err := json.Unmarshal(raw, &n); err != nil {
			writeErr(w, http.StatusBadRequest, "credit_statement_day must be an integer 1..31 or null")
			return
		}
		if n < 1 || n > 31 {
			writeErr(w, http.StatusBadRequest, "credit_statement_day must be between 1 and 31")
			return
		}
		v := int16(n)
		day = &v
	}

	if _, err := s.q.UpdateCreditStatementDay(r.Context(), db.UpdateCreditStatementDayParams{
		UserID:             userID(r),
		CreditStatementDay: day,
	}); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update credit statement day")
		return
	}
	s.handleGetSettings(w, r)
}

// handleUpdateCreditSpendingThreshold sets or clears the per-period credit
// spending threshold. Dedicated so an unrelated settings save never disturbs it.
//
// The property must be present. An explicit JSON null clears the threshold; a
// positive decimal with at most two fractional digits sets it. Zero, negatives,
// exponent notation, more than two decimals, non-numbers, and values above the
// NUMERIC(14,2) maximum are all 400s — validated before touching PostgreSQL so a
// bad value never becomes a 500.
//
// A non-pointer json.RawMessage is used (not *json.RawMessage) so a missing
// property (len 0) is distinguishable from an explicit null ("null").
func (s *Server) handleUpdateCreditSpendingThreshold(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CreditSpendingThreshold json.RawMessage `json:"credit_spending_threshold"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(body.CreditSpendingThreshold) == 0 {
		writeErr(w, http.StatusBadRequest, "credit_spending_threshold is required")
		return
	}

	raw := bytes.TrimSpace(body.CreditSpendingThreshold)

	var threshold pgtype.Numeric // zero value: Valid=false → NULL (clear)
	if !bytes.Equal(raw, []byte("null")) {
		num, err := parseCreditThreshold(raw)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		threshold = num
	}

	if _, err := s.q.UpdateCreditSpendingThreshold(r.Context(), db.UpdateCreditSpendingThresholdParams{
		UserID:                  userID(r),
		CreditSpendingThreshold: threshold,
	}); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update credit spending threshold")
		return
	}
	s.handleGetSettings(w, r)
}

// parseCreditThreshold validates a raw JSON number token as a positive rupee
// amount with at most two decimal places and no exponent, then scans the exact
// decimal string into a pgtype.Numeric without ever routing through float64.
func parseCreditThreshold(raw []byte) (pgtype.Numeric, error) {
	const msg = "credit_spending_threshold must be a positive number with at most two decimal places or null"
	str := string(raw)
	if !plainDecimalRe.MatchString(str) {
		return pgtype.Numeric{}, errors.New(msg)
	}
	if dot := strings.IndexByte(str, '.'); dot >= 0 && len(str)-dot-1 > 2 {
		return pgtype.Numeric{}, errors.New("credit_spending_threshold must have at most two decimal places")
	}

	val, ok := new(big.Rat).SetString(str)
	if !ok {
		return pgtype.Numeric{}, errors.New(msg)
	}
	if val.Sign() <= 0 {
		return pgtype.Numeric{}, errors.New("credit_spending_threshold must be greater than zero")
	}
	if val.Cmp(creditThresholdMax) > 0 {
		return pgtype.Numeric{}, errors.New("credit_spending_threshold must not exceed 999999999999.99")
	}

	var n pgtype.Numeric
	if err := n.Scan(str); err != nil {
		return pgtype.Numeric{}, errors.New(msg)
	}
	return n, nil
}
