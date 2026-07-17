package api

import (
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/ledger/backend/internal/db"
)

const (
	defaultTransactionNameSuggestionLimit  = 10
	maxTransactionNameSuggestionLimit      = 20
	maxTransactionNameSuggestionQueryRunes = 100

	invalidTransactionNameSectionMessage  = "section must be essential, flexible, daily, or income"
	invalidTransactionNameQueryMessage    = "q must be 100 characters or fewer"
	invalidTransactionNameLimitMessage    = "limit must be an integer between 1 and 20"
	loadTransactionNameSuggestionsMessage = "could not load transaction name suggestions"
)

type transactionNameSuggestionDTO struct {
	Name string `json:"name"`
}

type transactionNameSuggestionsResponse struct {
	Items []transactionNameSuggestionDTO `json:"items"`
}

type transactionNameSuggestionParams struct {
	Section db.Section
	Search  string
	Limit   int32
}

func parseTransactionNameSuggestionParams(values url.Values) (transactionNameSuggestionParams, error) {
	section := strings.TrimSpace(values.Get("section"))
	if !validSection(section) {
		return transactionNameSuggestionParams{}, errors.New(invalidTransactionNameSectionMessage)
	}

	search := strings.TrimSpace(values.Get("q"))
	if utf8.RuneCountInString(search) > maxTransactionNameSuggestionQueryRunes {
		return transactionNameSuggestionParams{}, errors.New(invalidTransactionNameQueryMessage)
	}

	limit := defaultTransactionNameSuggestionLimit
	if raw := strings.TrimSpace(values.Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > maxTransactionNameSuggestionLimit {
			return transactionNameSuggestionParams{}, errors.New(invalidTransactionNameLimitMessage)
		}
		limit = parsed
	}

	return transactionNameSuggestionParams{
		Section: db.Section(section),
		Search:  search,
		Limit:   int32(limit),
	}, nil
}

func normalizedSearchRuneCount(search string) int {
	return utf8.RuneCountInString(strings.Join(strings.Fields(search), " "))
}

func (s *Server) handleTransactionNameSuggestions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")

	params, err := parseTransactionNameSuggestionParams(r.URL.Query())
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	uid := userID(r)
	var names []string
	switch queryLength := normalizedSearchRuneCount(params.Search); {
	case queryLength == 0:
		names, err = s.q.ListPopularTransactionNameSuggestions(r.Context(), db.ListPopularTransactionNameSuggestionsParams{
			UserID: uid, Section: params.Section, ResultLimit: params.Limit,
		})
	case queryLength < 3:
		names, err = s.q.SearchShortTransactionNameSuggestions(r.Context(), db.SearchShortTransactionNameSuggestionsParams{
			UserID: uid, Section: params.Section, Search: params.Search, ResultLimit: params.Limit,
		})
	default:
		names, err = s.q.SearchTransactionNameSuggestions(r.Context(), db.SearchTransactionNameSuggestionsParams{
			UserID: uid, Section: params.Section, Search: params.Search, ResultLimit: params.Limit,
		})
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, loadTransactionNameSuggestionsMessage)
		return
	}

	items := make([]transactionNameSuggestionDTO, 0, len(names))
	for _, name := range names {
		items = append(items, transactionNameSuggestionDTO{Name: name})
	}
	writeJSON(w, http.StatusOK, transactionNameSuggestionsResponse{Items: items})
}
