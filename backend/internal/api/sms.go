package api

// SMS ingestion deliberately has no AI worker. sms_suggestions rows are durable
// jobs for the next phase; accepting a row never writes a ledger transaction.
import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type smsDevice struct {
	ID             uuid.UUID  `json:"id"`
	UserID         uuid.UUID  `json:"user_id"`
	Label          string     `json:"label"`
	Enabled        bool       `json:"enabled"`
	ConsentVersion int64      `json:"consent_version"`
	RevokedAt      *time.Time `json:"revoked_at"`
	CreatedAt      time.Time  `json:"created_at"`
	LastUploadAt   *time.Time `json:"last_upload_at"`
	LastScanEnd    *int64     `json:"last_scan_end"`
}

const smsDeviceColumns = `id,user_id,label,enabled,consent_version,revoked_at,created_at,last_upload_at,last_scan_end`

func scanSMSDevice(row pgx.Row) (d smsDevice, err error) {
	err = row.Scan(&d.ID, &d.UserID, &d.Label, &d.Enabled, &d.ConsentVersion, &d.RevokedAt, &d.CreatedAt, &d.LastUploadAt, &d.LastScanEnd)
	return
}
func smsTokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// ASCII-only normalization is shared with Android. No prefix stripping or fuzzy matching.
func normalizeSMSSender(sender string) string {
	return strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' {
			return r - 32
		}
		return r
	}, strings.Trim(sender, " \t\r\n"))
}
func smsFingerprint(sender string, receivedAt int64, body string) string {
	sum := sha256.Sum256([]byte("v1|" + sender + "|" + strconv.FormatInt(receivedAt, 10) + "|" + body))
	return hex.EncodeToString(sum[:])
}
func validSMSSender(sender string) bool {
	if len(sender) == 0 || len(sender) > 80 {
		return false
	}
	for _, r := range sender {
		if r < 33 || r > 126 || r == '|' {
			return false
		}
	}
	return true
}

