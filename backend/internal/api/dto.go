package api

import "github.com/ledger/backend/internal/db"

// TransactionDTO mirrors the prototype's transaction shape so the frontend port
// is a straight pass-through.
type TransactionDTO struct {
	ID       string   `json:"id"`
	Section  string   `json:"section"`
	Category string   `json:"category"`
	Amount   float64  `json:"amount"`
	Date     string   `json:"date"`
	Kind     string   `json:"kind"`
	Settles  []string `json:"settles,omitempty"` // settlement rows: linked credit ids
	Settled  bool     `json:"settled"` // credit rows: cleared by a settlement
}

func txnToDTO(t db.Transaction) TransactionDTO {
	return TransactionDTO{
		ID:       t.ID.String(),
		Section:  string(t.Section),
		Category: t.Category,
		Amount:   numToFloat(t.Amount),
		Date:     dateToString(t.TxnDate),
		Kind:     string(t.Kind),
	}
}

// BudgetsDTO is the per-section budget triple.
type BudgetsDTO struct {
	Essential float64 `json:"essential"`
	Flexible  float64 `json:"flexible"`
	Daily     float64 `json:"daily"`
}

// TemplatesDTO holds the ordered template labels per templated section.
type TemplatesDTO struct {
	Essential []string `json:"essential"`
	Flexible  []string `json:"flexible"`
}

// SettingsDTO is the full settings payload consumed by the SPA.
// Income is no longer a static setting — it is derived from income-section transactions.
type SettingsDTO struct {
	Budgets   BudgetsDTO   `json:"budgets"`
	Currency  string       `json:"currency"`
	Theme     string       `json:"theme"`
	Templates TemplatesDTO `json:"templates"`
}

func settingsToDTO(s db.UserSetting, tpl TemplatesDTO) SettingsDTO {
	return SettingsDTO{
		Budgets: BudgetsDTO{
			Essential: numToFloat(s.BudgetEssential),
			Flexible:  numToFloat(s.BudgetFlexible),
			Daily:     numToFloat(s.BudgetDaily),
		},
		Currency:  s.Currency,
		Theme:     s.Theme,
		Templates: tpl,
	}
}

// MonthStateDTO is the bookkeeping state for one month.
type MonthStateDTO struct {
	Month  string `json:"month"`
	Closed bool   `json:"closed"`
	Seeded bool   `json:"seeded"`
}

// ProfileDTO is the editable account profile.
type ProfileDTO struct {
	UserID      string `json:"user_id"`
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
}

type MonthEssentialTotalDTO struct {
	Month  string  `json:"month"`
	Amount float64 `json:"amount"`
}

type EmergencyFundTierDTO struct {
	Multiplier int     `json:"multiplier"`
	Amount     float64 `json:"amount"`
}

type EmergencyFundTiersDTO struct {
	Bare    EmergencyFundTierDTO `json:"bare"`
	Comfort EmergencyFundTierDTO `json:"comfort"`
	Luxury  EmergencyFundTierDTO `json:"luxury"`
}

type InsightsDTO struct {
	SeedAmount     float64                  `json:"seed_amount"`
	SeedMonth      string                   `json:"seed_month"`
	LookbackMonths []string                 `json:"lookback_months"`
	MonthlyTotals  []MonthEssentialTotalDTO `json:"monthly_totals"`
	EmergencyFund  EmergencyFundTiersDTO    `json:"emergency_fund"`
}
