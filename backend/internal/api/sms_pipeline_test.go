package api

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/ledger/backend/internal/money"
	"github.com/ledger/backend/internal/smspipeline"
)

type smsVerifierFunc func(context.Context, smspipeline.Message) (smspipeline.VerificationResult, error)

func (f smsVerifierFunc) Verify(ctx context.Context, m smspipeline.Message) (smspipeline.VerificationResult, error) {
	return f(ctx, m)
}

type smsExtractorFunc func(context.Context, smspipeline.ExtractionInput) (smspipeline.ExtractionResult, error)

func (f smsExtractorFunc) Extract(ctx context.Context, input smspipeline.ExtractionInput) (smspipeline.ExtractionResult, error) {
	return f(ctx, input)
}

func pipelineFixture(t *testing.T, srv *Server, pool *pgxpool.Pool, webToken string) (uuid.UUID, string, smspipeline.Verification, smspipeline.Proposal) {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `UPDATE sms_sender_config SET senders=ARRAY['AD-BANK'],version=version+1 WHERE id=true`); err != nil {
		t.Fatal(err)
	}
	response := apiRequest(t, srv, webToken, "POST", "/api/sms/devices", map[string]any{"label": "Pipeline test"})
	var device struct {
		Token string `json:"token"`
	}
	if response.Code != 201 || json.Unmarshal(response.Body.Bytes(), &device) != nil {
		t.Fatalf("create %d %s", response.Code, response.Body)
	}
	enabled := apiRequest(t, srv, device.Token, "PUT", "/api/sms/device/consent", map[string]any{"enabled": true, "expected_version": 1})
	if enabled.Code != 200 {
		t.Fatalf("enable %d %s", enabled.Code, enabled.Body)
	}
	date := time.Now().UTC().Add(-24 * time.Hour).Format("2006-01-02")
	message := smsUploadMessage{FingerprintVersion: 1, Sender: "AD-BANK", Body: fmt.Sprintf("INR 125.50 debited on %s at SHOP using card 1234", date), ReceivedAt: time.Now().UnixMilli()}
	message.Fingerprint = smsFingerprint(message.Sender, message.ReceivedAt, message.Body)
	accepted := apiRequest(t, srv, device.Token, "POST", "/api/sms/device/uploads", smsUploadInput{ConsentVersion: 2, AllowlistVersion: 1, Messages: []smsUploadMessage{message}})
	var result struct {
		Receipts []smsReceipt `json:"receipts"`
	}
	if accepted.Code != 200 || json.Unmarshal(accepted.Body.Bytes(), &result) != nil || len(result.Receipts) != 1 || result.Receipts[0].ID == nil {
		t.Fatalf("accept %d %s", accepted.Code, accepted.Body)
	}
	v := smspipeline.Verification{Eligible: true, Reason: "complete", Date: date, DateEvidence: date, AmountEvidence: "125.50", CounterpartyEvidence: "SHOP", Direction: "debit", EventType: "purchase", PaymentSource: "card", PaymentEvidence: "card"}
	section := "daily"
	currency := "INR"
	p := smspipeline.Proposal{Date: date, Category: "SHOP", Amount: money.Number("125.50"), Section: &section, Currency: &currency, Direction: "debit", EventType: "purchase", PaymentSource: "card"}
	return *result.Receipts[0].ID, device.Token, v, p
}
func nextSMSStage(t *testing.T, w *smspipeline.Worker) {
	t.Helper()
	processed, err := w.ProcessNext(context.Background())
	if err != nil || !processed {
		t.Fatalf("stage processed=%v err=%v", processed, err)
	}
}
func sourceState(t *testing.T, pool *pgxpool.Pool, id uuid.UUID) (string, int, int) {
	t.Helper()
	var state string
	var a, b int
	if err := pool.QueryRow(context.Background(), `SELECT status,verification_attempts,extraction_attempts FROM sms_suggestions WHERE id=$1`, id).Scan(&state, &a, &b); err != nil {
		t.Fatal(err)
	}
	return state, a, b
}
func TestSMSPipelineDraftDelivery(t *testing.T) {
	srv, pool, token, owner := setupCategoryAPITest(t)
	defer pool.Close()
	id, deviceToken, v, p := pipelineFixture(t, srv, pool, token)
	verificationCalls, extractionCalls := 0, 0
	store := smspipeline.NewPostgresStore(pool)
	worker := smspipeline.NewWorker(store, smsVerifierFunc(func(context.Context, smspipeline.Message) (smspipeline.VerificationResult, error) {
		verificationCalls++
		return smspipeline.VerificationResult{Decision: v}, nil
	}),
		smsExtractorFunc(func(context.Context, smspipeline.ExtractionInput) (smspipeline.ExtractionResult, error) {
			extractionCalls++
			return smspipeline.ExtractionResult{Proposal: p}, nil
		}), smspipeline.WorkerOptions{})
	var ledgerBefore int
	_ = pool.QueryRow(context.Background(), `SELECT count(*) FROM transactions WHERE user_id=$1`, owner).Scan(&ledgerBefore)
	nextSMSStage(t, worker)
	if state, a, b := sourceState(t, pool, id); state != "classified" || a != 1 || b != 0 {
		t.Fatalf("verification %s %d %d", state, a, b)
	}
	nextSMSStage(t, worker)
	if state, a, b := sourceState(t, pool, id); state != "pending_review" || a != 1 || b != 1 {
		t.Fatalf("conversion %s %d %d", state, a, b)
	}
	if processed, err := worker.ProcessNext(context.Background()); err != nil || processed {
		t.Fatalf("processed a draft twice %v %v", processed, err)
	}
	response := apiRequest(t, srv, token, "GET", "/api/sms/drafts", nil)
	var result struct {
		Drafts []struct {
			Kind                string       `json:"kind"`
			Section             string       `json:"section"`
			Amount              money.Number `json:"amount"`
			SectionIsSuggestion bool         `json:"section_is_suggestion"`
		} `json:"drafts"`
	}
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &result) != nil || len(result.Drafts) != 1 {
		t.Fatalf("drafts %d %s", response.Code, response.Body)
	}
	d := result.Drafts[0]
	if d.Kind != "credit" || d.Section != "daily" || d.Amount.String() != "125.50" || !d.SectionIsSuggestion {
		t.Fatalf("draft %+v", d)
	}
	var count, ledgerAfter int
	_ = pool.QueryRow(context.Background(), `SELECT count(*) FROM sms_transaction_drafts WHERE source_sms_id=$1`, id).Scan(&count)
	_ = pool.QueryRow(context.Background(), `SELECT count(*) FROM transactions WHERE user_id=$1`, owner).Scan(&ledgerAfter)
	if count != 1 || ledgerAfter != ledgerBefore || verificationCalls != 1 || extractionCalls != 1 {
		t.Fatal("duplicate draft, ledger write, or duplicate AI call")
	}
	var body, verification *string
	if err := pool.QueryRow(context.Background(), `SELECT body,verification::text FROM sms_suggestions WHERE id=$1`, id).Scan(&body, &verification); err != nil || body != nil || verification != nil {
		t.Fatalf("raw evidence retained %v", err)
	}
	if got := apiRequest(t, srv, deviceToken, "GET", "/api/sms/drafts", nil).Code; got != 401 {
		t.Fatalf("device accessed drafts %d", got)
	}
	foreign := signedTestToken(t, uuid.New())
	other := apiRequest(t, srv, foreign, "GET", "/api/sms/drafts", nil)
	if other.Code != 200 || strings.Contains(other.Body.String(), "SHOP") {
		t.Fatalf("cross-account drafts %s", other.Body)
	}
}
func TestSMSPipelineConcurrentWorkersDoNotDoubleCall(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()
	_, _, v, p := pipelineFixture(t, srv, pool, token)
	started := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error, 1)
	var calls atomic.Int32
	worker := smspipeline.NewWorker(smspipeline.NewPostgresStore(pool), smsVerifierFunc(func(ctx context.Context, _ smspipeline.Message) (smspipeline.VerificationResult, error) {
		calls.Add(1)
		close(started)
		select {
		case <-release:
			return smspipeline.VerificationResult{Decision: v}, nil
		case <-ctx.Done():
			return smspipeline.VerificationResult{}, ctx.Err()
		}
	}), smsExtractorFunc(func(context.Context, smspipeline.ExtractionInput) (smspipeline.ExtractionResult, error) {
		return smspipeline.ExtractionResult{Proposal: p}, nil
	}), smspipeline.WorkerOptions{})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	go func() { _, err := worker.ProcessNext(ctx); done <- err }()
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("provider did not start")
	}
	processed, err := worker.ProcessNext(ctx)
	close(release)
	if err != nil || processed {
		t.Fatalf("second worker claimed in-flight source: %v %v", processed, err)
	}
	if err = <-done; err != nil {
		t.Fatal(err)
	}
	nextSMSStage(t, worker)
	if calls.Load() != 1 {
		t.Fatalf("duplicate verification calls: %d", calls.Load())
	}
}

