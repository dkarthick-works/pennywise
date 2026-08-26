package api

import (
	"errors"
	"log"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ledger/backend/internal/money"
	"github.com/ledger/backend/internal/transactionparser"
)

const (
	maxTransactionParseTextBytes = 16 * 1024
	maxTransactionParseTextRunes = 4000
	maxTransactionParseBodyBytes = 20 * 1024
)

type parseTransactionsRequest struct {
	Text          string `json:"text"`
	ReferenceDate string `json:"reference_date"`
}

type transactionPreview struct {
	Ready    bool               `json:"ready"`
	Section  *string            `json:"section"`
	Category *string            `json:"category"`
	Amount   *money.Number      `json:"amount"`
	Date     *string            `json:"date"`
	Kind     *string            `json:"kind"`
	Issues   []transactionIssue `json:"issues"`
}

type parseTransactionsResponse struct {
	Transactions []transactionPreview `json:"transactions"`
}

func (s *Server) handleParseTransactions(w http.ResponseWriter, r *http.Request) {
	if s.transactionParser == nil {
		writeErr(w, http.StatusServiceUnavailable, "AI transaction parsing is not configured")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxTransactionParseBodyBytes)
	var request parseTransactionsRequest
	if err := readJSON(r, &request); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	request.Text = strings.TrimSpace(request.Text)
	if request.Text == "" {
		writeErr(w, http.StatusBadRequest, "text is required")
		return
	}
	if len(request.Text) > maxTransactionParseTextBytes || utf8.RuneCountInString(request.Text) > maxTransactionParseTextRunes {
		writeErr(w, http.StatusBadRequest, "text is too long")
		return
	}
	if !dateRe.MatchString(request.ReferenceDate) {
		writeErr(w, http.StatusBadRequest, "reference_date must be YYYY-MM-DD")
		return
	}
	if _, err := parseDate(request.ReferenceDate); err != nil {
		writeErr(w, http.StatusBadRequest, "reference_date must be a valid calendar date")
		return
	}
	if s.aiRateLimiter != nil && !s.aiRateLimiter.allow(userID(r), time.Now()) {
		writeErr(w, http.StatusTooManyRequests, "AI transaction parsing request limit reached; try again later")
		return
	}

	select {
	case s.aiSlots <- struct{}{}:
		defer func() { <-s.aiSlots }()
	default:
		writeErr(w, http.StatusTooManyRequests, "AI transaction parsing is busy; try again shortly")
		return
	}

	result, err := s.transactionParser.Parse(r.Context(), transactionparser.ParseInput{
		Text: request.Text, ReferenceDate: request.ReferenceDate,
	})
	if err != nil {
		writeTransactionParseError(w, err)
		return
	}

	previews := make([]transactionPreview, 0, len(result.Transactions))
	onlyUnsupportedSettlements := len(result.Transactions) > 0
	for _, draft := range result.Transactions {
		if !draftHasAnyValue(draft) {
			continue
		}
		if draft.Date == nil && !hasParserIssue(draft.Issues, "ambiguous_date") {
			date := request.ReferenceDate
			draft.Date = &date
			draft.Issues = removeParserIssueCode(draft.Issues, "missing_date")
		}
		issues := parserIssues(draft)
		if !hasIssueCode(issues, "unsupported_settlement") {
			onlyUnsupportedSettlements = false
		}
		issues = append(issues, validateTransactionValues(transactionValues{
			Section: draft.Section, Category: draft.Category, Amount: draft.Amount,
			Date: draft.Date, Kind: draft.Kind,
		}, true, false)...)
		issues = dedupeIssues(issues)
		previews = append(previews, transactionPreview{
			Ready: len(issues) == 0, Section: draft.Section, Category: draft.Category,
			Amount: draft.Amount, Date: draft.Date, Kind: draft.Kind, Issues: issues,
		})
	}
	if len(previews) == 0 || onlyUnsupportedSettlements {
		writeErr(w, http.StatusUnprocessableEntity, "no supported transaction could be found")
		return
	}

	log.Printf("AI transaction parse model=%s prompt_tokens=%d completion_tokens=%d total_tokens=%d outcome=success drafts=%d",
		result.Usage.Model, result.Usage.PromptTokens, result.Usage.CompletionTokens, result.Usage.TotalTokens, len(previews))
	writeJSON(w, http.StatusOK, parseTransactionsResponse{Transactions: previews})
}

func writeTransactionParseError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, transactionparser.ErrNoTransactions):
		writeErr(w, http.StatusUnprocessableEntity, "no supported transaction could be found")
	case errors.Is(err, transactionparser.ErrRateLimited):
		writeErr(w, http.StatusTooManyRequests, "AI transaction parsing is temporarily rate limited")
	case errors.Is(err, transactionparser.ErrTimeout):
		writeErr(w, http.StatusGatewayTimeout, "AI transaction parsing timed out")
	case errors.Is(err, transactionparser.ErrInvalidResponse):
		writeErr(w, http.StatusBadGateway, "AI transaction parsing returned an invalid response")
	default:
		writeErr(w, http.StatusServiceUnavailable, "AI transaction parsing is unavailable")
	}
}

func draftHasAnyValue(draft transactionparser.Draft) bool {
	return draft.Section != nil || draft.Category != nil || draft.Amount != nil || draft.Date != nil || draft.Kind != nil
}

func hasParserIssue(issues []transactionparser.Issue, code string) bool {
	for _, item := range issues {
		if item.Code == code {
			return true
		}
	}
	return false
}

func removeParserIssueCode(issues []transactionparser.Issue, code string) []transactionparser.Issue {
	out := issues[:0]
	for _, item := range issues {
		if item.Code != code {
			out = append(out, item)
		}
	}
	return out
}

func parserIssues(draft transactionparser.Draft) []transactionIssue {
	out := make([]transactionIssue, 0, len(draft.Issues))
	for _, item := range draft.Issues {
		message, known := parserIssueMessages[item.Code]
		if !known || !validIssueField(item.Field) {
			continue
		}
		switch {
		case strings.HasPrefix(item.Code, "missing_"):
			// Missing-field issues come only from deterministic Go validation.
			continue
		case strings.HasPrefix(item.Code, "ambiguous_") && draftFieldHasValue(draft, item.Field):
			continue
		case item.Code == "unsupported_settlement" && draft.Kind != nil:
			continue
		}
		out = append(out, issue(item.Field, item.Code, message))
	}
	return out
}

func draftFieldHasValue(draft transactionparser.Draft, field string) bool {
	switch field {
	case "section":
		return draft.Section != nil
	case "category":
		return draft.Category != nil
	case "amount":
		return draft.Amount != nil
	case "date":
		return draft.Date != nil
	case "kind":
		return draft.Kind != nil
	default:
		return false
	}
}

func validIssueField(field string) bool {
	switch field {
	case "section", "category", "amount", "date", "kind", "transaction":
		return true
	default:
		return false
	}
}

func hasIssueCode(issues []transactionIssue, code string) bool {
	for _, item := range issues {
		if item.Code == code {
			return true
		}
	}
	return false
}

var parserIssueMessages = map[string]string{
	"missing_section":        "Section is required",
	"ambiguous_section":      "Section is unclear",
	"missing_category":       "Category is required",
	"ambiguous_category":     "Category is unclear",
	"missing_amount":         "Amount is required",
	"ambiguous_amount":       "Amount is unclear",
	"missing_date":           "Date is required",
	"ambiguous_date":         "Date is unclear",
	"missing_kind":           "Kind is required",
	"ambiguous_kind":         "Kind is unclear",
	"unsupported_settlement": "Settlement transactions are not supported here",
}
