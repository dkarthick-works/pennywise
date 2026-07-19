package api

import (
	"testing"
	"time"
)

func ymd(t *testing.T, s string) time.Time {
	t.Helper()
	v, err := time.Parse("2006-01-02", s)
	if err != nil {
		t.Fatalf("bad date literal %q: %v", s, err)
	}
	return time.Date(v.Year(), v.Month(), v.Day(), 0, 0, 0, 0, time.UTC)
}

func TestStatementCycleRange(t *testing.T) {
	tests := []struct {
		name          string
		month         string
		day           int
		wantFrom      string
		wantTo        string // inclusive display end
		wantQueryToEx string // exclusive SQL upper bound
	}{
		{"day 15 normal", "2026-07", 15, "2026-06-16", "2026-07-15", "2026-07-16"},
		{"day 1", "2026-07", 1, "2026-06-02", "2026-07-01", "2026-07-02"},
		{"day 28", "2026-07", 28, "2026-06-29", "2026-07-28", "2026-07-29"},
		// Selected month = Feb; day clamps to Feb length. Previous month = Jan (31).
		{"day 31 non-leap feb", "2026-02", 31, "2026-02-01", "2026-02-28", "2026-03-01"},
		{"day 31 leap feb", "2028-02", 31, "2028-02-01", "2028-02-29", "2028-03-01"},
		// Previous month (Jan, 31 days) clamps independently, so the cycle start
		// is the day after Jan's clamped close, not Feb 1.
		{"day 30 feb non-leap", "2026-02", 30, "2026-01-31", "2026-02-28", "2026-03-01"},
		{"day 29 feb non-leap", "2026-02", 29, "2026-01-30", "2026-02-28", "2026-03-01"},
		// Selected month = March; previous month Feb clamps to 28/29.
		{"day 31 march after non-leap feb", "2026-03", 31, "2026-03-01", "2026-03-31", "2026-04-01"},
		{"day 30 march prev feb", "2026-03", 30, "2026-03-01", "2026-03-30", "2026-03-31"},
		// December -> January rollover on the from side.
		{"day 5 january rollover", "2026-01", 5, "2025-12-06", "2026-01-05", "2026-01-06"},
		{"day 31 january prev dec", "2026-01", 31, "2026-01-01", "2026-01-31", "2026-02-01"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := statementCycleRange(tc.month, tc.day)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !got.displayFrom.Equal(ymd(t, tc.wantFrom)) {
				t.Errorf("displayFrom = %s, want %s", got.displayFrom.Format("2006-01-02"), tc.wantFrom)
			}
			if !got.displayTo.Equal(ymd(t, tc.wantTo)) {
				t.Errorf("displayTo = %s, want %s", got.displayTo.Format("2006-01-02"), tc.wantTo)
			}
			if !got.queryFrom.Time.Equal(ymd(t, tc.wantFrom)) {
				t.Errorf("queryFrom = %s, want %s", got.queryFrom.Time.Format("2006-01-02"), tc.wantFrom)
			}
			if !got.queryTo.Time.Equal(ymd(t, tc.wantQueryToEx)) {
				t.Errorf("queryTo(exclusive) = %s, want %s", got.queryTo.Time.Format("2006-01-02"), tc.wantQueryToEx)
			}
		})
	}
}

func TestStatementCycleRangeInvalid(t *testing.T) {
	for _, tc := range []struct {
		name  string
		month string
		day   int
	}{
		{"day zero", "2026-07", 0},
		{"day too large", "2026-07", 32},
		{"bad month", "2026-13", 15},
		{"garbage month", "nope", 15},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := statementCycleRange(tc.month, tc.day); err == nil {
				t.Fatalf("expected error for month=%q day=%d", tc.month, tc.day)
			}
		})
	}
}

func TestCalendarMonthRange(t *testing.T) {
	tests := []struct {
		month         string
		wantFrom      string
		wantTo        string
		wantQueryToEx string
	}{
		{"2026-07", "2026-07-01", "2026-07-31", "2026-08-01"},
		{"2026-02", "2026-02-01", "2026-02-28", "2026-03-01"},
		{"2028-02", "2028-02-01", "2028-02-29", "2028-03-01"},
		{"2026-12", "2026-12-01", "2026-12-31", "2027-01-01"},
	}
	for _, tc := range tests {
		t.Run(tc.month, func(t *testing.T) {
			got, err := calendarMonthRange(tc.month)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !got.displayFrom.Equal(ymd(t, tc.wantFrom)) {
				t.Errorf("displayFrom = %s, want %s", got.displayFrom.Format("2006-01-02"), tc.wantFrom)
			}
			if !got.displayTo.Equal(ymd(t, tc.wantTo)) {
				t.Errorf("displayTo = %s, want %s", got.displayTo.Format("2006-01-02"), tc.wantTo)
			}
			if !got.queryTo.Time.Equal(ymd(t, tc.wantQueryToEx)) {
				t.Errorf("queryTo(exclusive) = %s, want %s", got.queryTo.Time.Format("2006-01-02"), tc.wantQueryToEx)
			}
		})
	}
}
