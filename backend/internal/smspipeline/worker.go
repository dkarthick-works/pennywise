package smspipeline

import (
	"context"
	"errors"
	"log"
	"time"
)

type WorkerOptions struct{ PollInterval, CallTimeout, LeaseDuration time.Duration }
type Worker struct {
	store     Store
	verifier  Verifier
	extractor Extractor
	options   WorkerOptions
	now       func() time.Time
}

func NewWorker(store Store, verifier Verifier, extractor Extractor, options WorkerOptions) *Worker {
	if options.PollInterval <= 0 {
		options.PollInterval = time.Second
	}
	if options.CallTimeout <= 0 {
		options.CallTimeout = 15 * time.Second
	}
	if options.LeaseDuration < options.CallTimeout+30*time.Second {
		options.LeaseDuration = options.CallTimeout + 30*time.Second
	}
	return &Worker{store: store, verifier: verifier, extractor: extractor, options: options, now: time.Now}
}

// ProcessNext performs exactly one persisted stage. Retrying extraction never
// calls verification again. No database transaction spans a provider request.
func (w *Worker) ProcessNext(ctx context.Context) (bool, error) {
	job, err := w.store.Claim(ctx, w.now(), w.options.LeaseDuration)
	if err != nil || job == nil {
		return false, err
	}
	eligible, err := w.store.Eligible(ctx, *job, w.now())
	if err != nil {
		if errors.Is(err, ErrStaleClaim) {
			return true, nil
		}
		return true, err
	}
	if !eligible {
		return true, nil
	}
	callCtx, cancel := context.WithTimeout(ctx, w.options.CallTimeout)
	defer cancel()
	switch job.Stage {
	case "verification":
		result, callErr := w.verifier.Verify(callCtx, job.Message)
		if callCtx.Err() != nil {
			callErr = callCtx.Err()
		}
		if callErr == nil {
			result.Decision = CheckReadiness(job.Message, result.Decision)
			err = w.store.Verified(ctx, *job, result, w.now())
		} else {
			err = w.recordFailure(ctx, *job, callErr)
		}
	case "extraction":
		input := ExtractionInput{Message: job.Message, Verification: job.Verification}
		result, callErr := w.extractor.Extract(callCtx, input)
		if callCtx.Err() != nil {
			callErr = callCtx.Err()
		}
		if callErr == nil {
			var draft Draft
			draft, callErr = ValidateProposal(input, result.Proposal)
			if callErr == nil {
				err = w.store.Extracted(ctx, *job, draft, result.Usage, w.now())
			}
		}
		if callErr != nil {
			err = w.recordFailure(ctx, *job, callErr)
		}
	default:
		return true, ErrInvalidResponse
	}
	if errors.Is(err, ErrStaleClaim) {
		return true, nil
	}
	return true, err
}
func (w *Worker) recordFailure(ctx context.Context, job Job, cause error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	} // Shutdown recovery uses the persisted lease.
	code := "provider_unavailable"
	switch {
	case errors.Is(cause, ErrTimeout), errors.Is(cause, context.DeadlineExceeded):
		code = "provider_timeout"
	case errors.Is(cause, ErrRateLimited):
		code = "provider_rate_limited"
	case errors.Is(cause, ErrInvalidResponse):
		code = "invalid_ai_response"
	}
	return w.store.Failed(ctx, job, code, w.now())
}
func (w *Worker) Run(ctx context.Context) {
	for ctx.Err() == nil {
		_, err := w.ProcessNext(ctx)
		if err != nil && ctx.Err() == nil {
			log.Print("SMS AI persistence operation failed; retrying after poll interval")
		}
		// Bound request cadence even when the provider instantly fails/rate-limits
		// and many different source rows are queued.
		timer := time.NewTimer(w.options.PollInterval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}
