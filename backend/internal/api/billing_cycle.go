package api

import (
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

// dateRange bundles the inclusive display dates shown to the user with the
// half-open [queryFrom, queryTo) bounds handed to SQL. Keeping both together
// prevents the two representations from drifting apart.
type dateRange struct {
	displayFrom time.Time
	displayTo   time.Time // inclusive
	queryFrom   pgtype.Date
	queryTo     pgtype.Date // exclusive (displayTo + 1 day)
}

// daysInMonth returns the number of days in the given month, honouring leap
// years for February. month is 1-based.
func daysInMonth(year int, month time.Month) int {
	// Day 0 of the next month is the last day of this month.
	return time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

// clampDay caps a requested day-of-month to the last valid day in a month so a
// statement day of 31 resolves to Feb 28/29, Apr 30, and so on.
func clampDay(day, monthLen int) int {
	if day > monthLen {
		return monthLen
	}
	return day
}

// parseMonthUTC parses a strict "YYYY-MM" string into the first day of that
// month in UTC. It mirrors monthDateRange's parsing so both endpoints agree.
func parseMonthUTC(month string) (time.Time, error) {
	t, err := time.Parse("2006-01", month)
	if err != nil {
		return time.Time{}, err
	}
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC), nil
}

// toRange builds a dateRange from inclusive display endpoints.
func toRange(displayFrom, displayTo time.Time) dateRange {
	return dateRange{
		displayFrom: displayFrom,
		displayTo:   displayTo,
		queryFrom:   pgtype.Date{Time: displayFrom, Valid: true},
		queryTo:     pgtype.Date{Time: displayTo.AddDate(0, 0, 1), Valid: true},
	}
}

// calendarMonthRange returns the first-through-last-day window for month.
func calendarMonthRange(month string) (dateRange, error) {
	start, err := parseMonthUTC(month)
	if err != nil {
		return dateRange{}, errors.New("month must be YYYY-MM")
	}
	end := start.AddDate(0, 1, 0).AddDate(0, 0, -1) // last day of the month
	return toRange(start, end), nil
}

// statementCycleRange derives the statement-cycle window for the selected
// month, where statementDay is the inclusive closing day.
//
// The cycle ends on the (clamped) closing day within the selected month and
// begins the day after the previous month's (clamped) closing day. Example:
// statementDay 15 for 2026-07 yields 2026-06-16 .. 2026-07-15.
//
// statementDay must be 1..31; days beyond a month's length are clamped to that
// month's final day independently for the selected and previous months.
func statementCycleRange(month string, statementDay int) (dateRange, error) {
	if statementDay < 1 || statementDay > 31 {
		return dateRange{}, errors.New("statement day must be between 1 and 31")
	}
	start, err := parseMonthUTC(month)
	if err != nil {
		return dateRange{}, errors.New("month must be YYYY-MM")
	}

	closeThisDay := clampDay(statementDay, daysInMonth(start.Year(), start.Month()))
	closeThis := time.Date(start.Year(), start.Month(), closeThisDay, 0, 0, 0, 0, time.UTC)

	prev := start.AddDate(0, -1, 0)
	closePrevDay := clampDay(statementDay, daysInMonth(prev.Year(), prev.Month()))
	closePrev := time.Date(prev.Year(), prev.Month(), closePrevDay, 0, 0, 0, 0, time.UTC)

	from := closePrev.AddDate(0, 0, 1) // day after the previous close
	return toRange(from, closeThis), nil
}
