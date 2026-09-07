package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/ledger/backend/internal/db"
)

type eventInput struct {
	Name               *string           `json:"name"`
	Note               *string           `json:"note"`
	TargetDate         json.RawMessage   `json:"target_date"`
	Status             *string           `json:"status"`
	SuggestionsEnabled *bool             `json:"suggestions_enabled"`
	Version            *int64            `json:"version"`
	Items              *[]eventItemInput `json:"items"`
}
type eventItemInput struct {
	ID           *uuid.UUID      `json:"id"`
	Name         string          `json:"name"`
	ExpectedCost json.RawMessage `json:"expected_cost"`
	ActualCost   json.RawMessage `json:"actual_cost"`
}
type eventSummary struct {
	ItemCount            int64       `json:"item_count"`
	ExpectedTotal        json.Number `json:"expected_total"`
	ActualTotal          json.Number `json:"actual_total"`
	MissingExpectedCount int64       `json:"missing_expected_count"`
	MissingActualCount   int64       `json:"missing_actual_count"`
	BudgetComplete       bool        `json:"budget_complete"`
	ActualsComplete      bool        `json:"actuals_complete"`
	CanComplete          bool        `json:"can_complete"`
}
type eventItemDTO struct {
	ID           uuid.UUID    `json:"id"`
	Name         string       `json:"name"`
	ExpectedCost *json.Number `json:"expected_cost"`
	ActualCost   *json.Number `json:"actual_cost"`
	Position     int32        `json:"position"`
}
type eventDTO struct {
	ID                 uuid.UUID       `json:"id"`
	Name               string          `json:"name"`
	Note               string          `json:"note"`
	TargetDate         *string         `json:"target_date"`
	Status             string          `json:"status"`
	SuggestionsEnabled bool            `json:"suggestions_enabled"`
	Version            int64           `json:"version"`
	CreatedAt          time.Time       `json:"created_at"`
	UpdatedAt          time.Time       `json:"updated_at"`
	Summary            eventSummary    `json:"summary"`
	Items              *[]eventItemDTO `json:"items,omitempty"`
}

func validEventStatus(s string) bool {
	return s == "planned" || s == "in_progress" || s == "completed" || s == "cancelled"
}
func eventName(s string) (string, error) {
	s = strings.TrimSpace(s)
	if n := utf8.RuneCountInString(s); n < 1 || n > 200 {
		return "", errors.New("name must contain 1–200 characters")
	}
	return s, nil
}

