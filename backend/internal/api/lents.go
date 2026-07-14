package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ledger/backend/internal/db"
)

type LentDTO struct {
	ID           string         `json:"id"`
	Counterparty string         `json:"counterparty"`
	Amount       float64        `json:"amount"`
	LentOn       string         `json:"lent_on"`
	DueOn        *string        `json:"due_on"`
	Note         string         `json:"note"`
	RepaidTotal  float64        `json:"repaid_total"`
	Outstanding  float64        `json:"outstanding"`
	Status       string         `json:"status"`
	Repayments   []RepaymentDTO `json:"repayments,omitempty"`
}

type RepaymentDTO struct {
	ID       string  `json:"id"`
	LentID   string  `json:"lent_id"`
	Amount   float64 `json:"amount"`
	RepaidOn string  `json:"repaid_on"`
	Note     string  `json:"note"`
}

// lentStatus is the single place open/settled is decided. It is derived from the
// outstanding balance rather than stored, so it cannot drift from the repayments.
func lentStatus(outstanding float64) string {
	if outstanding > 0 {
		return "open"
	}
	return "settled"
}

func lentRowToDTO(l db.ListLentsRow) LentDTO {
	outstanding := numToFloat(l.Outstanding)
	dto := LentDTO{
		ID:           l.ID.String(),
		Counterparty: l.Counterparty,
		Amount:       numToFloat(l.Amount),
		LentOn:       dateToString(l.LentOn),
		Note:         l.Note,
		RepaidTotal:  numToFloat(l.RepaidTotal),
		Outstanding:  outstanding,
		Status:       lentStatus(outstanding),
	}
	if l.DueOn.Valid {
		due := dateToString(l.DueOn)
		dto.DueOn = &due
	}
	return dto
}

func repaymentToDTO(r db.ListRepaymentsForLentRow) RepaymentDTO {
	return RepaymentDTO{
		ID:       r.ID.String(),
		LentID:   r.LentID.String(),
		Amount:   numToFloat(r.Amount),
		RepaidOn: dateToString(r.RepaidOn),
		Note:     r.Note,
	}
}

func repaymentRowToDTO(r db.LentRepayment) RepaymentDTO {
	return RepaymentDTO{
		ID:       r.ID.String(),
		LentID:   r.LentID.String(),
		Amount:   numToFloat(r.Amount),
		RepaidOn: dateToString(r.RepaidOn),
		Note:     r.Note,
	}
}

type lentInput struct {
	Counterparty string  `json:"counterparty"`
	Amount       float64 `json:"amount"`
	LentOn       string  `json:"lent_on"`
	DueOn        *string `json:"due_on"`
	Note         string  `json:"note"`
}

// parse validates a lent payload and converts it into storage types.
func (in lentInput) parse() (counterparty string, amount pgtype.Numeric, lentOn, dueOn pgtype.Date, err error) {
	counterparty = strings.TrimSpace(in.Counterparty)
	if counterparty == "" {
		return "", amount, lentOn, dueOn, errors.New("counterparty is required")
	}
	if in.Amount <= 0 {
		return "", amount, lentOn, dueOn, errors.New("amount must be greater than zero")
	}
	lentOn, perr := parseDate(in.LentOn)
	if perr != nil {
		return "", amount, lentOn, dueOn, errors.New("lent_on must be YYYY-MM-DD")
	}
	if in.DueOn != nil && *in.DueOn != "" {
		d, perr := parseDate(*in.DueOn)
		if perr != nil {
			return "", amount, lentOn, dueOn, errors.New("due_on must be YYYY-MM-DD")
		}
		if d.Time.Before(lentOn.Time) {
			return "", amount, lentOn, dueOn, errors.New("due_on cannot be before lent_on")
		}
		dueOn = d
	}
	return counterparty, floatToNum(in.Amount), lentOn, dueOn, nil
}

