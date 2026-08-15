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
	chitArchiveFormat          = "pennywise-chits"
	chitArchiveVersion         = 1
	maxChitArchiveBytes        = int64(5 * 1024 * 1024)
	maxChitArchiveChits        = int64(500)
	maxChitArchiveInstallments = int64(10_000)
	maxChitArchiveTextBytes    = int64(1 * 1024 * 1024)
	maxChitArchiveCents        = int64(99_999_999_999_999)
)

var (
	errChitArchiveLimit   = errors.New("import exceeds transfer limits")
	errChitExportLimit    = errors.New("chit export exceeds transfer limits")
	chitArchiveDateRegex  = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	chitArchiveMoneyRegex = regexp.MustCompile(`^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$`)
)

type chitTransferArchive struct {
	Format  string             `json:"format"`
	Version int                `json:"version"`
	Chits   []chitTransferChit `json:"chits"`
}

type chitTransferChit struct {
	Name              string                    `json:"name"`
	Organizer         string                    `json:"organizer"`
	ChitValue         json.Number               `json:"chit_value"`
	ExpectedMonthly   json.Number               `json:"expected_monthly"`
	TotalInstallments int                       `json:"total_installments"`
	StartMonth        string                    `json:"start_month"`
	Installments      []chitTransferInstallment `json:"installments"`
}

type chitTransferInstallment struct {
	PaidOn string      `json:"paid_on"`
	Amount json.Number `json:"amount"`
	Note   string      `json:"note"`
}

type chitTransferResult struct {
	ImportedChits        int `json:"imported_chits"`
	ImportedInstallments int `json:"imported_installments"`
}

type chitTransferParent struct {
	ID                uuid.UUID
	Name              string
	Organizer         string
	ChitValue         pgtype.Numeric
	ExpectedMonthly   pgtype.Numeric
	TotalInstallments int32
	StartMonth        pgtype.Date
}

type chitTransferChild struct {
	ID     uuid.UUID
	ChitID uuid.UUID
	Amount pgtype.Numeric
	PaidOn pgtype.Date
	Note   string
}

func (a *chitTransferArchive) UnmarshalJSON(data []byte) error {
	fields, err := archiveObject(data, "archive")
	if err != nil {
		return err
	}
	if err := rejectUnknownArchiveFields(fields, map[string]struct{}{
		"format": {}, "version": {}, "chits": {},
	}); err != nil {
		return err
	}

	type archiveFields chitTransferArchive
	var archive archiveFields
	if err := requiredArchiveField(fields, "format", &archive.Format); err != nil {
		return err
	}
	if err := requiredArchiveField(fields, "version", &archive.Version); err != nil {
		return err
	}
	if err := requiredArchiveField(fields, "chits", &archive.Chits); err != nil {
		return err
	}
	*a = chitTransferArchive(archive)
	return nil
}

func (c *chitTransferChit) UnmarshalJSON(data []byte) error {
	fields, err := archiveObject(data, "chit")
	if err != nil {
		return err
	}
	if err := rejectUnknownArchiveFields(fields, map[string]struct{}{
		"name": {}, "organizer": {}, "chit_value": {}, "expected_monthly": {},
		"total_installments": {}, "start_month": {}, "installments": {},
	}); err != nil {
		return err
	}

	type chitFields chitTransferChit
	var chit chitFields
	if err := requiredArchiveField(fields, "name", &chit.Name); err != nil {
		return err
	}
	if err := requiredArchiveField(fields, "organizer", &chit.Organizer); err != nil {
		return err
	}
	if err := requiredArchiveField(fields, "chit_value", &chit.ChitValue); err != nil {
		return err
	}
	if err := requiredArchiveField(fields, "expected_monthly", &chit.ExpectedMonthly); err != nil {
		return err
	}
	if err := requiredArchiveField(fields, "total_installments", &chit.TotalInstallments); err != nil {
		return err
	}
	if err := requiredArchiveField(fields, "start_month", &chit.StartMonth); err != nil {
		return err
	}
	if err := requiredArchiveField(fields, "installments", &chit.Installments); err != nil {
		return err
	}
	*c = chitTransferChit(chit)
	return nil
}

