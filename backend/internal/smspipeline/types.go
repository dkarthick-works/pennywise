// Package smspipeline turns eligible SMS into drafts, never ledger transactions.
// Verifier and Extractor are independent strategy seams; each can use a different
// provider without changing the worker, persistence, or the other strategy.
package smspipeline

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/ledger/backend/internal/money"
)

var (
	ErrInvalidResponse = errors.New("invalid_ai_response")
	ErrUnavailable     = errors.New("provider_unavailable")
	ErrRateLimited     = errors.New("provider_rate_limited")
	ErrTimeout         = errors.New("provider_timeout")
	ErrStaleClaim      = errors.New("stale_claim")
)

type Message struct {
	Sender     string `json:"sender"`
	Body       string `json:"body"`
	ReceivedAt int64  `json:"received_at"`
	Currency   string `json:"account_currency"`
}

type Usage struct {
	Provider         string `json:"provider"`
	Model            string `json:"model"`
	PromptVersion    string `json:"prompt_version"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
}

type Verification struct {
	Eligible             bool   `json:"eligible"`
	Reason               string `json:"reason"`
	Date                 string `json:"date"`
	DateEvidence         string `json:"date_evidence"`
	AmountEvidence       string `json:"amount_evidence"`
	CounterpartyEvidence string `json:"counterparty_evidence"`
	Direction            string `json:"direction"`
	EventType            string `json:"event_type"`
	PaymentSource        string `json:"payment_source"`
	PaymentEvidence      string `json:"payment_evidence"`
}

type VerificationResult struct {
	Decision Verification
	Usage    Usage
}
type ExtractionInput struct {
	Message      Message      `json:"message"`
	Verification Verification `json:"verification"`
}
type Proposal struct {
	Date          string       `json:"date"`
	Category      string       `json:"category"`
	Amount        money.Number `json:"amount"`
	Section       *string      `json:"section"`
	Currency      *string      `json:"currency"`
	Direction     string       `json:"direction"`
	EventType     string       `json:"event_type"`
	PaymentSource string       `json:"payment_source"`
}
type ExtractionResult struct {
	Proposal Proposal
	Usage    Usage
}

// Verifier determines strict yes/no readiness, not authenticity or permission to save.
type Verifier interface {
	Verify(context.Context, Message) (VerificationResult, error)
}

// Extractor converts an already-verified message into a structured proposal.
type Extractor interface {
	Extract(context.Context, ExtractionInput) (ExtractionResult, error)
}

type Draft struct {
	Date      string
	Category  string
	Amount    money.Number
	Section   *string
	Kind      string
	Currency  string
	Direction string
	EventType string
	Warnings  []string
}

type Job struct {
	ID           uuid.UUID
	UserID       uuid.UUID
	DeviceID     uuid.UUID
	ClaimToken   uuid.UUID
	Stage        string
	Message      Message
	Verification Verification
}

// Store owns claims, retries, consent fencing, and atomic draft persistence.
// The worker cannot create transactions through this interface.
type Store interface {
	Claim(context.Context, time.Time, time.Duration) (*Job, error)
	Eligible(context.Context, Job, time.Time) (bool, error)
	Verified(context.Context, Job, VerificationResult, time.Time) error
	Extracted(context.Context, Job, Draft, Usage, time.Time) error
	Failed(context.Context, Job, string, time.Time) error
}
