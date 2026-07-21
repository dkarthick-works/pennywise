package api

import (
	"errors"
	"math"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ledger/backend/internal/db"
)

const (
	chitNameMaxLen     = 120
	chitNoteMaxLen     = 500
	chitInstallmentsMax = 360
	chitMoneyMax       = 999999999999.99
)

type ChitSummaryDTO struct {
	ID                string  `json:"id"`
	Name              string  `json:"name"`
	Organizer         string  `json:"organizer"`
	ChitValue         float64 `json:"chit_value"`
	ExpectedMonthly   float64 `json:"expected_monthly"`
	TotalInstallments int     `json:"total_installments"`
	StartMonth        string  `json:"start_month"`
	InstallmentCount  int64   `json:"installment_count"`
	TotalPaid         float64 `json:"total_paid"`
	Status            string  `json:"status"`
}

type ChitDetailDTO struct {
	ChitSummaryDTO
	Installments []ChitInstallmentDTO `json:"installments"`
}

type ChitInstallmentDTO struct {
	ID        string  `json:"id"`
	PaidOn    string  `json:"paid_on"`
	Amount    float64 `json:"amount"`
	Note      string  `json:"note"`
	CreatedAt string  `json:"created_at,omitempty"`
}

type chitInput struct {
	Name              string  `json:"name"`
	Organizer         string  `json:"organizer"`
	ChitValue         float64 `json:"chit_value"`
	ExpectedMonthly   float64 `json:"expected_monthly"`
	TotalInstallments int     `json:"total_installments"`
	StartMonth        string  `json:"start_month"`
}

type chitInstallmentInput struct {
	PaidOn string  `json:"paid_on"`
	Amount float64 `json:"amount"`
	Note   string  `json:"note"`
}

func chitStatus(installmentCount int64, totalInstallments int32) string {
	if installmentCount >= int64(totalInstallments) {
		return "completed"
	}
	return "active"
}

func validateMoneyAmount(v float64, field string) error {
	if v <= 0 || math.IsNaN(v) || math.IsInf(v, 0) {
		return errors.New(field + " must be greater than zero")
	}
	if v > chitMoneyMax {
		return errors.New(field + " exceeds maximum")
	}
	scaled := v * 100
	if math.Abs(scaled-math.Round(scaled)) > 1e-6 {
		return errors.New(field + " must have at most two decimal places")
	}
	return nil
}

func parseStartMonth(s string) (pgtype.Date, error) {
	d, err := parseDate(s)
	if err != nil {
		return pgtype.Date{}, errors.New("start_month must be YYYY-MM-01")
	}
	if d.Time.Day() != 1 {
		return pgtype.Date{}, errors.New("start_month must be YYYY-MM-01")
	}
	return d, nil
}

func trimBounded(s string, max int, field string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", errors.New(field + " is required")
	}
	if utf8.RuneCountInString(s) > max {
		return "", errors.New(field + " is too long")
	}
	return s, nil
}

func (in chitInput) parse() (name, organizer string, chitValue, expectedMonthly pgtype.Numeric, total int32, startMonth pgtype.Date, err error) {
	name, err = trimBounded(in.Name, chitNameMaxLen, "name")
	if err != nil {
		return
	}
	organizer, err = trimBounded(in.Organizer, chitNameMaxLen, "organizer")
	if err != nil {
		return
	}
	if err = validateMoneyAmount(in.ChitValue, "chit_value"); err != nil {
		return
	}
	if err = validateMoneyAmount(in.ExpectedMonthly, "expected_monthly"); err != nil {
		return
	}
	if in.TotalInstallments < 1 || in.TotalInstallments > chitInstallmentsMax {
		err = errors.New("total_installments must be between 1 and 360")
		return
	}
	startMonth, err = parseStartMonth(in.StartMonth)
	if err != nil {
		return
	}
	return name, organizer, floatToNum(in.ChitValue), floatToNum(in.ExpectedMonthly), int32(in.TotalInstallments), startMonth, nil
}

func (in chitInstallmentInput) parse() (paidOn pgtype.Date, amount pgtype.Numeric, note string, err error) {
	paidOn, err = parseDate(in.PaidOn)
	if err != nil {
		return paidOn, amount, note, errors.New("paid_on must be YYYY-MM-DD")
	}
	if err = validateMoneyAmount(in.Amount, "amount"); err != nil {
		return
	}
	note = strings.TrimSpace(in.Note)
	if utf8.RuneCountInString(note) > chitNoteMaxLen {
		return paidOn, amount, note, errors.New("note is too long")
	}
	return paidOn, floatToNum(in.Amount), note, nil
}