func (i *chitTransferInstallment) UnmarshalJSON(data []byte) error {
	fields, err := archiveObject(data, "installment")
	if err != nil {
		return err
	}
	if err := rejectUnknownArchiveFields(fields, map[string]struct{}{
		"paid_on": {}, "amount": {}, "note": {},
	}); err != nil {
		return err
	}

	type installmentFields chitTransferInstallment
	var installment installmentFields
	if err := requiredArchiveField(fields, "paid_on", &installment.PaidOn); err != nil {
		return err
	}
	if err := requiredArchiveField(fields, "amount", &installment.Amount); err != nil {
		return err
	}
	if err := requiredArchiveField(fields, "note", &installment.Note); err != nil {
		return err
	}
	*i = chitTransferInstallment(installment)
	return nil
}

func decodeChitTransferArchive(w http.ResponseWriter, r *http.Request) (chitTransferArchive, error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxChitArchiveBytes)
	defer r.Body.Close()

	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	decoder.UseNumber()

	var raw json.RawMessage
	if err := decoder.Decode(&raw); err != nil {
		return chitTransferArchive{}, normalizeChitArchiveDecodeError(err)
	}

	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return chitTransferArchive{}, errors.New("invalid request body")
		}
		return chitTransferArchive{}, normalizeChitArchiveDecodeError(err)
	}

	var archive chitTransferArchive
	if err := json.Unmarshal(raw, &archive); err != nil {
		return chitTransferArchive{}, err
	}
	return archive, nil
}

func normalizeChitArchiveDecodeError(err error) error {
	var maxBytesErr *http.MaxBytesError
	if errors.As(err, &maxBytesErr) {
		return errChitArchiveLimit
	}
	return errors.New("invalid request body")
}

func validateAndNormalizeChitArchive(archive *chitTransferArchive) error {
	if archive.Format != chitArchiveFormat || archive.Version != chitArchiveVersion {
		return errors.New("unsupported chit export format or version")
	}
	if len(archive.Chits) == 0 {
		return errors.New("no chits to import")
	}
	if int64(len(archive.Chits)) > maxChitArchiveChits {
		return errChitArchiveLimit
	}

	totalInstallments := int64(0)
	textBytes := int64(0)
	for chitIndex := range archive.Chits {
		chit := &archive.Chits[chitIndex]
		var err error
		chit.Name, err = trimBounded(chit.Name, chitNameMaxLen, "name")
		if err != nil {
			return fmt.Errorf("chits[%d].name: %w", chitIndex, err)
		}
		chit.Organizer, err = trimBounded(chit.Organizer, chitNameMaxLen, "organizer")
		if err != nil {
			return fmt.Errorf("chits[%d].organizer: %w", chitIndex, err)
		}

		chitValue, err := parseChitArchiveMoney(chit.ChitValue)
		if err != nil {
			return fmt.Errorf("chits[%d].chit_value: %w", chitIndex, err)
		}
		chit.ChitValue = json.Number(formatChitArchiveCents(chitValue))

		expectedMonthly, err := parseChitArchiveMoney(chit.ExpectedMonthly)
		if err != nil {
			return fmt.Errorf("chits[%d].expected_monthly: %w", chitIndex, err)
		}
		chit.ExpectedMonthly = json.Number(formatChitArchiveCents(expectedMonthly))

		if chit.TotalInstallments < 1 || chit.TotalInstallments > chitInstallmentsMax {
			return fmt.Errorf("chits[%d].total_installments must be between 1 and 360", chitIndex)
		}
		if _, err := parseChitArchiveStartMonth(chit.StartMonth); err != nil {
			return fmt.Errorf("chits[%d].start_month must be YYYY-MM-01", chitIndex)
		}
		if len(chit.Installments) > chit.TotalInstallments {
			return fmt.Errorf("chits[%d] has more installments than total_installments", chitIndex)
		}

		textBytes += int64(len([]byte(chit.Name)) + len([]byte(chit.Organizer)))
		for installmentIndex := range chit.Installments {
			installment := &chit.Installments[installmentIndex]
			if _, err := parseChitArchiveDate(installment.PaidOn); err != nil {
				return fmt.Errorf("chits[%d].installments[%d].paid_on must be YYYY-MM-DD", chitIndex, installmentIndex)
			}
			amount, err := parseChitArchiveMoney(installment.Amount)
			if err != nil {
				return fmt.Errorf("chits[%d].installments[%d].amount: %w", chitIndex, installmentIndex, err)
			}
			installment.Amount = json.Number(formatChitArchiveCents(amount))
			installment.Note = strings.TrimSpace(installment.Note)
			if len([]rune(installment.Note)) > chitNoteMaxLen {
				return fmt.Errorf("chits[%d].installments[%d].note is too long", chitIndex, installmentIndex)
			}
			textBytes += int64(len([]byte(installment.Note)))
			totalInstallments++
			if totalInstallments > maxChitArchiveInstallments {
				return errChitArchiveLimit
			}
		}
		if textBytes > maxChitArchiveTextBytes {
			return errChitArchiveLimit
		}
	}
	return nil
}

