package api

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestSMSIdentity(t *testing.T) {
	if got := normalizeSMSSender(" \tad-icicib\n"); got != "AD-ICICIB" {
		t.Fatal(got)
	}
	// Golden vector shared with Android, including UTF-8 and an embedded separator.
	const want = "627607c41b7a8a8935e6161c10dbdac6d489c12f849635cbc14c68905f0b338c"
	if got := smsFingerprint("AD-ICICIB", 1760000000123, "INR 100 debited | café"); got != want {
		t.Fatalf("fingerprint = %s", got)
	}
	for _, sender := range []string{"", "AD|ICICI", "AD ICICI", "银行"} {
		if validSMSSender(sender) {
			t.Fatalf("accepted sender %q", sender)
		}
	}
	if smsFingerprint("AD-ICICIB", 1760000000123, "paid") == smsFingerprint("AD-ICICIB", 1760000000124, "paid") {
		t.Fatal("different events collide")
	}
}

func TestSMSIngestion(t *testing.T) {
	srv, pool, webToken, owner := setupCategoryAPITest(t)
	defer pool.Close()
	ctx := context.Background()
	_, err := pool.Exec(ctx, `UPDATE sms_sender_config SET senders=ARRAY['AD-ICICIB'],version=version+1 WHERE id=true`)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `UPDATE sms_sender_config SET senders='{}',version=version+1 WHERE id=true`)
	})
	create := apiRequest(t, srv, webToken, "POST", "/api/sms/devices", map[string]any{"label": "Phone"})
	if create.Code != 201 {
		t.Fatalf("create %d %s", create.Code, create.Body)
	}
	var created struct {
		Token  string    `json:"token"`
		Device smsDevice `json:"device"`
	}
	_ = json.Unmarshal(create.Body.Bytes(), &created)
	token := created.Token
	if created.Device.Enabled {
		t.Fatal("enabled by default")
	}
	session := apiRequest(t, srv, token, "GET", "/api/sms/device/session", nil)
	if session.Code != 200 {
		t.Fatalf("session %d %s", session.Code, session.Body)
	}
	if got := apiRequest(t, srv, token, "GET", "/api/settings", nil).Code; got != 401 {
		t.Fatalf("device can access ledger: %d", got)
	}
	if got := apiRequest(t, srv, webToken, "GET", "/api/sms/device/session", nil).Code; got != 401 {
		t.Fatalf("JWT accepted as device token: %d", got)
	}
	consent := apiRequest(t, srv, token, "PUT", "/api/sms/device/consent", map[string]any{"enabled": true, "expected_version": 1})
	if consent.Code != 200 {
		t.Fatalf("consent %d %s", consent.Code, consent.Body)
	}
	var enabled smsDevice
	_ = json.Unmarshal(consent.Body.Bytes(), &enabled)
	date := time.Now().Add(-time.Hour).UnixMilli()
	msg := smsUploadMessage{FingerprintVersion: 1, Sender: "AD-ICICIB", ReceivedAt: date, Body: "INR 100 debited"}
	msg.Fingerprint = smsFingerprint(msg.Sender, msg.ReceivedAt, msg.Body)
	input := smsUploadInput{ConsentVersion: enabled.ConsentVersion, AllowlistVersion: 1, Messages: []smsUploadMessage{msg}}
	// Concurrent HTTP submissions must all acknowledge the same durable row.
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rr := apiRequest(t, srv, token, "POST", "/api/sms/device/uploads", input)
			if rr.Code != 200 {
				t.Errorf("upload %d %s", rr.Code, rr.Body)
			}
		}()
	}
	wg.Wait()
	var count int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM sms_suggestions WHERE user_id=$1`, owner).Scan(&count); err != nil || count != 1 {
		t.Fatalf("rows %d err %v", count, err)
	}
	var status string
	_ = pool.QueryRow(ctx, `SELECT status FROM sms_suggestions WHERE user_id=$1`, owner).Scan(&status)
	if status != "queued" {
		t.Fatal("unexpected AI processing", status)
	}
	// Same fingerprint in another account is independent; metadata stays owner-scoped.
	foreign := signedTestToken(t, uuid.New())
	second := apiRequest(t, srv, foreign, "POST", "/api/sms/devices", map[string]any{"label": "Other owner"})
	var otherDevice struct {
		Token string `json:"token"`
	}
	if second.Code != 201 || json.Unmarshal(second.Body.Bytes(), &otherDevice) != nil {
		t.Fatalf("second device %d", second.Code)
	}
	if got := apiRequest(t, srv, otherDevice.Token, "PUT", "/api/sms/device/consent", map[string]any{"enabled": true, "expected_version": 1}).Code; got != 200 {
		t.Fatalf("other consent %d", got)
	}
	if got := apiRequest(t, srv, otherDevice.Token, "POST", "/api/sms/device/uploads", input).Code; got != 200 {
		t.Fatalf("other upload %d", got)
	}
	var total int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM sms_suggestions`).Scan(&total); err != nil || total != 2 {
		t.Fatalf("account scoped rows %d %v", total, err)
	}
	listed := apiRequest(t, srv, webToken, "GET", "/api/sms/devices", nil)
	var devices []smsDevice
	if listed.Code != 200 || json.Unmarshal(listed.Body.Bytes(), &devices) != nil || len(devices) != 1 || devices[0].UserID != owner {
		t.Fatalf("device isolation %d %s", listed.Code, listed.Body)
	}
	// A malformed body/fingerprint fails before any partial batch can commit.
	bad := input
	bad.Messages = []smsUploadMessage{msg, msg}
	bad.Messages[1].Body = "tampered"
	if got := apiRequest(t, srv, token, "POST", "/api/sms/device/uploads", bad).Code; got != 400 {
		t.Fatalf("invalid hash %d", got)
	}
	// Global removal blocks a new message even if a client has a stale cache.
	_, _ = pool.Exec(ctx, `UPDATE sms_sender_config SET senders='{}',version=version+1 WHERE id=true`)
	other := msg
	other.ReceivedAt++
	other.Fingerprint = smsFingerprint(other.Sender, other.ReceivedAt, other.Body)
	input.Messages = []smsUploadMessage{other}
	skipped := apiRequest(t, srv, token, "POST", "/api/sms/device/uploads", input)
	if skipped.Code != 200 {
		t.Fatalf("skip %d %s", skipped.Code, skipped.Body)
	}
	var result struct {
		Receipts []smsReceipt `json:"receipts"`
	}
	_ = json.Unmarshal(skipped.Body.Bytes(), &result)
	if len(result.Receipts) != 1 || result.Receipts[0].Status != "sender_not_allowed" {
		t.Fatalf("receipts %+v", result)
	}
	// Foreign-account device revocation must fail.
	if got := apiRequest(t, srv, foreign, "DELETE", "/api/sms/devices/"+created.Device.ID.String(), nil).Code; got != 404 {
		t.Fatalf("foreign revoke %d", got)
	}
	disabled := apiRequest(t, srv, token, "PUT", "/api/sms/device/consent", map[string]any{"enabled": false, "expected_version": enabled.ConsentVersion})
	if disabled.Code != 200 {
		t.Fatalf("disable %d %s", disabled.Code, disabled.Body)
	}
	if got := apiRequest(t, srv, token, "POST", "/api/sms/device/uploads", input).Code; got != 409 {
		t.Fatalf("disabled upload %d", got)
	}
	var body *string
	if err = pool.QueryRow(ctx, `SELECT status,body FROM sms_suggestions WHERE user_id=$1`, owner).Scan(&status, &body); err != nil || status != "cancelled" || body != nil {
		t.Fatalf("cancel %s %v %v", status, body, err)
	}
	// A stale consent request cannot revive work after disable, even a repeated disable.
	if got := apiRequest(t, srv, token, "PUT", "/api/sms/device/consent", map[string]any{"enabled": true, "expected_version": enabled.ConsentVersion}).Code; got != 409 {
		t.Fatalf("stale enable accepted: %d", got)
	}
	// Retention clears old raw payloads but preserves the deduplication row.
	_, err = pool.Exec(ctx, `UPDATE sms_suggestions SET body='expired fixture',sender='AD-ICICIB',received_at=$2,status='queued',created_at=now()-interval '8 days' WHERE user_id=$1`, owner, date)
	if err != nil {
		t.Fatal(err)
	}
	if err = srv.expireSMSPayloads(ctx); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(ctx, `SELECT status,body FROM sms_suggestions WHERE user_id=$1`, owner).Scan(&status, &body); err != nil || status != "cancelled" || body != nil {
		t.Fatalf("retention %s %v %v", status, body, err)
	}
	// Revocation also invalidates session/config access, not just ingestion.
	if got := apiRequest(t, srv, webToken, "DELETE", "/api/sms/devices/"+created.Device.ID.String(), nil).Code; got != 204 {
		t.Fatalf("revoke %d", got)
	}
	if got := apiRequest(t, srv, token, "GET", "/api/sms/device/senders", nil).Code; got != http.StatusUnauthorized {
		t.Fatalf("revoked token %d", got)
	}
}