func chitSummaryFromRow(id uuid.UUID, name, organizer string, chitValue, expectedMonthly pgtype.Numeric, totalInstallments int32, startMonth pgtype.Date, installmentCount int64, totalPaid pgtype.Numeric) ChitSummaryDTO {
	return ChitSummaryDTO{
		ID:                id.String(),
		Name:              name,
		Organizer:         organizer,
		ChitValue:         numToFloat(chitValue),
		ExpectedMonthly:   numToFloat(expectedMonthly),
		TotalInstallments: int(totalInstallments),
		StartMonth:        dateToString(startMonth),
		InstallmentCount:  installmentCount,
		TotalPaid:         numToFloat(totalPaid),
		Status:            chitStatus(installmentCount, totalInstallments),
	}
}

func listChitToDTO(r db.ListChitsRow) ChitSummaryDTO {
	return chitSummaryFromRow(
		r.ID, r.Name, r.Organizer, r.ChitValue, r.ExpectedMonthly,
		r.TotalInstallments, r.StartMonth, r.InstallmentCount, r.TotalPaid,
	)
}

func getChitToSummary(r db.GetChitRow) ChitSummaryDTO {
	return chitSummaryFromRow(
		r.ID, r.Name, r.Organizer, r.ChitValue, r.ExpectedMonthly,
		r.TotalInstallments, r.StartMonth, r.InstallmentCount, r.TotalPaid,
	)
}

func installmentToDTO(r db.ChitInstallment) ChitInstallmentDTO {
	dto := ChitInstallmentDTO{
		ID:     r.ID.String(),
		PaidOn: dateToString(r.PaidOn),
		Amount: numToFloat(r.Amount),
		Note:   r.Note,
	}
	if r.CreatedAt.Valid {
		dto.CreatedAt = r.CreatedAt.Time.UTC().Format("2006-01-02T15:04:05Z")
	}
	return dto
}

func moneyEqual(a, b float64) bool {
	return math.Abs(a-b) < 0.005
}

func (s *Server) handleListChits(w http.ResponseWriter, r *http.Request) {
	rows, err := s.q.ListChits(r.Context(), userID(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load chits")
		return
	}
	out := make([]ChitSummaryDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, listChitToDTO(row))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleCreateChit(w http.ResponseWriter, r *http.Request) {
	var in chitInput
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	name, organizer, chitValue, expectedMonthly, total, startMonth, err := in.parse()
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	created, err := s.q.InsertChit(r.Context(), db.InsertChitParams{
		UserID:            userID(r),
		Name:              name,
		Organizer:         organizer,
		ChitValue:         chitValue,
		ExpectedMonthly:   expectedMonthly,
		TotalInstallments: total,
		StartMonth:        startMonth,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create chit")
		return
	}

	writeJSON(w, http.StatusCreated, chitSummaryFromRow(
		created.ID, created.Name, created.Organizer, created.ChitValue, created.ExpectedMonthly,
		created.TotalInstallments, created.StartMonth, 0, floatToNum(0),
	))
}

func (s *Server) loadChitDetail(w http.ResponseWriter, r *http.Request, id, uid uuid.UUID) {
	row, err := s.q.GetChit(r.Context(), db.GetChitParams{ID: id, UserID: uid})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "chit not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not load chit")
		return
	}
	installments, err := s.q.ListInstallmentsForChit(r.Context(), db.ListInstallmentsForChitParams{
		ChitID: id, UserID: uid,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load installments")
		return
	}
	list := make([]ChitInstallmentDTO, 0, len(installments))
	for _, inst := range installments {
		list = append(list, installmentToDTO(inst))
	}
	writeJSON(w, http.StatusOK, ChitDetailDTO{
		ChitSummaryDTO: getChitToSummary(row),
		Installments:   list,
	})
}

func (s *Server) handleGetChit(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	s.loadChitDetail(w, r, id, userID(r))
}

func (s *Server) handleUpdateChit(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in chitInput
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	name, organizer, chitValue, expectedMonthly, total, startMonth, err := in.parse()
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	uid := userID(r)

	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update chit")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := s.q.WithTx(tx)

	cur, err := qtx.LockChitForUser(r.Context(), db.LockChitForUserParams{ID: id, UserID: uid})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "chit not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not update chit")
		return
	}

	count, err := qtx.CountInstallmentsForChit(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update chit")
		return
	}

	if int64(total) < count {
		writeErr(w, http.StatusBadRequest, "total_installments cannot be below installment count")
		return
	}

	if count > 0 {
		lockedChanged := !moneyEqual(in.ExpectedMonthly, numToFloat(cur.ExpectedMonthly)) ||
			total != cur.TotalInstallments ||
			!startMonth.Time.Equal(cur.StartMonth.Time)
		if lockedChanged {
			writeErr(w, http.StatusConflict, "start_month, expected_monthly, and total_installments are locked after the first installment")
			return
		}
	}

	updated, err := qtx.UpdateChit(r.Context(), db.UpdateChitParams{
		ID:                id,
		UserID:            uid,
		Name:              name,
		Organizer:         organizer,
		ChitValue:         chitValue,
		ExpectedMonthly:   expectedMonthly,
		TotalInstallments: total,
		StartMonth:        startMonth,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update chit")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update chit")
		return
	}

	totalPaid := floatToNum(0)
	detail, err := s.q.GetChit(r.Context(), db.GetChitParams{ID: id, UserID: uid})
	if err == nil {
		totalPaid = detail.TotalPaid
		count = detail.InstallmentCount
	}

	writeJSON(w, http.StatusOK, chitSummaryFromRow(
		updated.ID, updated.Name, updated.Organizer, updated.ChitValue, updated.ExpectedMonthly,
		updated.TotalInstallments, updated.StartMonth, count, totalPaid,
	))
}

