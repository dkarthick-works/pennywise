package insights

import "time"

const lookbackMonths = 3

type MonthTotal struct {
	Month  string
	Amount float64
}

type FundTier struct {
	Multiplier int
	Amount     float64
}

type EmergencyFundTiers struct {
	Bare    FundTier
	Comfort FundTier
	Luxury  FundTier
}

type EmergencyFundResult struct {
	SeedAmount     float64
	SeedMonth      string
	LookbackMonths []string
	MonthlyTotals  []MonthTotal
	EmergencyFund  EmergencyFundTiers
}

// LastNMonthsIncludingCurrent returns the last n calendar months ending at now's month.
func LastNMonthsIncludingCurrent(n int, now time.Time) []string {
	out := make([]string, n)
	y, m := now.Year(), int(now.Month())
	for i := n - 1; i >= 0; i-- {
		out[i] = formatMonth(y, m)
		m--
		if m < 1 {
			m = 12
			y--
		}
	}
	return out
}

func formatMonth(year, month int) string {
	return time.Date(year, time.Month(month), 1, 0, 0, 0, 0, time.UTC).Format("2006-01")
}

// CalcEmergencyFund derives seed and tier targets from per-month essential spend totals.
// Missing months in totals are treated as zero. Ties for seed pick the most recent month.
func CalcEmergencyFund(months []string, totals map[string]float64) EmergencyFundResult {
	monthly := make([]MonthTotal, len(months))
	var seedAmount float64
	var seedMonth string

	for i, month := range months {
		amt := totals[month]
		monthly[i] = MonthTotal{Month: month, Amount: amt}
		if amt > seedAmount || (amt == seedAmount && amt > 0 && month > seedMonth) {
			seedAmount = amt
			seedMonth = month
		}
	}

	return EmergencyFundResult{
		SeedAmount:     seedAmount,
		SeedMonth:      seedMonth,
		LookbackMonths: append([]string(nil), months...),
		MonthlyTotals:  monthly,
		EmergencyFund: EmergencyFundTiers{
			Bare:    FundTier{Multiplier: 3, Amount: seedAmount * 3},
			Comfort: FundTier{Multiplier: 6, Amount: seedAmount * 6},
			Luxury:  FundTier{Multiplier: 12, Amount: seedAmount * 12},
		},
	}
}

// LookbackMonths is the number of months used for the emergency fund seed.
func LookbackMonths() int { return lookbackMonths }