func (s *Server) handleListSMSDevices(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	rows, err := s.pool.Query(r.Context(), `SELECT `+smsDeviceColumns+` FROM sms_devices WHERE user_id=$1 ORDER BY created_at DESC`, userID(r))
	if err != nil {
		writeErr(w, 500, "could not load SMS devices")
		return
	}
	defer rows.Close()
	out := []smsDevice{}
	for rows.Next() {
		d, err := scanSMSDevice(rows)
		if err != nil {
			writeErr(w, 500, "could not load SMS devices")
			return
		}
		out = append(out, d)
	}
	if rows.Err() != nil {
		writeErr(w, 500, "could not load SMS devices")
		return
	}
	writeJSON(w, 200, out)
}
func (s *Server) handleCreateSMSDevice(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	r.Body = http.MaxBytesReader(w, r.Body, 1024)
	var in struct {
		Label string `json:"label"`
	}
	if readJSON(r, &in) != nil || len(strings.TrimSpace(in.Label)) == 0 || len(in.Label) > 80 {
		writeErr(w, 400, "provide a device label of 1–80 characters")
		return
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		writeErr(w, 500, "could not create token")
		return
	}
	token := "sms_" + hex.EncodeToString(secret)
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeErr(w, 500, "could not create device")
		return
	}
	defer tx.Rollback(r.Context())
	// Lock the owner to serialize the device-count limit across concurrent creation.
	if _, err = tx.Exec(r.Context(), `SELECT id FROM users WHERE id=$1 FOR UPDATE`, userID(r)); err != nil {
		writeErr(w, 500, "could not create device")
		return
	}
	var count int
	if err = tx.QueryRow(r.Context(), `SELECT count(*) FROM sms_devices WHERE user_id=$1 AND revoked_at IS NULL`, userID(r)).Scan(&count); err != nil {
		writeErr(w, 500, "could not create device")
		return
	}
	if count >= 10 {
		writeErr(w, 409, "revoke an existing SMS device before adding another")
		return
	}
	d, err := scanSMSDevice(tx.QueryRow(r.Context(), `INSERT INTO sms_devices(user_id,label,token_hash) VALUES($1,$2,$3) RETURNING `+smsDeviceColumns, userID(r), strings.TrimSpace(in.Label), smsTokenHash(token)))
	if err != nil || tx.Commit(r.Context()) != nil {
		writeErr(w, 500, "could not create device")
		return
	}
	writeJSON(w, 201, map[string]any{"device": d, "token": token})
}
func (s *Server) handleRevokeSMSDevice(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, 400, "invalid device id")
		return
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeErr(w, 500, "could not revoke device")
		return
	}
	defer tx.Rollback(r.Context())
	tag, err := tx.Exec(r.Context(), `UPDATE sms_devices SET revoked_at=COALESCE(revoked_at,now()), enabled=false,consent_version=consent_version+1 WHERE id=$1 AND user_id=$2`, id, userID(r))
	if err != nil {
		writeErr(w, 500, "could not revoke device")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, 404, "device not found")
		return
	}
	if err = cancelSMSRows(r.Context(), tx, id); err != nil || tx.Commit(r.Context()) != nil {
		writeErr(w, 500, "could not revoke device")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func cancelSMSRows(ctx context.Context, tx pgx.Tx, device uuid.UUID) error {
	_, err := tx.Exec(ctx, `UPDATE sms_suggestions SET status='cancelled',body=NULL,sender=NULL,received_at=NULL,
 verification=NULL,claim_token=NULL,claimed_at=NULL,updated_at=now()
 WHERE device_id=$1 AND status IN ('queued','verifying','classified','extracting','failed')`, device)
	return err
}

type smsHTTPError struct {
	code    int
	message string
}

func (e smsHTTPError) Error() string { return e.message }
func smsBad(message string) error    { return smsHTTPError{400, message} }

type smsDeviceAction func(context.Context, pgx.Tx, smsDevice, *http.Request) (any, error)

// These endpoints accept ONLY opaque device tokens, never web JWTs. Locking the
// device row makes acceptance, consent updates and revocation mutually exclusive.
func (s *Server) smsDeviceEndpoint(action smsDeviceAction) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		r = r.WithContext(ctx)
		r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
		raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if len(raw) != 68 || !strings.HasPrefix(raw, "sms_") {
			writeErr(w, 401, "invalid SMS device token")
			return
		}
		tx, err := s.pool.Begin(ctx)
		if err != nil {
			writeErr(w, 503, "SMS service unavailable")
			return
		}
		defer tx.Rollback(ctx)
		d, err := scanSMSDevice(tx.QueryRow(ctx, `SELECT `+smsDeviceColumns+` FROM sms_devices WHERE token_hash=$1 AND revoked_at IS NULL FOR UPDATE`, smsTokenHash(raw)))
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, 401, "invalid or revoked SMS device token")
			return
		}
		if err != nil {
			writeErr(w, 503, "SMS service unavailable")
			return
		}
		result, err := action(ctx, tx, d, r)
		if err != nil {
			var apiErr smsHTTPError
			if errors.As(err, &apiErr) {
				writeErr(w, apiErr.code, apiErr.message)
			} else {
				writeErr(w, 503, "SMS service unavailable")
			}
			return
		}
		if err = tx.Commit(ctx); err != nil {
			writeErr(w, 503, "SMS acceptance not confirmed; retry safely")
			return
		}
		writeJSON(w, 200, result)
	}
}
func smsSession(_ context.Context, _ pgx.Tx, d smsDevice, _ *http.Request) (any, error) {
	return d, nil
}
func smsConsent(ctx context.Context, tx pgx.Tx, d smsDevice, r *http.Request) (any, error) {
	var in struct {
		Enabled         *bool `json:"enabled"`
		ExpectedVersion int64 `json:"expected_version"`
	}
	if readJSON(r, &in) != nil || in.Enabled == nil {
		return nil, smsBad("enabled and expected_version are required")
	}
	if in.ExpectedVersion != d.ConsentVersion {
		return nil, smsHTTPError{409, "consent changed; reload device state"}
	}
	// Even a repeated disable advances the fence against an in-flight enable.
	if d.Enabled != *in.Enabled || !*in.Enabled {
		d.Enabled = *in.Enabled
		d.ConsentVersion++
		if _, err := tx.Exec(ctx, `UPDATE sms_devices SET enabled=$2,consent_version=$3 WHERE id=$1`, d.ID, d.Enabled, d.ConsentVersion); err != nil {
			return nil, err
		}
		if !d.Enabled {
			if err := cancelSMSRows(ctx, tx, d.ID); err != nil {
				return nil, err
			}
		}
	}
	return d, nil
}

type smsSenderConfig struct {
	Version int64    `json:"version"`
	Senders []string `json:"senders"`
}

func smsConfig(ctx context.Context, tx pgx.Tx, _ smsDevice, _ *http.Request) (any, error) {
	return loadSMSConfig(ctx, tx)
}
func loadSMSConfig(ctx context.Context, tx pgx.Tx) (smsSenderConfig, error) {
	var out smsSenderConfig
	err := tx.QueryRow(ctx, `SELECT version,senders FROM sms_sender_config WHERE id=true FOR SHARE`).Scan(&out.Version, &out.Senders)
	return out, err
}