func parseChitArchiveMoney(value json.Number) (int64, error) {
	raw := value.String()
	if !chitArchiveMoneyRegex.MatchString(raw) {
		return 0, errors.New("must be a positive decimal with at most two fractional digits")
	}
	wholeText, fractionText, hasFraction := strings.Cut(raw, ".")
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
	if whole > (maxChitArchiveCents-fraction)/100 {
		return 0, errors.New("exceeds the maximum supported amount")
	}
	cents := whole*100 + fraction
	if cents <= 0 {
		return 0, errors.New("must be greater than zero")
	}
	return cents, nil
}

func formatChitArchiveCents(cents int64) string {
	return fmt.Sprintf("%d.%02d", cents/100, cents%100)
}

func parseChitArchiveDate(value string) (time.Time, error) {
	if !chitArchiveDateRegex.MatchString(value) {
		return time.Time{}, errors.New("invalid date")
	}
	return time.Parse("2006-01-02", value)
}

func parseChitArchiveStartMonth(value string) (time.Time, error) {
	date, err := parseChitArchiveDate(value)
	if err != nil || date.Day() != 1 {
		return time.Time{}, errors.New("invalid start month")
	}
	return date, nil
}

func chitArchiveNumericToCents(n pgtype.Numeric) (int64, error) {
	if !n.Valid || n.NaN || n.Int == nil {
		return 0, errors.New("invalid stored money")
	}
	scaled := new(big.Int).Set(n.Int)
	if n.Exp >= -2 {
		factor := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(n.Exp+2)), nil)
		scaled.Mul(scaled, factor)
	} else {
		divisor := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(-n.Exp-2)), nil)
		remainder := new(big.Int).Mod(new(big.Int).Set(scaled), divisor)
		if remainder.Sign() != 0 {
			return 0, errors.New("stored money has more than two fractional digits")
		}
		scaled.Quo(scaled, divisor)
	}
	if !scaled.IsInt64() {
		return 0, errors.New("stored money is too large")
	}
	cents := scaled.Int64()
	if cents <= 0 || cents > maxChitArchiveCents {
		return 0, errors.New("stored money is outside the supported range")
	}
	return cents, nil
}

func chitArchiveCentsToNumeric(cents int64) (pgtype.Numeric, error) {
	var n pgtype.Numeric
	if err := n.Scan(formatChitArchiveCents(cents)); err != nil {
		return n, err
	}
	return n, nil
}

type cappedChitArchiveBuffer struct {
	bytes.Buffer
}

func (b *cappedChitArchiveBuffer) Write(p []byte) (int, error) {
	if int64(b.Len())+int64(len(p)) > maxChitArchiveBytes {
		return 0, errChitExportLimit
	}
	return b.Buffer.Write(p)
}

func buildChitTransferArchive(parents []chitTransferParent, children []chitTransferChild) (chitTransferArchive, error) {
	childrenByChit := make(map[uuid.UUID][]chitTransferInstallment)
	for _, child := range children {
		amount, err := chitArchiveNumericToCents(child.Amount)
		if err != nil {
			return chitTransferArchive{}, err
		}
		childrenByChit[child.ChitID] = append(childrenByChit[child.ChitID], chitTransferInstallment{
			PaidOn: dateToString(child.PaidOn),
			Amount: json.Number(formatChitArchiveCents(amount)),
			Note:   child.Note,
		})
	}

	archive := chitTransferArchive{
		Format:  chitArchiveFormat,
		Version: chitArchiveVersion,
		Chits:   make([]chitTransferChit, 0, len(parents)),
	}
	for _, parent := range parents {
		chitValue, err := chitArchiveNumericToCents(parent.ChitValue)
		if err != nil {
			return chitTransferArchive{}, err
		}
		expectedMonthly, err := chitArchiveNumericToCents(parent.ExpectedMonthly)
		if err != nil {
			return chitTransferArchive{}, err
		}
		installments := childrenByChit[parent.ID]
		if installments == nil {
			installments = make([]chitTransferInstallment, 0)
		}
		archive.Chits = append(archive.Chits, chitTransferChit{
			Name:              parent.Name,
			Organizer:         parent.Organizer,
			ChitValue:         json.Number(formatChitArchiveCents(chitValue)),
			ExpectedMonthly:   json.Number(formatChitArchiveCents(expectedMonthly)),
			TotalInstallments: int(parent.TotalInstallments),
			StartMonth:        dateToString(parent.StartMonth),
			Installments:      installments,
		})
	}
	return archive, nil
}