func TestSMSPipelineRejectsMissingDateWithoutExtraction(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()
	id, _, v, _ := pipelineFixture(t, srv, pool, token)
	v.DateEvidence = ""
	worker := smspipeline.NewWorker(smspipeline.NewPostgresStore(pool), smsVerifierFunc(func(context.Context, smspipeline.Message) (smspipeline.VerificationResult, error) {
		return smspipeline.VerificationResult{Decision: v}, nil
	}),
		smsExtractorFunc(func(context.Context, smspipeline.ExtractionInput) (smspipeline.ExtractionResult, error) {
			t.Error("incomplete message reached extraction")
			return smspipeline.ExtractionResult{}, nil
		}), smspipeline.WorkerOptions{})
	nextSMSStage(t, worker)
	if state, _, b := sourceState(t, pool, id); state != "rejected" || b != 0 {
		t.Fatalf("%s %d", state, b)
	}
	var body *string
	var reason string
	if err := pool.QueryRow(context.Background(), `SELECT body,rejection_reason FROM sms_suggestions WHERE id=$1`, id).Scan(&body, &reason); err != nil || body != nil || reason != "missing_date" {
		t.Fatalf("rejection %s %v %v", reason, body, err)
	}
}
func TestSMSPipelineRetriesOnlyExtraction(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()
	id, _, v, p := pipelineFixture(t, srv, pool, token)
	calls := 0
	allowSuccess := false
	worker := smspipeline.NewWorker(smspipeline.NewPostgresStore(pool), smsVerifierFunc(func(context.Context, smspipeline.Message) (smspipeline.VerificationResult, error) {
		calls++
		return smspipeline.VerificationResult{Decision: v}, nil
	}),
		smsExtractorFunc(func(context.Context, smspipeline.ExtractionInput) (smspipeline.ExtractionResult, error) {
			if !allowSuccess {
				return smspipeline.ExtractionResult{}, smspipeline.ErrRateLimited
			}
			return smspipeline.ExtractionResult{Proposal: p}, nil
		}), smspipeline.WorkerOptions{})
	nextSMSStage(t, worker)
	for i := 0; i < 3; i++ {
		_, _ = pool.Exec(context.Background(), `UPDATE sms_suggestions SET next_attempt_at=now()-interval '1 second' WHERE id=$1`, id)
		nextSMSStage(t, worker)
	}
	if state, a, b := sourceState(t, pool, id); state != "failed" || a != 1 || b != 3 {
		t.Fatalf("%s %d %d", state, a, b)
	}
	other := signedTestToken(t, uuid.New())
	if got := apiRequest(t, srv, other, "POST", "/api/sms/jobs/"+id.String()+"/retry", nil).Code; got != 409 {
		t.Fatalf("foreign retry %d", got)
	}
	if got := apiRequest(t, srv, token, "POST", "/api/sms/jobs/"+id.String()+"/retry", nil).Code; got != 204 {
		t.Fatalf("retry %d", got)
	}
	allowSuccess = true
	nextSMSStage(t, worker)
	if state, a, b := sourceState(t, pool, id); state != "pending_review" || a != 1 || b != 1 || calls != 1 {
		t.Fatalf("reclassified on extraction retry %s %d %d calls %d", state, a, b, calls)
	}
}
func TestSMSPipelineDiscardsLateStrategySuccess(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()
	id, _, v, _ := pipelineFixture(t, srv, pool, token)
	worker := smspipeline.NewWorker(smspipeline.NewPostgresStore(pool), smsVerifierFunc(func(ctx context.Context, _ smspipeline.Message) (smspipeline.VerificationResult, error) {
		<-ctx.Done()
		// A future adapter must not be able to turn an expired call into success.
		return smspipeline.VerificationResult{Decision: v}, nil
	}), smsExtractorFunc(func(context.Context, smspipeline.ExtractionInput) (smspipeline.ExtractionResult, error) {
		t.Error("late result reached extraction")
		return smspipeline.ExtractionResult{}, nil
	}), smspipeline.WorkerOptions{CallTimeout: 5 * time.Millisecond})
	nextSMSStage(t, worker)
	if state, a, b := sourceState(t, pool, id); state != "queued" || a != 1 || b != 0 {
		t.Fatalf("late success committed: %s %d %d", state, a, b)
	}
	var code string
	if err := pool.QueryRow(context.Background(), `SELECT last_error_code FROM sms_suggestions WHERE id=$1`, id).Scan(&code); err != nil || code != "provider_timeout" {
		t.Fatalf("code %s err %v", code, err)
	}
}