type smsUploadMessage struct {
	FingerprintVersion int    `json:"fingerprint_version"`
	Fingerprint        string `json:"fingerprint"`
	Sender             string `json:"sender"`
	ReceivedAt         int64  `json:"received_at"`
	Body               string `json:"body"`
}
type smsUploadInput struct {
	ConsentVersion   int64              `json:"consent_version"`
	AllowlistVersion int64              `json:"allowlist_version"`
	Messages         []smsUploadMessage `json:"messages"`
	// Set only after ALL messages in the scanned range have been acknowledged.
	ScanEnd *int64 `json:"scan_end"`
}
type smsReceipt struct {
	Fingerprint string     `json:"fingerprint"`
	ID          *uuid.UUID `json:"id"`
	Status      string     `json:"status"`
}

func validateSMSMessage(m smsUploadMessage, now time.Time) error {
	if m.FingerprintVersion != 1 || !validSMSSender(m.Sender) || normalizeSMSSender(m.Sender) != m.Sender || len(m.Body) == 0 || len(m.Body) > 16384 || strings.ContainsRune(m.Body, 0) {
		return smsBad("invalid SMS fields")
	}
	if m.ReceivedAt < 946684800000 || m.ReceivedAt > now.Add(5*time.Minute).UnixMilli() {
		return smsBad("invalid SMS timestamp")
	}
	if m.Fingerprint != smsFingerprint(m.Sender, m.ReceivedAt, m.Body) {
		return smsBad("fingerprint does not match SMS fields")
	}
	return nil
}
func (s *Server) smsUpload(ctx context.Context, tx pgx.Tx, d smsDevice, r *http.Request) (any, error) {
	var in smsUploadInput
	if readJSON(r, &in) != nil || in.AllowlistVersion < 1 || len(in.Messages) > 100 {
		return nil, smsBad("invalid upload; maximum 100 messages")
	}
	if !d.Enabled || in.ConsentVersion != d.ConsentVersion {
		return nil, smsHTTPError{409, "SMS import disabled or consent changed"}
	}
	now := s.now()
	if in.ScanEnd != nil && (*in.ScanEnd < 946684800000 || *in.ScanEnd > now.Add(5*time.Minute).UnixMilli()) {
		return nil, smsBad("invalid scan end")
	}
	for _, m := range in.Messages {
		if err := validateSMSMessage(m, now); err != nil {
			return nil, err
		}
	}
	cfg, err := loadSMSConfig(ctx, tx)
	if err != nil {
		return nil, err
	}
	allowed := map[string]bool{}
	for _, sender := range cfg.Senders {
		allowed[normalizeSMSSender(sender)] = true
	}
	// Bound the unprocessed backlog while AI processing is deliberately disabled.
	var backlog int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM sms_suggestions WHERE device_id=$1 AND status IN ('queued','verifying','classified','extracting','failed')`, d.ID).Scan(&backlog); err != nil {
		return nil, err
	}
	receipts := make([]smsReceipt, 0, len(in.Messages))
	for _, m := range in.Messages {
		receipt := smsReceipt{Fingerprint: m.Fingerprint, Status: "sender_not_allowed"}
		if allowed[m.Sender] {
			// Insert and job creation are the same operation. A conflict is an existing job,
			// not a reason to reset its status or run AI again.
			var id uuid.UUID
			var status string
			err = tx.QueryRow(ctx, `INSERT INTO sms_suggestions(user_id,device_id,consent_version,fingerprint_version,fingerprint,sender,received_at,body,allowlist_version)
     VALUES($1,$2,$3,1,$4,$5,$6,$7,$8) ON CONFLICT(user_id,fingerprint_version,fingerprint) DO NOTHING RETURNING id,status`, d.UserID, d.ID, d.ConsentVersion, m.Fingerprint, m.Sender, m.ReceivedAt, m.Body, cfg.Version).Scan(&id, &status)
			if errors.Is(err, pgx.ErrNoRows) {
				err = tx.QueryRow(ctx, `SELECT id,status FROM sms_suggestions WHERE user_id=$1 AND fingerprint_version=1 AND fingerprint=$2`, d.UserID, m.Fingerprint).Scan(&id, &status)
			} else if err == nil {
				backlog++
				if backlog > 5000 {
					return nil, smsHTTPError{429, "SMS backlog full; retry after processing or cleanup"}
				}
			}
			if err != nil {
				return nil, err
			}
			receipt.ID = &id
			receipt.Status = status
		}
		receipts = append(receipts, receipt)
	}
	_, err = tx.Exec(ctx, `UPDATE sms_devices SET last_upload_at=now(),last_scan_end=CASE WHEN $2::bigint IS NULL THEN last_scan_end ELSE GREATEST(last_scan_end,$2::bigint) END WHERE id=$1`, d.ID, in.ScanEnd)
	if err != nil {
		return nil, fmt.Errorf("sync metadata: %w", err)
	}
	return map[string]any{"receipts": receipts, "allowlist_version": cfg.Version}, nil
}