func (s *Server) handleExportChits(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{
		IsoLevel:   pgx.RepeatableRead,
		AccessMode: pgx.ReadOnly,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not export chits")
		return
	}
	defer tx.Rollback(ctx)
	qtx := s.q.WithTx(tx)
	uid := userID(r)

	chitIDText := r.URL.Query().Get("chit_id")
	var (
		parents  []chitTransferParent
		children []chitTransferChild
		filename = fmt.Sprintf("pennywise-chits-%s.json", time.Now().UTC().Format("2006-01-02"))
	)
	if chitIDText == "" {
		preflight, err := qtx.ChitTransferPreflight(ctx, uid)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not export chits")
			return
		}
		if chitTransferPreflightExceeds(preflight.ChitCount, preflight.InstallmentCount, preflight.TextBytes) {
			writeErr(w, http.StatusRequestEntityTooLarge, "chit export exceeds transfer limits; export individual chits instead")
			return
		}
		rows, err := qtx.ListChitsForTransfer(ctx, uid)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not export chits")
			return
		}
		installmentRows, err := qtx.ListChitInstallmentsForTransfer(ctx, uid)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not export chits")
			return
		}
		parents = make([]chitTransferParent, 0, len(rows))
		for _, row := range rows {
			parents = append(parents, chitTransferParent{
				ID: row.ID, Name: row.Name, Organizer: row.Organizer,
				ChitValue: row.ChitValue, ExpectedMonthly: row.ExpectedMonthly,
				TotalInstallments: row.TotalInstallments, StartMonth: row.StartMonth,
			})
		}
		children = make([]chitTransferChild, 0, len(installmentRows))
		for _, row := range installmentRows {
			children = append(children, chitTransferChild{
				ID: row.ID, ChitID: row.ChitID, Amount: row.Amount, PaidOn: row.PaidOn, Note: row.Note,
			})
		}
	} else {
		chitID, err := uuid.Parse(chitIDText)
		if err != nil {
			writeErr(w, http.StatusNotFound, "chit not found")
			return
		}
		preflight, err := qtx.ChitTransferChitPreflight(ctx, db.ChitTransferChitPreflightParams{
			ChitID: chitID, UserID: uid,
		})
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not export chits")
			return
		}
		if preflight.ChitCount == 0 {
			writeErr(w, http.StatusNotFound, "chit not found")
			return
		}
		if chitTransferPreflightExceeds(preflight.ChitCount, preflight.InstallmentCount, preflight.TextBytes) {
			writeErr(w, http.StatusRequestEntityTooLarge, "chit export exceeds transfer limits")
			return
		}
		rows, err := qtx.ListChitForTransfer(ctx, db.ListChitForTransferParams{
			ChitID: chitID, UserID: uid,
		})
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not export chits")
			return
		}
		installmentRows, err := qtx.ListChitInstallmentsForTransferByChit(ctx, db.ListChitInstallmentsForTransferByChitParams{
			ChitID: chitID, UserID: uid,
		})
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not export chits")
			return
		}
		parents = make([]chitTransferParent, 0, len(rows))
		for _, row := range rows {
			parents = append(parents, chitTransferParent{
				ID: row.ID, Name: row.Name, Organizer: row.Organizer,
				ChitValue: row.ChitValue, ExpectedMonthly: row.ExpectedMonthly,
				TotalInstallments: row.TotalInstallments, StartMonth: row.StartMonth,
			})
		}
		children = make([]chitTransferChild, 0, len(installmentRows))
		for _, row := range installmentRows {
			children = append(children, chitTransferChild{
				ID: row.ID, ChitID: row.ChitID, Amount: row.Amount, PaidOn: row.PaidOn, Note: row.Note,
			})
		}
		filename = fmt.Sprintf("pennywise-chit-%s-%s.json", chitID.String(), time.Now().UTC().Format("2006-01-02"))
	}

	archive, err := buildChitTransferArchive(parents, children)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not export chits")
		return
	}
	var encoded cappedChitArchiveBuffer
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(archive); err != nil {
		if errors.Is(err, errChitExportLimit) {
			if chitIDText == "" {
				writeErr(w, http.StatusRequestEntityTooLarge, "chit export exceeds transfer limits; export individual chits instead")
			} else {
				writeErr(w, http.StatusRequestEntityTooLarge, "chit export exceeds transfer limits")
			}
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not export chits")
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not export chits")
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(encoded.Bytes())
}

func chitTransferPreflightExceeds(chitCount, installmentCount, textBytes int64) bool {
	return chitCount > maxChitArchiveChits ||
		installmentCount > maxChitArchiveInstallments ||
		textBytes > maxChitArchiveTextBytes
}

func (s *Server) handleImportChits(w http.ResponseWriter, r *http.Request) {
	archive, err := decodeChitTransferArchive(w, r)
	if err != nil {
		writeChitArchiveInputError(w, err)
		return
	}
	if err := validateAndNormalizeChitArchive(&archive); err != nil {
		writeChitArchiveInputError(w, err)
		return
	}

	ctx := r.Context()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not import chits")
		return
	}
	defer tx.Rollback(ctx)
	uid := userID(r)

	parentArgs := make([]db.InsertChitTransferParentParams, 0, len(archive.Chits))
	for _, chit := range archive.Chits {
		chitValue, err := parseChitArchiveMoney(chit.ChitValue)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not import chits")
			return
		}
		expectedMonthly, err := parseChitArchiveMoney(chit.ExpectedMonthly)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not import chits")
			return
		}
		chitValueNumeric, err := chitArchiveCentsToNumeric(chitValue)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not import chits")
			return
		}
		expectedMonthlyNumeric, err := chitArchiveCentsToNumeric(expectedMonthly)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not import chits")
			return
		}
		startMonth, err := parseChitArchiveStartMonth(chit.StartMonth)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "could not import chits")
			return
		}
		parentArgs = append(parentArgs, db.InsertChitTransferParentParams{
			UserID:            uid,
			Name:              chit.Name,
			Organizer:         chit.Organizer,
			ChitValue:         chitValueNumeric,
			ExpectedMonthly:   expectedMonthlyNumeric,
			TotalInstallments: int32(chit.TotalInstallments),
			StartMonth:        pgtype.Date{Time: startMonth, Valid: true},
		})
	}
	parentIDs, err := db.InsertChitTransferParentsBatch(ctx, tx, parentArgs)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not import chits")
		return
	}

	childArgs := make([]db.InsertChitTransferInstallmentParams, 0, maxChitArchiveInstallments)
	for chitIndex, chit := range archive.Chits {
		for _, installment := range chit.Installments {
			amount, err := parseChitArchiveMoney(installment.Amount)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, "could not import chits")
				return
			}
			numericAmount, err := chitArchiveCentsToNumeric(amount)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, "could not import chits")
				return
			}
			paidOn, err := parseChitArchiveDate(installment.PaidOn)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, "could not import chits")
				return
			}
			childArgs = append(childArgs, db.InsertChitTransferInstallmentParams{
				ChitID: parentIDs[chitIndex],
				Amount: numericAmount,
				PaidOn: pgtype.Date{Time: paidOn, Valid: true},
				Note:   installment.Note,
				UserID: uid,
			})
		}
	}
	if err := db.InsertChitTransferInstallmentsBatch(ctx, tx, childArgs); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not import chits")
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not import chits")
		return
	}
	writeJSON(w, http.StatusCreated, chitTransferResult{
		ImportedChits:        len(archive.Chits),
		ImportedInstallments: len(childArgs),
	})
}

func writeChitArchiveInputError(w http.ResponseWriter, err error) {
	if errors.Is(err, errChitArchiveLimit) {
		writeErr(w, http.StatusRequestEntityTooLarge, "import exceeds transfer limits")
		return
	}
	writeErr(w, http.StatusBadRequest, err.Error())
}
