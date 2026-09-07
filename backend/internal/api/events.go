package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/ledger/backend/internal/db"
)

func eventError(w http.ResponseWriter, err error) {
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, 404, "event not found")
	} else {
		writeErr(w, 500, "could not process event")
	}
}
func eventID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, 400, "invalid event id")
		return id, false
	}
	return id, true
}
func (s *Server) handleGetEvent(w http.ResponseWriter, r *http.Request) {
	id, ok := eventID(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		eventError(w, err)
		return
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	e, err := q.GetEvent(ctx, db.GetEventParams{ID: id, UserID: userID(r)})
	if err != nil {
		eventError(w, err)
		return
	}
	items, err := q.ListEventItems(ctx, db.ListEventItemsParams{ID: id, UserID: userID(r)})
	if err != nil {
		eventError(w, err)
		return
	}
	if err = tx.Commit(ctx); err != nil {
		eventError(w, err)
		return
	}
	writeJSON(w, 200, eventDetail(e, items))
}
func (s *Server) handleCreateEvent(w http.ResponseWriter, r *http.Request) { s.saveEvent(w, r, false) }
func (s *Server) handleUpdateEvent(w http.ResponseWriter, r *http.Request) { s.saveEvent(w, r, true) }
func (s *Server) saveEvent(w http.ResponseWriter, r *http.Request, update bool) {
	var id uuid.UUID
	var ok bool
	if update {
		id, ok = eventID(w, r)
		if !ok {
			return
		}
	}
	var in eventInput
	if !readEventJSON(w, r, &in) {
		return
	}
	p, items, err := in.parse(update)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	p.UserID = userID(r)
	ctx := r.Context()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		eventError(w, err)
		return
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	var e db.Event
	if update {
		e, err = q.LockEvent(ctx, db.LockEventParams{ID: id, UserID: p.UserID})
		if err != nil {
			eventError(w, err)
			return
		}
		if e.Version != *in.Version {
			writeErr(w, 409, "event changed; reload before saving")
			return
		}
		old, err := q.ListEventItems(ctx, db.ListEventItemsParams{ID: id, UserID: p.UserID})
		if err != nil {
			eventError(w, err)
			return
		}
		owned := map[uuid.UUID]bool{}
		for _, i := range old {
			owned[i.ID] = true
		}
		retained := make([]uuid.UUID, 0, len(items))
		for _, i := range items {
			if i.ID != uuid.Nil {
				if !owned[i.ID] {
					writeErr(w, 400, "invalid item id")
					return
				}
				retained = append(retained, i.ID)
			}
		}
		if err = q.DeleteMissingEventItems(ctx, db.DeleteMissingEventItemsParams{EventID: id, RetainedIds: retained}); err != nil {
			eventError(w, err)
			return
		}
		e, err = q.UpdateEvent(ctx, db.UpdateEventParams{ID: id, UserID: p.UserID, Name: p.Name, Note: p.Note, TargetDate: p.TargetDate, Status: p.Status, SuggestionsEnabled: p.SuggestionsEnabled})
	} else {
		e, err = q.CreateEvent(ctx, p)
	}
	if err != nil {
		eventError(w, err)
		return
	}
	for _, i := range items {
		i.EventID = e.ID
		if i.ID == uuid.Nil {
			i.ID = uuid.New()
		}
		if err = q.SaveEventItem(ctx, i); err != nil {
			eventError(w, err)
			return
		}
	}
	saved, err := q.ListEventItems(ctx, db.ListEventItemsParams{ID: e.ID, UserID: p.UserID})
	if err != nil {
		eventError(w, err)
		return
	}
	if err = tx.Commit(ctx); err != nil {
		eventError(w, err)
		return
	}
	code := 201
	if update {
		code = 200
	}
	writeJSON(w, code, eventDetail(e, saved))
}
func (s *Server) handleDeleteEvent(w http.ResponseWriter, r *http.Request) {
	id, ok := eventID(w, r)
	if !ok {
		return
	}
	// Require a single quoted strong entity tag, e.g. If-Match: "3".
	tag := r.Header.Get("If-Match")
	if len(tag) < 3 || tag[0] != '"' || tag[len(tag)-1] != '"' {
		writeErr(w, 400, "If-Match must contain a quoted event version")
		return
	}
	version, err := strconv.ParseInt(tag[1:len(tag)-1], 10, 64)
	if err != nil || version < 1 {
		writeErr(w, 400, "invalid If-Match version")
		return
	}
	ctx := r.Context()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		eventError(w, err)
		return
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	e, err := q.LockEvent(ctx, db.LockEventParams{ID: id, UserID: userID(r)})
	if err != nil {
		eventError(w, err)
		return
	}
	if e.Version != version {
		writeErr(w, 409, "event changed; reload before deleting")
		return
	}
	if err = q.SoftDeleteEvent(ctx, db.SoftDeleteEventParams{ID: id, UserID: userID(r)}); err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		eventError(w, err)
		return
	}
	w.WriteHeader(204)
}
func (s *Server) handleDuplicateEvent(w http.ResponseWriter, r *http.Request) {
	id, ok := eventID(w, r)
	if !ok {
		return
	}
	var in struct {
		Name       *string `json:"name"`
		TargetDate *string `json:"target_date"`
	}
	if !readEventJSON(w, r, &in) {
		return
	}
	ctx := r.Context()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		eventError(w, err)
		return
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	source, err := q.LockEvent(ctx, db.LockEventParams{ID: id, UserID: userID(r)})
	if err != nil {
		eventError(w, err)
		return
	}
	items, err := q.ListEventItems(ctx, db.ListEventItemsParams{ID: id, UserID: userID(r)})
	if err != nil {
		eventError(w, err)
		return
	}
	name := source.Name
	runes := []rune(name)
	if len(runes) > 193 {
		name = string(runes[:193])
	}
	name += " (copy)"
	if in.Name != nil {
		name = *in.Name
	}
	name, err = eventName(name)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	p := db.CreateEventParams{UserID: userID(r), Name: name, Note: source.Note, Status: "planned", SuggestionsEnabled: source.SuggestionsEnabled}
	if in.TargetDate != nil {
		p.TargetDate, err = parseDate(*in.TargetDate)
		if err != nil {
			writeErr(w, 400, "invalid target_date")
			return
		}
	}
	e, err := q.CreateEvent(ctx, p)
	if err != nil {
		eventError(w, err)
		return
	}
	for _, i := range items {
		err = q.SaveEventItem(ctx, db.SaveEventItemParams{ID: uuid.New(), EventID: e.ID, Name: i.Name, ExpectedCost: i.ExpectedCost, Position: i.Position})
		if err != nil {
			eventError(w, err)
			return
		}
	}
	saved, err := q.ListEventItems(ctx, db.ListEventItemsParams{ID: e.ID, UserID: userID(r)})
	if err != nil {
		eventError(w, err)
		return
	}
	if err = tx.Commit(ctx); err != nil {
		eventError(w, err)
		return
	}
	writeJSON(w, 201, eventDetail(e, saved))
}

