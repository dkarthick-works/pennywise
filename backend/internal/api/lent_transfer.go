package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ledger/backend/internal/db"
)

const (
	lentArchiveType      = "pennywise-lents"
	lentArchiveVersion   = 1
	maxLentArchiveBytes  = int64(25 * 1024 * 1024)
	maxLentArchiveLents  = int64(10_000)
	maxLentArchiveRepaid = int64(50_000)
	maxRepaymentsPerLent = 500
	maxLentArchiveCents  = int64(999_999_999_999_99)
)

var (
	errLentArchiveLimit = errors.New("lent archive exceeds a portable limit")
	archiveDatePattern  = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	archiveMoneyPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$`)
)

type lentTransferArchive struct {
	Type       string             `json:"type"`
	Version    int                `json:"version"`
	ExportedAt string             `json:"exported_at"`
	Lents      []lentTransferLent `json:"lents"`
}

type lentTransferLent struct {
	SourceID     string                  `json:"source_id"`
	Counterparty string                  `json:"counterparty"`
	Amount       string                  `json:"amount"`
	LentOn       string                  `json:"lent_on"`
	DueOn        *string                 `json:"due_on"`
	Note         string                  `json:"note"`
	Repayments   []lentTransferRepayment `json:"repayments"`
}

type lentTransferRepayment struct {
	SourceID string `json:"source_id"`
	Amount   string `json:"amount"`
	RepaidOn string `json:"repaid_on"`
	Note     string `json:"note"`
}

type lentTransferResult struct {
	ImportedLents      int `json:"imported_lents"`
	ImportedRepayments int `json:"imported_repayments"`
}

func (a *lentTransferArchive) UnmarshalJSON(data []byte) error {
	fields, err := archiveObject(data, "archive")
	if err != nil {
		return err
	}
	if err := rejectUnknownArchiveFields(fields, map[string]struct{}{
		"type": {}, "version": {}, "exported_at": {}, "lents": {},
	}); err != nil {
		return err
	}

	var archive lentTransferArchive
	if err := requiredArchiveField(fields, "type", &archive.Type); err != nil {
		return err
	}
	if err := requiredArchiveField(fields, "version", &archive.Version); err != nil {
		return err
	}
	if err := requiredArchiveField(fields, "exported_at", &archive.ExportedAt); err != nil {
		return err
	}
	if err := requiredArchiveField(fields, "lents", &archive.Lents); err != nil {
		return err
	}
	*a = archive
	return nil
}

func (l *lentTransferLent) UnmarshalJSON(data []byte) error {
	fields, err := archiveObject(data, "lent")
	if err != nil {
		return err
	}
	if err := rejectUnknownArchiveFields(fields, map[string]struct{}{
		"source_id": {}, "counterparty": {}, "amount": {}, "lent_on": {},
		"due_on": {}, "note": {}, "repayments": {},
	}); err != nil {
		return err
	}

	var lent lentTransferLent
	if err := requiredArchiveField(fields, "source_id", &lent.SourceID); err != nil {
		return err
	}
	if err := requiredArchiveField(fields, "counterparty", &lent.Counterparty); err != nil {
		return err
	}
	if err := requiredArchiveField(fields, "amount", &lent.Amount); err != nil {
		return err
	}
	if err := requiredArchiveField(fields, "lent_on", &lent.LentOn); err != nil {
		return err
	}
	dueOn, err := requiredNullableArchiveString(fields, "due_on")
	if err != nil {
		return err
	}
	lent.DueOn = dueOn
	if err := requiredArchiveField(fields, "note", &lent.Note); err != nil {
		return err
	}
	if err := requiredArchiveField(fields, "repayments", &lent.Repayments); err != nil {
		return err
	}
	*l = lent
	return nil
}

func (r *lentTransferRepayment) UnmarshalJSON(data []byte) error {
	fields, err := archiveObject(data, "repayment")
	if err != nil {
		return err
	}
	if err := rejectUnknownArchiveFields(fields, map[string]struct{}{
		"source_id": {}, "amount": {}, "repaid_on": {}, "note": {},
	}); err != nil {
		return err
	}

	var repayment lentTransferRepayment
	if err := requiredArchiveField(fields, "source_id", &repayment.SourceID); err != nil {
		return err
	}
	if err := requiredArchiveField(fields, "amount", &repayment.Amount); err != nil {
		return err
	}
	if err := requiredArchiveField(fields, "repaid_on", &repayment.RepaidOn); err != nil {
		return err
	}
	if err := requiredArchiveField(fields, "note", &repayment.Note); err != nil {
		return err
	}
	*r = repayment
	return nil
}

func archiveObject(data []byte, name string) (map[string]json.RawMessage, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil || fields == nil {
		return nil, fmt.Errorf("%s must be a JSON object", name)
	}
	return fields, nil
}

func rejectUnknownArchiveFields(fields map[string]json.RawMessage, allowed map[string]struct{}) error {
	for name := range fields {
		if _, ok := allowed[name]; !ok {
			return fmt.Errorf("unknown archive field %q", name)
		}
	}
	return nil
}

func requiredArchiveField(fields map[string]json.RawMessage, name string, dst any) error {
	raw, ok := fields[name]
	if !ok {
		return fmt.Errorf("%s is required", name)
	}
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return fmt.Errorf("%s cannot be null", name)
	}
	if err := json.Unmarshal(raw, dst); err != nil {
		return fmt.Errorf("%s: %w", name, err)
	}
	return nil
}

func requiredNullableArchiveString(fields map[string]json.RawMessage, name string) (*string, error) {
	raw, ok := fields[name]
	if !ok {
		return nil, fmt.Errorf("%s is required", name)
	}
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil, nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, fmt.Errorf("%s must be a string or null", name)
	}
	return &value, nil
}

func decodeLentTransferArchive(w http.ResponseWriter, r *http.Request) (lentTransferArchive, error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxLentArchiveBytes)
	decoder := json.NewDecoder(r.Body)

	var raw json.RawMessage
	if err := decoder.Decode(&raw); err != nil {
		return lentTransferArchive{}, normalizeArchiveDecodeError(err)
	}

	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return lentTransferArchive{}, errors.New("archive contains trailing JSON")
		}
		return lentTransferArchive{}, normalizeArchiveDecodeError(err)
	}

	var archive lentTransferArchive
	if err := json.Unmarshal(raw, &archive); err != nil {
		return lentTransferArchive{}, fmt.Errorf("invalid archive: %w", err)
	}
	return archive, nil
}

func normalizeArchiveDecodeError(err error) error {
	var maxBytesErr *http.MaxBytesError
	if errors.As(err, &maxBytesErr) {
		return fmt.Errorf("%w: archive exceeds maximum size of 25 MiB", errLentArchiveLimit)
	}
	return errors.New("invalid archive JSON")
}

func validateAndNormalizeLentArchive(archive *lentTransferArchive) error {
	if archive.Type != lentArchiveType {
		return fmt.Errorf("archive type must be %q", lentArchiveType)
	}
	if archive.Version != lentArchiveVersion {
		return fmt.Errorf("unsupported archive version %d", archive.Version)
	}
	if !strings.HasSuffix(archive.ExportedAt, "Z") {
		return errors.New("exported_at must be RFC3339 UTC")
	}
	if _, err := time.Parse(time.RFC3339, archive.ExportedAt); err != nil {
		return errors.New("exported_at must be RFC3339 UTC")
	}
	if int64(len(archive.Lents)) > maxLentArchiveLents {
		return fmt.Errorf("%w: archive exceeds maximum of %d lents", errLentArchiveLimit, maxLentArchiveLents)
	}

	lentIDs := make(map[uuid.UUID]struct{}, len(archive.Lents))
	repaymentIDs := make(map[uuid.UUID]struct{})
	totalRepayments := int64(0)

	for lentIndex := range archive.Lents {
		lent := &archive.Lents[lentIndex]
		sourceID, err := uuid.Parse(lent.SourceID)
		if err != nil {
			return fmt.Errorf("lents[%d].source_id must be a UUID", lentIndex)
		}
		if _, exists := lentIDs[sourceID]; exists {
			return fmt.Errorf("duplicate lent source_id %q", lent.SourceID)
		}
		lentIDs[sourceID] = struct{}{}

		lent.Counterparty = strings.TrimSpace(lent.Counterparty)
		if lent.Counterparty == "" {
			return fmt.Errorf("lents[%d].counterparty is required", lentIndex)
		}
		lentCents, err := parseLentArchiveMoney(lent.Amount)
		if err != nil {
			return fmt.Errorf("lents[%d].amount %w", lentIndex, err)
		}
		lent.Amount = formatLentArchiveCents(lentCents)

		lentDate, err := parseLentArchiveDate(lent.LentOn)
		if err != nil {
			return fmt.Errorf("lents[%d].lent_on must be YYYY-MM-DD", lentIndex)
		}
		if lent.DueOn != nil {
			dueDate, err := parseLentArchiveDate(*lent.DueOn)
			if err != nil {
				return fmt.Errorf("lents[%d].due_on must be YYYY-MM-DD or null", lentIndex)
			}
			if dueDate.Before(lentDate) {
				return fmt.Errorf("lents[%d].due_on cannot be before lent_on", lentIndex)
			}
		}

		if len(lent.Repayments) > maxRepaymentsPerLent {
			return fmt.Errorf("%w: a lent cannot contain more than %d repayments", errLentArchiveLimit, maxRepaymentsPerLent)
		}
		totalRepayments += int64(len(lent.Repayments))
		if totalRepayments > maxLentArchiveRepaid {
			return fmt.Errorf("%w: archive exceeds maximum of %d repayments", errLentArchiveLimit, maxLentArchiveRepaid)
		}

		var repaidCents int64
		for repaymentIndex := range lent.Repayments {
			repayment := &lent.Repayments[repaymentIndex]
			repaymentID, err := uuid.Parse(repayment.SourceID)
			if err != nil {
				return fmt.Errorf("lents[%d].repayments[%d].source_id must be a UUID", lentIndex, repaymentIndex)
			}
			if _, exists := repaymentIDs[repaymentID]; exists {
				return fmt.Errorf("duplicate repayment source_id %q", repayment.SourceID)
			}
			repaymentIDs[repaymentID] = struct{}{}

			repaymentCents, err := parseLentArchiveMoney(repayment.Amount)
			if err != nil {
				return fmt.Errorf("lents[%d].repayments[%d].amount %w", lentIndex, repaymentIndex, err)
			}
			repayment.Amount = formatLentArchiveCents(repaymentCents)
			if _, err := parseLentArchiveDate(repayment.RepaidOn); err != nil {
				return fmt.Errorf("lents[%d].repayments[%d].repaid_on must be YYYY-MM-DD", lentIndex, repaymentIndex)
			}
			if repaidCents > maxLentArchiveCents-repaymentCents {
				return fmt.Errorf("lents[%d] repayments exceed the supported money limit", lentIndex)
			}
			repaidCents += repaymentCents
		}
		if repaidCents > lentCents {
			return fmt.Errorf("lents[%d] repayments exceed the outstanding balance", lentIndex)
		}
	}
	return nil
}

func parseLentArchiveMoney(value string) (int64, error) {
	if !archiveMoneyPattern.MatchString(value) {
		return 0, errors.New("must be a positive decimal with at most two fractional digits")
	}
	wholeText, fractionText, hasFraction := strings.Cut(value, ".")
	whole, err := strconv.ParseInt(wholeText, 10, 64)
	if err != nil {
		return 0, errors.New("is too large")
	}
	var fraction int64
	if hasFraction {
		if len(fractionText) == 1 {
			fraction = int64(fractionText[0]-'0') * 10
		} else {
			fraction, _ = strconv.ParseInt(fractionText, 10, 64)
		}
	}
	if whole > (maxLentArchiveCents-fraction)/100 {
		return 0, errors.New("exceeds the maximum supported amount")
	}
	cents := whole*100 + fraction
	if cents <= 0 {
		return 0, errors.New("must be greater than zero")
	}
	return cents, nil
}

func formatLentArchiveCents(cents int64) string {
	return fmt.Sprintf("%d.%02d", cents/100, cents%100)
}

func parseLentArchiveDate(value string) (time.Time, error) {
	if !archiveDatePattern.MatchString(value) {
		return time.Time{}, errors.New("invalid date")
	}
	return time.Parse("2006-01-02", value)
}

func lentArchiveNumericToCents(n pgtype.Numeric) (int64, error) {
	if !n.Valid || n.NaN || n.Int == nil {
		return 0, errors.New("invalid stored money")
	}
	scaled := new(big.Int).Set(n.Int)
	if n.Exp >= -2 {
		factor := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(n.Exp+2)), nil)
		scaled.Mul(scaled, factor)
	} else {
		divisor := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(-n.Exp-2)), nil)
		remainder := new(big.Int)
		remainder.Mod(scaled, divisor)
		if remainder.Sign() != 0 {
			return 0, errors.New("stored money has more than two fractional digits")
		}
		scaled.Quo(scaled, divisor)
	}
	if !scaled.IsInt64() {
		return 0, errors.New("stored money is too large")
	}
	cents := scaled.Int64()
	if cents <= 0 || cents > maxLentArchiveCents {
		return 0, errors.New("stored money is outside the supported range")
	}
	return cents, nil
}

func lentArchiveCentsToNumeric(cents int64) (pgtype.Numeric, error) {
	var n pgtype.Numeric
	if err := n.Scan(formatLentArchiveCents(cents)); err != nil {
		return n, err
	}
	return n, nil
}

type cappedLentArchiveBuffer struct {
	bytes.Buffer
}

func (b *cappedLentArchiveBuffer) Write(p []byte) (int, error) {
	if int64(b.Len())+int64(len(p)) > maxLentArchiveBytes {
		return 0, errLentArchiveLimit
	}
	return b.Buffer.Write(p)
}

func (s *Server) handleExportLents(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{
		IsoLevel:   pgx.RepeatableRead,
		AccessMode: pgx.ReadOnly,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not export lents")
		return
	}
	defer tx.Rollback(ctx)
	qtx := s.q.WithTx(tx)
	uid := userID(r)

	preflight, err := qtx.LentTransferPreflight(ctx, uid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not export lents")
		return
	}
	if preflight.LentCount > maxLentArchiveLents {
		writeErr(w, http.StatusRequestEntityTooLarge, "archive exceeds maximum of 10000 lents")
		return
	}
	if preflight.RepaymentCount > maxLentArchiveRepaid {
		writeErr(w, http.StatusRequestEntityTooLarge, "archive exceeds maximum of 50000 repayments")
		return
	}
	if preflight.MaxRepaymentsPerLent > maxRepaymentsPerLent {
		writeErr(w, http.StatusRequestEntityTooLarge, "a lent exceeds the maximum of 500 repayments")
		return
	}
	if preflight.TextBytes > maxLentArchiveBytes {
		writeErr(w, http.StatusRequestEntityTooLarge, "archive text content exceeds maximum size of 25 MiB")
		return
	}

	parents, err := qtx.ListLentsForTransfer(ctx, uid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not export lents")
		return
	}
	repayments, err := qtx.ListRepaymentsForTransfer(ctx, uid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not export lents")
		return
	}
	archive, err := buildLentTransferArchive(parents, repayments)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not export lents")
		return
	}

	var encoded cappedLentArchiveBuffer
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(archive); err != nil {
		if errors.Is(err, errLentArchiveLimit) {
			writeErr(w, http.StatusRequestEntityTooLarge, "archive exceeds maximum size of 25 MiB")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not export lents")
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not export lents")
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="pennywise-lents-v1.json"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(encoded.Bytes())
}

func buildLentTransferArchive(parents []db.ListLentsForTransferRow, repayments []db.ListRepaymentsForTransferRow) (lentTransferArchive, error) {
	repsByLent := make(map[uuid.UUID][]lentTransferRepayment, len(parents))
	for _, repayment := range repayments {
		cents, err := lentArchiveNumericToCents(repayment.Amount)
		if err != nil {
			return lentTransferArchive{}, err
		}
		repsByLent[repayment.LentID] = append(repsByLent[repayment.LentID], lentTransferRepayment{
			SourceID: repayment.ID.String(),
			Amount:   formatLentArchiveCents(cents),
			RepaidOn: dateToString(repayment.RepaidOn),
			Note:     repayment.Note,
		})
	}

	out := lentTransferArchive{
		Type:       lentArchiveType,
		Version:    lentArchiveVersion,
		ExportedAt: time.Now().UTC().Format(time.RFC3339),
		Lents:      make([]lentTransferLent, 0, len(parents)),
	}
	for _, parent := range parents {
		cents, err := lentArchiveNumericToCents(parent.Amount)
		if err != nil {
			return lentTransferArchive{}, err
		}
		var dueOn *string
		if parent.DueOn.Valid {
			due := dateToString(parent.DueOn)
			dueOn = &due
		}
		parentReps := repsByLent[parent.ID]
		if parentReps == nil {
			parentReps = make([]lentTransferRepayment, 0)
		}
		out.Lents = append(out.Lents, lentTransferLent{
			SourceID:     parent.ID.String(),
			Counterparty: parent.Counterparty,
			Amount:       formatLentArchiveCents(cents),
			LentOn:       dateToString(parent.LentOn),
			DueOn:        dueOn,
			Note:         parent.Note,
			Repayments:   parentReps,
		})
	}
	return out, nil
}

func (s *Server) handleImportLents(w http.ResponseWriter, r *http.Request) {
	archive, err := decodeLentTransferArchive(w, r)
	if err != nil {
		writeLentArchiveInputError(w, err)
		return
	}
	if err := validateAndNormalizeLentArchive(&archive); err != nil {
		writeLentArchiveInputError(w, err)
		return
	}

	ctx := r.Context()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not import lents")
		return
	}
	defer tx.Rollback(ctx)
	qtx := s.q.WithTx(tx)
	uid := userID(r)
	parentIDs := make(map[uuid.UUID]uuid.UUID, len(archive.Lents))
	importedRepayments := 0

	for _, lent := range archive.Lents {
		sourceID, _ := uuid.Parse(lent.SourceID)
		amount, _ := parseLentArchiveMoney(lent.Amount)
		numericAmount, _ := lentArchiveCentsToNumeric(amount)
		lentOn, _ := parseDate(lent.LentOn)
		var dueOn pgtype.Date
		if lent.DueOn != nil {
			dueOn, _ = parseDate(*lent.DueOn)
		}
		created, err := qtx.InsertLent(ctx, db.InsertLentParams{
			UserID:       uid,
			Counterparty: lent.Counterparty,
			Amount:       numericAmount,
			LentOn:       lentOn,
			DueOn:        dueOn,
			Note:         lent.Note,
		})
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not import lents")
			return
		}
		parentIDs[sourceID] = created.ID
	}

	for _, lent := range archive.Lents {
		sourceLentID, _ := uuid.Parse(lent.SourceID)
		newLentID := parentIDs[sourceLentID]
		for _, repayment := range lent.Repayments {
			amount, _ := parseLentArchiveMoney(repayment.Amount)
			numericAmount, _ := lentArchiveCentsToNumeric(amount)
			repaidOn, _ := parseDate(repayment.RepaidOn)
			if _, err := qtx.InsertRepayment(ctx, db.InsertRepaymentParams{
				LentID:   newLentID,
				Amount:   numericAmount,
				RepaidOn: repaidOn,
				Note:     repayment.Note,
				UserID:   uid,
			}); err != nil {
				writeErr(w, http.StatusInternalServerError, "could not import lents")
				return
			}
			importedRepayments++
		}
	}

	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not import lents")
		return
	}
	writeJSON(w, http.StatusCreated, lentTransferResult{
		ImportedLents:      len(archive.Lents),
		ImportedRepayments: importedRepayments,
	})
}

func writeLentArchiveInputError(w http.ResponseWriter, err error) {
	if errors.Is(err, errLentArchiveLimit) {
		writeErr(w, http.StatusRequestEntityTooLarge, err.Error())
		return
	}
	writeErr(w, http.StatusBadRequest, err.Error())
}