func (s *Server) handleDeleteChit(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	n, err := s.q.DeleteChit(r.Context(), db.DeleteChitParams{ID: id, UserID: userID(r)})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not delete chit")
		return
	}
	if n == 0 {
		writeErr(w, http.StatusNotFound, "chit not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleCreateChitInstallment(w http.ResponseWriter, r *http.Request) {
	chitID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in chitInstallmentInput
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	paidOn, amount, note, err := in.parse()
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	uid := userID(r)

	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not record installment")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := s.q.WithTx(tx)

	chit, err := qtx.LockChitForUser(r.Context(), db.LockChitForUserParams{ID: chitID, UserID: uid})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "chit not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not record installment")
		return
	}

	count, err := qtx.CountInstallmentsForChit(r.Context(), chitID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not record installment")
		return
	}
	if count >= int64(chit.TotalInstallments) {
		writeErr(w, http.StatusConflict, "chit is completed; no more installments can be added")
		return
	}

	created, err := qtx.InsertChitInstallment(r.Context(), db.InsertChitInstallmentParams{
		ChitID: chitID, UserID: uid, Amount: amount, PaidOn: paidOn, Note: note,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not record installment")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not record installment")
		return
	}

	writeJSON(w, http.StatusCreated, installmentToDTO(created))
}

func (s *Server) handleUpdateChitInstallment(w http.ResponseWriter, r *http.Request) {
	chitID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	instID, err := uuid.Parse(chi.URLParam(r, "installmentId"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid installment id")
		return
	}
	var in chitInstallmentInput
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	paidOn, amount, note, err := in.parse()
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	uid := userID(r)

	if _, err := s.q.GetChit(r.Context(), db.GetChitParams{ID: chitID, UserID: uid}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "chit not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not update installment")
		return
	}

	updated, err := s.q.UpdateChitInstallment(r.Context(), db.UpdateChitInstallmentParams{
		ID: instID, ChitID: chitID, UserID: uid, Amount: amount, PaidOn: paidOn, Note: note,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "installment not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not update installment")
		return
	}
	writeJSON(w, http.StatusOK, installmentToDTO(updated))
}

func (s *Server) handleDeleteChitInstallment(w http.ResponseWriter, r *http.Request) {
	chitID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	instID, err := uuid.Parse(chi.URLParam(r, "installmentId"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid installment id")
		return
	}
	n, err := s.q.DeleteChitInstallment(r.Context(), db.DeleteChitInstallmentParams{
		ID: instID, ChitID: chitID, UserID: userID(r),
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not delete installment")
		return
	}
	if n == 0 {
		writeErr(w, http.StatusNotFound, "installment not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