type eventPage struct {
	Events  []eventDTO `json:"events"`
	Limit   int32      `json:"limit"`
	Offset  int32      `json:"offset"`
	HasMore bool       `json:"has_more"`
}

func eventRowsPage(rows []db.ListEventsRow, limit, offset int32) eventPage {
	page := eventPage{Events: []eventDTO{}, Limit: limit, Offset: offset, HasMore: len(rows) > int(limit)}
	if page.HasMore {
		rows = rows[:limit]
	}
	for _, e := range rows {
		d := eventBase(db.Event{ID: e.ID, Name: e.Name, Note: e.Note, TargetDate: e.TargetDate, Status: e.Status, SuggestionsEnabled: e.SuggestionsEnabled, Version: e.Version, CreatedAt: e.CreatedAt, UpdatedAt: e.UpdatedAt})
		d.Summary = eventSummary{ItemCount: e.ItemCount, ExpectedTotal: paiseJSON(numericPaise(e.ExpectedTotal)), ActualTotal: paiseJSON(numericPaise(e.ActualTotal)), MissingExpectedCount: e.MissingExpectedCount, MissingActualCount: e.MissingActualCount}
		d.Summary.complete()
		page.Events = append(page.Events, d)
	}
	return page
}
func (s *Server) handleListEvents(w http.ResponseWriter, r *http.Request) {
	limit, offset, err := eventPagination(r)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	if status != "" && !validEventStatus(status) {
		writeErr(w, 400, "invalid status")
		return
	}
	rows, err := s.q.ListEvents(r.Context(), db.ListEventsParams{UserID: userID(r), StatusFilter: status, PageLimit: limit + 1, PageOffset: offset})
	if err != nil {
		eventError(w, err)
		return
	}
	writeJSON(w, 200, eventRowsPage(rows, limit, offset))
}
