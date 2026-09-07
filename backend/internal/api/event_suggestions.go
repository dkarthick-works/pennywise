package api

import (
	"fmt"
	"net/http"
	"time"
	_ "time/tzdata"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/ledger/backend/internal/db"
)

type eventSuggestionsResponse struct {
	eventPage
	Month        string   `json:"month"`
	CurrentMonth string   `json:"current_month"`
	Timezone     string   `json:"timezone"`
	FreeMoney    *float64 `json:"free_money"`
}

func eventCalendar(month, zone string, now time.Time) (string, string, error) {
	if _, err := monthlyBudgetDate(month); err != nil {
		return "", "", err
	}
	if zone == "" {
		zone = "UTC"
	}
	if zone == "Local" {
		return "", "", fmt.Errorf("timezone must be an IANA timezone")
	}
	location, err := time.LoadLocation(zone)
	if err != nil {
		return "", "", fmt.Errorf("timezone must be an IANA timezone")
	}
	return now.In(location).Format("2006-01"), zone, nil
}
func (s *Server) handleEventSuggestions(w http.ResponseWriter, r *http.Request) {
	month := r.URL.Query().Get("month")
	current, zone, err := eventCalendar(month, r.URL.Query().Get("timezone"), s.now())
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	limit, offset, err := eventPagination(r)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	out := eventSuggestionsResponse{eventPage: eventPage{Events: []eventDTO{}, Limit: limit, Offset: offset}, Month: month, CurrentMonth: current, Timezone: zone}
	if month != current {
		writeJSON(w, 200, out)
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
	from, to, _ := monthDateRange(month)
	dashboard, err := loadDashboardMonthly(ctx, q, userID(r), month, from, to)
	if err != nil {
		eventError(w, err)
		return
	}
	out.FreeMoney = &dashboard.FreeMoney
	if dashboard.FreeMoney > 0 {
		// Match the existing float-based metric at the currency's two-decimal boundary.
		var allowance pgtype.Numeric
		if err = allowance.Scan(fmt.Sprintf("%.2f", dashboard.FreeMoney)); err != nil {
			eventError(w, err)
			return
		}
		rows, err := q.ListEvents(ctx, db.ListEventsParams{UserID: userID(r), Suggestions: true, BeforeDate: to, Allowance: allowance, PageLimit: limit + 1, PageOffset: offset})
		if err != nil {
			eventError(w, err)
			return
		}
		out.eventPage = eventRowsPage(rows, limit, offset)
	}
	if err = tx.Commit(ctx); err != nil {
		eventError(w, err)
		return
	}
	writeJSON(w, 200, out)
}
