package api

import (
	"net/http"
	"time"

	"github.com/ledger/backend/internal/db"
	"github.com/ledger/backend/internal/insights"
)

func (s *Server) handleGetInsights(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	ctx := r.Context()

	lookback := insights.LastNMonthsIncludingCurrent(insights.LookbackMonths(), time.Now())

	rows, err := s.q.SumEssentialSpendByMonths(ctx, db.SumEssentialSpendByMonthsParams{
		UserID:  uid,
		Column2: lookback,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not load insights")
		return
	}

	totals := make(map[string]float64, len(rows))
	for _, row := range rows {
		totals[row.Month] = numToFloat(row.Total)
	}

	result := insights.CalcEmergencyFund(lookback, totals)
	writeJSON(w, http.StatusOK, insightsToDTO(result))
}

func insightsToDTO(r insights.EmergencyFundResult) InsightsDTO {
	monthly := make([]MonthEssentialTotalDTO, len(r.MonthlyTotals))
	for i, m := range r.MonthlyTotals {
		monthly[i] = MonthEssentialTotalDTO{Month: m.Month, Amount: m.Amount}
	}
	return InsightsDTO{
		SeedAmount:     r.SeedAmount,
		SeedMonth:      r.SeedMonth,
		LookbackMonths: r.LookbackMonths,
		MonthlyTotals:  monthly,
		EmergencyFund: EmergencyFundTiersDTO{
			Bare:    tierToDTO(r.EmergencyFund.Bare),
			Comfort: tierToDTO(r.EmergencyFund.Comfort),
			Luxury:  tierToDTO(r.EmergencyFund.Luxury),
		},
	}
}

func tierToDTO(t insights.FundTier) EmergencyFundTierDTO {
	return EmergencyFundTierDTO{Multiplier: t.Multiplier, Amount: t.Amount}
}
