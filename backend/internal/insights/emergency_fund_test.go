package insights

import (
	"testing"
	"time"
)

func TestCalcEmergencyFund(t *testing.T) {
	months := []string{"2026-04", "2026-05", "2026-06"}
	totals := map[string]float64{
		"2026-04": 95000,
		"2026-05": 82000,
		"2026-06": 71000,
	}

	result := CalcEmergencyFund(months, totals)
	if result.SeedAmount != 95000 {
		t.Fatalf("seed amount = %v, want 95000", result.SeedAmount)
	}
	if result.SeedMonth != "2026-04" {
		t.Fatalf("seed month = %q, want 2026-04", result.SeedMonth)
	}
	if result.EmergencyFund.Comfort.Amount != 570000 {
		t.Fatalf("comfort = %v, want 570000", result.EmergencyFund.Comfort.Amount)
	}
	if result.EmergencyFund.Bare.Amount != 285000 {
		t.Fatalf("bare = %v, want 285000", result.EmergencyFund.Bare.Amount)
	}
	if result.EmergencyFund.Luxury.Amount != 1140000 {
		t.Fatalf("luxury = %v, want 1140000", result.EmergencyFund.Luxury.Amount)
	}
}

func TestCalcEmergencyFundTiePicksMostRecent(t *testing.T) {
	months := []string{"2026-04", "2026-05", "2026-06"}
	totals := map[string]float64{
		"2026-04": 50000,
		"2026-05": 60000,
		"2026-06": 60000,
	}

	result := CalcEmergencyFund(months, totals)
	if result.SeedMonth != "2026-06" {
		t.Fatalf("seed month = %q, want 2026-06", result.SeedMonth)
	}
}

func TestLastNMonthsIncludingCurrent(t *testing.T) {
	now := time.Date(2026, 6, 12, 0, 0, 0, 0, time.UTC)
	got := LastNMonthsIncludingCurrent(3, now)
	want := []string{"2026-04", "2026-05", "2026-06"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("month[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}
