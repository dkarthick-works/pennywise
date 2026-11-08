package api

import (
	"context"
	"encoding/json"
	"testing"
)

func TestSMSReviewDuplicateWarningAndFailureFiltering(t *testing.T) {
	srv, pool, token, _ := setupCategoryAPITest(t)
	defer pool.Close()
	_, source, _, input := reviewFixture(t, srv, pool, token)
	assertDuplicate := func(want bool) {
		t.Helper()
		r := apiRequest(t, srv, token, "GET", "/api/sms/drafts", nil)
		var result struct {
			Drafts []struct {
				PossibleDuplicate bool `json:"possible_duplicate"`
			} `json:"drafts"`
		}
		if r.Code != 200 || json.Unmarshal(r.Body.Bytes(), &result) != nil || len(result.Drafts) != 1 || result.Drafts[0].PossibleDuplicate != want {
			t.Fatalf("duplicates %d %s", r.Code, r.Body)
		}
	}
	assertDuplicate(false)
	// A manual entry with a different name still warrants a date/amount warning.
	manual := map[string]any{"section": "daily", "category": "Manual purchase", "amount": 125.5, "date": input["date"], "kind": "cash"}
	if r := apiRequest(t, srv, token, "POST", "/api/transactions", manual); r.Code != 201 {
		t.Fatal(r.Body)
	}
	assertDuplicate(true)
	_, err := pool.Exec(context.Background(), `INSERT INTO sms_suggestions(user_id,device_id,consent_version,fingerprint_version,fingerprint,allowlist_version,status)
 SELECT s.user_id,s.device_id,s.consent_version,1,md5(n::text)||md5(n::text),s.allowlist_version,'rejected'
 FROM sms_suggestions s CROSS JOIN generate_series(1,105) n WHERE s.id=$1`, source)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(context.Background(), `UPDATE sms_suggestions SET status='failed',failed_stage='extraction',created_at=now()-interval '2 days' WHERE id=$1`, source); err != nil {
		t.Fatal(err)
	}
	r := apiRequest(t, srv, token, "GET", "/api/sms/jobs?status=failed", nil)
	var jobs []struct {
		ID string `json:"id"`
	}
	if r.Code != 200 || json.Unmarshal(r.Body.Bytes(), &jobs) != nil || len(jobs) != 1 || jobs[0].ID != source.String() {
		t.Fatalf("older failure missing: %d %s", r.Code, r.Body)
	}
	for _, path := range []string{"/api/sms/jobs?offset=-1", "/api/sms/jobs?status=anything", "/api/sms/drafts?offset=-1"} {
		if r := apiRequest(t, srv, token, "GET", path, nil); r.Code != 400 {
			t.Fatalf("invalid pagination/filter %s %d", path, r.Code)
		}
	}
}