func TestSMSPipelineOptOutDuringProviderCall(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()
	id, deviceToken, v, _ := pipelineFixture(t, srv, pool, token)
	worker := smspipeline.NewWorker(smspipeline.NewPostgresStore(pool), smsVerifierFunc(func(context.Context, smspipeline.Message) (smspipeline.VerificationResult, error) {
		// This completes while a provider request is in progress: no long DB lock is held.
		response := apiRequest(t, srv, deviceToken, "PUT", "/api/sms/device/consent", map[string]any{"enabled": false, "expected_version": 2})
		if response.Code != 200 {
			t.Fatalf("disable blocked/failed %d", response.Code)
		}
		return smspipeline.VerificationResult{Decision: v}, nil
	}), smsExtractorFunc(func(context.Context, smspipeline.ExtractionInput) (smspipeline.ExtractionResult, error) {
		t.Error("cancelled job extracted")
		return smspipeline.ExtractionResult{}, nil
	}), smspipeline.WorkerOptions{})
	nextSMSStage(t, worker)
	if state, _, _ := sourceState(t, pool, id); state != "cancelled" {
		t.Fatal(state)
	}
}
func TestSMSPipelineSenderRemovedDuringExtraction(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()
	id, _, v, p := pipelineFixture(t, srv, pool, token)
	worker := smspipeline.NewWorker(smspipeline.NewPostgresStore(pool), smsVerifierFunc(func(context.Context, smspipeline.Message) (smspipeline.VerificationResult, error) {
		return smspipeline.VerificationResult{Decision: v}, nil
	}),
		smsExtractorFunc(func(context.Context, smspipeline.ExtractionInput) (smspipeline.ExtractionResult, error) {
			if _, err := pool.Exec(context.Background(), `UPDATE sms_sender_config SET senders='{}',version=version+1 WHERE id=true`); err != nil {
				t.Fatal(err)
			}
			return smspipeline.ExtractionResult{Proposal: p}, nil
		}), smspipeline.WorkerOptions{})
	nextSMSStage(t, worker)
	nextSMSStage(t, worker)
	if state, _, _ := sourceState(t, pool, id); state != "cancelled" {
		t.Fatal(state)
	}
	var drafts int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM sms_transaction_drafts WHERE source_sms_id=$1`, id).Scan(&drafts); err != nil || drafts != 0 {
		t.Fatalf("removed sender persisted draft: %d %v", drafts, err)
	}
}

func TestSMSPipelineLeaseRecoveryFencesOldReply(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()
	id, _, v, _ := pipelineFixture(t, srv, pool, token)
	store := smspipeline.NewPostgresStore(pool)
	ctx := context.Background()
	now := time.Now()
	first, err := store.Claim(ctx, now, time.Minute)
	if err != nil || first == nil {
		t.Fatalf("claim %v", err)
	}
	second, err := store.Claim(ctx, now.Add(2*time.Minute), time.Minute)
	if err != nil || second == nil {
		t.Fatalf("reclaim %v", err)
	}
	if err = store.Verified(ctx, *first, smspipeline.VerificationResult{Decision: v}, now.Add(2*time.Minute)); err != smspipeline.ErrStaleClaim {
		t.Fatalf("old provider reply committed: %v", err)
	}
	third, err := store.Claim(ctx, now.Add(4*time.Minute), time.Minute)
	if err != nil || third == nil {
		t.Fatalf("third %v", err)
	}
	last, err := store.Claim(ctx, now.Add(6*time.Minute), time.Minute)
	if err != nil || last != nil {
		t.Fatalf("unbounded crash retries %v %v", last, err)
	}
	if state, a, b := sourceState(t, pool, id); state != "failed" || a != 3 || b != 0 {
		t.Fatalf("%s %d %d", state, a, b)
	}
}