// Parse exact decimal numbers into paise before converting to NUMERIC. No float rounding.
func eventMoney(raw json.RawMessage) (pgtype.Numeric, error) {
	var n pgtype.Numeric
	if len(raw) == 0 || string(raw) == "null" {
		return n, nil
	}
	if len(raw) > 64 {
		return n, errors.New("invalid amount")
	}
	if index := strings.IndexAny(string(raw), "eE"); index >= 0 {
		exponent, err := strconv.ParseInt(string(raw[index+1:]), 10, 32)
		if err != nil || exponent < -30 || exponent > 30 {
			return n, errors.New("amount exponent out of range")
		}
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return n, errors.New("invalid amount")
	}
	if _, ok := v.(float64); !ok {
		return n, errors.New("amount must be a number or null")
	}
	r, ok := new(big.Rat).SetString(string(raw))
	if !ok {
		return n, errors.New("invalid amount")
	}
	r.Mul(r, big.NewRat(100, 1))
	if !r.IsInt() || r.Sign() < 0 || r.Num().Cmp(big.NewInt(99999999999999)) > 0 {
		return n, errors.New("amount must be nonnegative, at most 999999999999.99, with at most two decimal places")
	}
	return pgtype.Numeric{Int: new(big.Int).Set(r.Num()), Exp: -2, Valid: true}, nil
}
func numericPaise(n pgtype.Numeric) *big.Int {
	if !n.Valid {
		return new(big.Int)
	}
	v := new(big.Int).Set(n.Int)
	exp := int64(n.Exp) + 2
	p := new(big.Int).Exp(big.NewInt(10), big.NewInt(absEvent(exp)), nil)
	if exp >= 0 {
		return v.Mul(v, p)
	}
	return v.Quo(v, p)
}
func absEvent(n int64) int64 {
	if n < 0 {
		return -n
	}
	return n
}
func paiseJSON(n *big.Int) json.Number {
	return json.Number(new(big.Rat).SetFrac(n, big.NewInt(100)).FloatString(2))
}
func eventNumber(n pgtype.Numeric) *json.Number {
	if !n.Valid {
		return nil
	}
	v := paiseJSON(numericPaise(n))
	return &v
}
func (s *eventSummary) complete() {
	s.BudgetComplete = s.ItemCount > 0 && s.MissingExpectedCount == 0
	s.ActualsComplete = s.ItemCount > 0 && s.MissingActualCount == 0
	s.CanComplete = s.ActualsComplete
}
func eventBase(e db.Event) eventDTO {
	d := eventDTO{ID: e.ID, Name: e.Name, Note: e.Note, Status: e.Status, SuggestionsEnabled: e.SuggestionsEnabled, Version: e.Version, CreatedAt: e.CreatedAt.Time, UpdatedAt: e.UpdatedAt.Time}
	if e.TargetDate.Valid {
		v := dateToString(e.TargetDate)
		d.TargetDate = &v
	}
	return d
}
func eventDetail(e db.Event, items []db.EventItem) eventDTO {
	d := eventBase(e)
	out := make([]eventItemDTO, 0, len(items))
	expected, actual := new(big.Int), new(big.Int)
	for _, i := range items {
		out = append(out, eventItemDTO{i.ID, i.Name, eventNumber(i.ExpectedCost), eventNumber(i.ActualCost), i.Position})
		expected.Add(expected, numericPaise(i.ExpectedCost))
		actual.Add(actual, numericPaise(i.ActualCost))
		if !i.ExpectedCost.Valid {
			d.Summary.MissingExpectedCount++
		}
		if !i.ActualCost.Valid {
			d.Summary.MissingActualCount++
		}
	}
	d.Items = &out
	d.Summary.ItemCount = int64(len(items))
	d.Summary.ExpectedTotal = paiseJSON(expected)
	d.Summary.ActualTotal = paiseJSON(actual)
	d.Summary.complete()
	return d
}
func (in eventInput) parse(update bool) (db.CreateEventParams, []db.SaveEventItemParams, error) {
	var p db.CreateEventParams
	if in.Name == nil {
		return p, nil, errors.New("name is required")
	}
	if update && (in.Note == nil || len(in.TargetDate) == 0 || in.Status == nil || in.SuggestionsEnabled == nil || in.Version == nil || in.Items == nil) {
		return p, nil, errors.New("PUT requires all event fields, version, and items")
	}
	var err error
	p.Name, err = eventName(*in.Name)
	if err != nil {
		return p, nil, err
	}
	if in.Note != nil {
		p.Note = *in.Note
	}
	if utf8.RuneCountInString(p.Note) > 5000 {
		return p, nil, errors.New("note exceeds 5000 characters")
	}
	p.Status = "planned"
	if in.Status != nil {
		p.Status = *in.Status
	}
	if !validEventStatus(p.Status) {
		return p, nil, errors.New("invalid status")
	}
	p.SuggestionsEnabled = true
	if in.SuggestionsEnabled != nil {
		p.SuggestionsEnabled = *in.SuggestionsEnabled
	}
	if len(in.TargetDate) > 0 && string(in.TargetDate) != "null" {
		var date string
		if json.Unmarshal(in.TargetDate, &date) != nil {
			return p, nil, errors.New("invalid target_date")
		}
		p.TargetDate, err = parseDate(date)
		if err != nil {
			return p, nil, errors.New("target_date must be YYYY-MM-DD or null")
		}
	}
	if in.Version != nil && *in.Version < 1 {
		return p, nil, errors.New("version must be positive")
	}
	items := []db.SaveEventItemParams{}
	seen := map[uuid.UUID]bool{}
	if in.Items != nil {
		if len(*in.Items) > 500 {
			return p, nil, errors.New("maximum 500 items")
		}
		for index, i := range *in.Items {
			v := db.SaveEventItemParams{Position: int32(index)}
			v.Name, err = eventName(i.Name)
			if err != nil {
				return p, nil, fmt.Errorf("item %d: %w", index, err)
			}
			if update && (len(i.ExpectedCost) == 0 || len(i.ActualCost) == 0) {
				return p, nil, errors.New("item costs must be supplied, including null")
			}
			if i.ID != nil {
				if !update || *i.ID == uuid.Nil || seen[*i.ID] {
					return p, nil, errors.New("invalid item id")
				}
				v.ID = *i.ID
				seen[v.ID] = true
			}
			v.ExpectedCost, err = eventMoney(i.ExpectedCost)
			if err != nil {
				return p, nil, err
			}
			v.ActualCost, err = eventMoney(i.ActualCost)
			if err != nil {
				return p, nil, err
			}
			if p.Status == "completed" && !v.ActualCost.Valid {
				return p, nil, errors.New("completed events require actual cost for every item")
			}
			items = append(items, v)
		}
	}
	if p.Status == "completed" && len(items) == 0 {
		return p, nil, errors.New("empty events cannot be completed")
	}
	return p, items, nil
}
func readEventJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	err := dec.Decode(dst)
	if err == nil {
		if next := dec.Decode(&struct{}{}); next == io.EOF {
			return true
		} else {
			err = next
		}
	}
	var oversized *http.MaxBytesError
	if errors.As(err, &oversized) {
		writeErr(w, 413, "request exceeds 1 MiB")
	} else {
		writeErr(w, 400, "invalid request body")
	}
	return false
}
func eventPagination(r *http.Request) (int32, int32, error) {
	limit, offset := int64(50), int64(0)
	var err error
	if v := r.URL.Query().Get("limit"); v != "" {
		limit, err = strconv.ParseInt(v, 10, 32)
		if err != nil || limit < 1 || limit > 100 {
			return 0, 0, errors.New("limit must be 1–100")
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		offset, err = strconv.ParseInt(v, 10, 32)
		if err != nil || offset < 0 {
			return 0, 0, errors.New("offset must be nonnegative")
		}
	}
	return int32(limit), int32(offset), nil
}
