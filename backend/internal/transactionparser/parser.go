package transactionparser

import (
	"context"
	"errors"

	"github.com/ledger/backend/internal/money"
)

var (
	ErrInvalidResponse = errors.New("AI service returned an invalid response")
	ErrNoTransactions  = errors.New("no transaction could be found")
	ErrRateLimited     = errors.New("AI service rate limit reached")
	ErrUnavailable     = errors.New("AI service unavailable")
	ErrTimeout         = errors.New("AI service timed out")
)

type Parser interface {
	Parse(ctx context.Context, input ParseInput) (ParseResult, error)
}

type ParseInput struct {
	Text          string
	ReferenceDate string
}

type Draft struct {
	Section  *string       `json:"section"`
	Category *string       `json:"category"`
	Amount   *money.Number `json:"amount"`
	Date     *string       `json:"date"`
	Kind     *string       `json:"kind"`
	Issues   []Issue       `json:"issues"`
}

type Issue struct {
	Field string `json:"field"`
	Code  string `json:"code"`
}

type Usage struct {
	Model            string
	PromptTokens     int64
	CompletionTokens int64
	TotalTokens      int64
}

type ParseResult struct {
	Transactions []Draft
	Usage        Usage
}