func (s *Server) handleListLents(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	if status == "" {
		status = "all"
	}
	if status != "all" && status != "open" && status != "settled" {
		writeErr(w, http.StatusBadRequest, "status must be open, settled or all")
		return
	}

	rows, err := s.q.ListLents(r.Context(), db.ListLentsParams{UserID: userID(r), Status: status})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load lents")
		return
	}

	out := make([]LentDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, lentRowToDTO(row))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleGetLent(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	uid := userID(r)

	lent, err := s.q.GetLent(r.Context(), db.GetLentParams{ID: id, UserID: uid})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "lent not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not load lent")
		return
	}

	reps, err := s.q.ListRepaymentsForLent(r.Context(), db.ListRepaymentsForLentParams{LentID: id, UserID: uid})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load repayments")
		return
	}

	dto := lentRowToDTO(db.ListLentsRow(lent))
	dto.Repayments = make([]RepaymentDTO, 0, len(reps))
	for _, rep := range reps {
		dto.Repayments = append(dto.Repayments, repaymentToDTO(rep))
	}
	writeJSON(w, http.StatusOK, dto)
}

func (s *Server) handleCreateLent(w http.ResponseWriter, r *http.Request) {
	var in lentInput
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	counterparty, amount, lentOn, dueOn, err := in.parse()
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	created, err := s.q.InsertLent(r.Context(), db.InsertLentParams{
		UserID: userID(r), Counterparty: counterparty, Amount: amount,
		LentOn: lentOn, DueOn: dueOn, Note: in.Note,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create lent")
		return
	}

	writeJSON(w, http.StatusCreated, lentToDTO(created, 0))
}

func (s *Server) handleUpdateLent(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in lentInput
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	counterparty, amount, lentOn, dueOn, err := in.parse()
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	uid := userID(r)

	// Shrinking the principal below what has already been repaid would leave a
	// negative balance, so reject it rather than storing an impossible row.
	repaid, err := s.q.SumRepaymentsForLent(r.Context(), db.SumRepaymentsForLentParams{
		LentID: id, ExcludeID: uuid.Nil,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update lent")
		return
	}
	if in.Amount < numToFloat(repaid) {
		writeErr(w, http.StatusBadRequest, "amount is less than the total already repaid")
		return
	}

	updated, err := s.q.UpdateLent(r.Context(), db.UpdateLentParams{
		ID: id, UserID: uid, Counterparty: counterparty, Amount: amount,
		LentOn: lentOn, DueOn: dueOn, Note: in.Note,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "lent not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not update lent")
		return
	}

	writeJSON(w, http.StatusOK, lentToDTO(updated, numToFloat(repaid)))
}

func (s *Server) handleDeleteLent(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}

	n, err := s.q.DeleteLent(r.Context(), db.DeleteLentParams{ID: id, UserID: userID(r)})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not delete lent")
		return
	}
	if n == 0 {
		writeErr(w, http.StatusNotFound, "lent not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// lentToDTO builds a DTO from a bare lents row plus a separately computed repaid
// total (the write queries return the row, not the derived columns).
func lentToDTO(l db.Lent, repaidTotal float64) LentDTO {
	outstanding := numToFloat(l.Amount) - repaidTotal
	dto := LentDTO{
		ID:           l.ID.String(),
		Counterparty: l.Counterparty,
		Amount:       numToFloat(l.Amount),
		LentOn:       dateToString(l.LentOn),
		Note:         l.Note,
		RepaidTotal:  repaidTotal,
		Outstanding:  outstanding,
		Status:       lentStatus(outstanding),
	}
	if l.DueOn.Valid {
		due := dateToString(l.DueOn)
		dto.DueOn = &due
	}
	return dto
}

// ---------------------------------------------------------------------------
// Repayments
// ---------------------------------------------------------------------------

type repaymentInput struct {
	Amount   float64 `json:"amount"`
	RepaidOn string  `json:"repaid_on"`
	Note     string  `json:"note"`
}

func (s *Server) handleListRepayments(w http.ResponseWriter, r *http.Request) {
	lentID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	uid := userID(r)

	if _, err := s.q.GetLent(r.Context(), db.GetLentParams{ID: lentID, UserID: uid}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "lent not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not load lent")
		return
	}

	reps, err := s.q.ListRepaymentsForLent(r.Context(), db.ListRepaymentsForLentParams{LentID: lentID, UserID: uid})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load repayments")
		return
	}
	out := make([]RepaymentDTO, 0, len(reps))
	for _, rep := range reps {
		out = append(out, repaymentToDTO(rep))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleCreateRepayment(w http.ResponseWriter, r *http.Request) {
	lentID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in repaymentInput
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	repaidOn, amount, err := parseRepayment(in)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	uid := userID(r)

	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not record repayment")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := s.q.WithTx(tx)

	// Read the balance and insert inside one transaction so two concurrent
	// repayments cannot both pass the over-repayment check.
	lent, err := qtx.GetLent(r.Context(), db.GetLentParams{ID: lentID, UserID: uid})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "lent not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not load lent")
		return
	}
	if in.Amount > numToFloat(lent.Outstanding) {
		writeErr(w, http.StatusBadRequest, "repayment exceeds the outstanding balance")
		return
	}

	created, err := qtx.InsertRepayment(r.Context(), db.InsertRepaymentParams{
		LentID: lentID, UserID: uid, Amount: amount, RepaidOn: repaidOn, Note: in.Note,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not record repayment")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not record repayment")
		return
	}

	writeJSON(w, http.StatusCreated, repaymentRowToDTO(created))
}

func (s *Server) handleUpdateRepayment(w http.ResponseWriter, r *http.Request) {
	lentID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	repID, err := uuid.Parse(chi.URLParam(r, "rid"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid repayment id")
		return
	}
	var in repaymentInput
	if err := readJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	repaidOn, amount, err := parseRepayment(in)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	uid := userID(r)

	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update repayment")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := s.q.WithTx(tx)

	lent, err := qtx.GetLent(r.Context(), db.GetLentParams{ID: lentID, UserID: uid})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "lent not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not load lent")
		return
	}

	// Exclude the row being edited from the repaid total, otherwise it would
	// count against itself and a no-op edit would look like over-repayment.
	repaidByOthers, err := qtx.SumRepaymentsForLent(r.Context(), db.SumRepaymentsForLentParams{
		LentID: lentID, ExcludeID: repID,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update repayment")
		return
	}
	if in.Amount > numToFloat(lent.Amount)-numToFloat(repaidByOthers) {
		writeErr(w, http.StatusBadRequest, "repayment exceeds the outstanding balance")
		return
	}

	updated, err := qtx.UpdateRepayment(r.Context(), db.UpdateRepaymentParams{
		ID: repID, LentID: lentID, UserID: uid, Amount: amount, RepaidOn: repaidOn, Note: in.Note,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "repayment not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not update repayment")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not update repayment")
		return
	}

	writeJSON(w, http.StatusOK, repaymentRowToDTO(updated))
}

func (s *Server) handleDeleteRepayment(w http.ResponseWriter, r *http.Request) {
	lentID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	repID, err := uuid.Parse(chi.URLParam(r, "rid"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid repayment id")
		return
	}

	n, err := s.q.DeleteRepayment(r.Context(), db.DeleteRepaymentParams{
		ID: repID, LentID: lentID, UserID: userID(r),
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not delete repayment")
		return
	}
	if n == 0 {
		writeErr(w, http.StatusNotFound, "repayment not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func parseRepayment(in repaymentInput) (pgtype.Date, pgtype.Numeric, error) {
	var d pgtype.Date
	var n pgtype.Numeric
	if in.Amount <= 0 {
		return d, n, errors.New("amount must be greater than zero")
	}
	d, err := parseDate(in.RepaidOn)
	if err != nil {
		return d, n, errors.New("repaid_on must be YYYY-MM-DD")
	}
	return d, floatToNum(in.Amount), nil
}
