package api

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/ledger/backend/internal/smspipeline"
)

func reviewFixture(t *testing.T, srv *Server, pool *pgxpool.Pool, token string) (uuid.UUID, uuid.UUID, string, map[string]any) {
	t.Helper()
	source, device, v, p := pipelineFixture(t, srv, pool, token)
	worker := smspipeline.NewWorker(smspipeline.NewPostgresStore(pool), smsVerifierFunc(func(context.Context, smspipeline.Message) (smspipeline.VerificationResult, error) {
		return smspipeline.VerificationResult{Decision: v}, nil
	}), smsExtractorFunc(func(context.Context, smspipeline.ExtractionInput) (smspipeline.ExtractionResult, error) {
		return smspipeline.ExtractionResult{Proposal: p}, nil
	}), smspipeline.WorkerOptions{})
	nextSMSStage(t, worker)
	nextSMSStage(t, worker)
	var id uuid.UUID
	if err := pool.QueryRow(context.Background(), `SELECT id FROM sms_transaction_drafts WHERE source_sms_id=$1`, source).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id, source, device, map[string]any{"section": "daily", "category": "Edited shop", "amount": 130.25, "date": p.Date, "kind": "cash", "sms_draft_id": id.String(), "sms_draft_revision": 1}
}
func TestSMSReviewEditApproveAndReplay(t *testing.T) {
	srv, pool, token, owner := setupCategoryAPITest(t)
	defer pool.Close()
	id, source, _, input := reviewFixture(t, srv, pool, token)
	path := "/api/sms/drafts/" + id.String()
	edits := map[string]any{"section": "", "category": "Saved name", "amount": 200.50, "date": input["date"], "kind": "cash", "revision": 1}
	if r := apiRequest(t, srv, token, "PUT", path, edits); r.Code != 204 {
		t.Fatalf("edit %d %s", r.Code, r.Body)
	}
	var amount string
	var revision int
	var section *string
	if err := pool.QueryRow(context.Background(), `SELECT amount::text,revision,section::text FROM sms_transaction_drafts WHERE id=$1`, id).Scan(&amount, &revision, &section); err != nil || amount != "200.50" || revision != 2 || section != nil {
		t.Fatalf("draft values %s %d %v %v", amount, revision, section, err)
	}
	if r := apiRequest(t, srv, token, "POST", "/api/transactions", input); r.Code != 409 {
		t.Fatalf("stale approval %d %s", r.Code, r.Body)
	}
	input["sms_draft_revision"] = 2
	r := apiRequest(t, srv, token, "POST", "/api/transactions", input)
	if r.Code != 201 {
		t.Fatalf("approve %d %s", r.Code, r.Body)
	}
	var created struct {
		ID       string `json:"id"`
		Category string `json:"category"`
	}
	if err := json.Unmarshal(r.Body.Bytes(), &created); err != nil || created.Category != "Edited shop" {
		t.Fatal(r.Body)
	}
	var linked string
	if err := pool.QueryRow(context.Background(), `SELECT transaction_id::text FROM sms_suggestions WHERE id=$1 AND status='approved'`, source).Scan(&linked); err != nil || linked != created.ID {
		t.Fatalf("link %s %v", linked, err)
	}
	if r := apiRequest(t, srv, token, "POST", "/api/transactions", input); r.Code != 409 {
		t.Fatalf("replay %d", r.Code)
	}
	// Deleting the transaction must never make this source approvable again.
	if r := apiRequest(t, srv, token, "DELETE", "/api/transactions/"+created.ID, nil); r.Code != 204 {
		t.Fatal(r.Body)
	}
	if r := apiRequest(t, srv, token, "POST", "/api/transactions", input); r.Code != 409 {
		t.Fatalf("replay after deletion %d", r.Code)
	}
	var count int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM transactions WHERE user_id=$1`, owner).Scan(&count); err != nil || count != 0 {
		t.Fatalf("ledger %d %v", count, err)
	}
}
func TestSMSReviewOwnershipValidationAndIgnore(t *testing.T) {
	srv, pool, token, owner := setupCategoryAPITest(t)
	defer pool.Close()
	id, _, device, input := reviewFixture(t, srv, pool, token)
	path := "/api/sms/drafts/" + id.String()
	foreign := signedTestToken(t, uuid.New())
	for _, credentials := range []struct {
		token  string
		status int
	}{{foreign, 404}, {device, 401}} {
		for _, operation := range []struct {
			method, path string
			body         any
		}{{"POST", "/api/transactions", input}, {"POST", path + "/ignore", map[string]any{"revision": 1}}, {"PUT", path, map[string]any{"revision": 1, "section": "daily", "category": "x", "amount": 1, "date": input["date"], "kind": "cash"}}} {
			if r := apiRequest(t, srv, credentials.token, operation.method, operation.path, operation.body); r.Code != credentials.status {
				t.Fatalf("ownership %s %d %s", operation.path, r.Code, r.Body)
			}
		}
	}
	for _, change := range []struct {
		key   string
		value any
	}{{"section", ""}, {"kind", "settlement"}, {"amount", 0}, {"amount", 1.001}, {"date", "2026-02-30"}} {
		old := input[change.key]
		input[change.key] = change.value
		if r := apiRequest(t, srv, token, "POST", "/api/transactions", input); r.Code != 400 {
			t.Fatalf("invalid %s: %d %s", change.key, r.Code, r.Body)
		}
		input[change.key] = old
	}
	if _, err := pool.Exec(context.Background(), `UPDATE sms_transaction_drafts SET currency='USD' WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if r := apiRequest(t, srv, token, "POST", "/api/transactions", input); r.Code != 409 {
		t.Fatalf("currency %d %s", r.Code, r.Body)
	}
	if r := apiRequest(t, srv, token, "POST", path+"/ignore", map[string]any{"revision": 1}); r.Code != 204 {
		t.Fatal(r.Body)
	}
	if r := apiRequest(t, srv, token, "POST", "/api/transactions", input); r.Code != 409 {
		t.Fatalf("ignored approval %d", r.Code)
	}
	var count int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM transactions WHERE user_id=$1`, owner).Scan(&count); err != nil || count != 0 {
		t.Fatalf("ledger %d %v", count, err)
	}
}
func TestSMSReviewConcurrentDecisions(t *testing.T) {
	for _, ignore := range []bool{false, true} {
		t.Run(fmt.Sprint(ignore), func(t *testing.T) {
			srv, pool, token, owner := setupCategoryAPITest(t)
			defer pool.Close()
			id, source, _, input := reviewFixture(t, srv, pool, token)
			start := make(chan struct{})
			codes := make(chan int, 2)
			var wg sync.WaitGroup
			for i := 0; i < 2; i++ {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					<-start
					path := "/api/transactions"
					var body any = input
					if i == 1 && ignore {
						path = "/api/sms/drafts/" + id.String() + "/ignore"
						body = map[string]any{"revision": 1}
					}
					codes <- apiRequest(t, srv, token, "POST", path, body).Code
				}(i)
			}
			close(start)
			wg.Wait()
			close(codes)
			success, conflicts := 0, 0
			for code := range codes {
				if code == 201 || code == 204 {
					success++
				} else if code == 409 {
					conflicts++
				} else {
					t.Fatalf("unexpected status %d", code)
				}
			}
			if success != 1 || conflicts != 1 {
				t.Fatalf("success %d conflicts %d", success, conflicts)
			}
			state, _, _ := sourceState(t, pool, source)
			want := 0
			if state == "approved" {
				want = 1
			}
			var count int
			if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM transactions WHERE user_id=$1`, owner).Scan(&count); err != nil || count != want {
				t.Fatalf("ledger %d want %d %v", count, want, err)
			}
		})
	}
}
func TestSMSReviewApprovalRollback(t *testing.T) {
	srv, pool, token, owner := setupCategoryAPITest(t)
	defer pool.Close()
	id, source, _, input := reviewFixture(t, srv, pool, token)
	if _, err := pool.Exec(context.Background(), `ALTER TABLE sms_suggestions ADD CONSTRAINT test_block_approval CHECK (status <> 'approved')`); err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(context.Background(), `ALTER TABLE sms_suggestions DROP CONSTRAINT test_block_approval`)
	if r := apiRequest(t, srv, token, "POST", "/api/transactions", input); r.Code != 500 {
		t.Fatalf("failure %d %s", r.Code, r.Body)
	}
	state, _, _ := sourceState(t, pool, source)
	if state != "pending_review" {
		t.Fatal(state)
	}
	var count, revision int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM transactions WHERE user_id=$1`, owner).Scan(&count); err != nil || count != 0 {
		t.Fatalf("ledger %d %v", count, err)
	}
	if err := pool.QueryRow(context.Background(), `SELECT revision FROM sms_transaction_drafts WHERE id=$1`, id).Scan(&revision); err != nil || revision != 1 {
		t.Fatalf("draft %d %v", revision, err)
	}
}
