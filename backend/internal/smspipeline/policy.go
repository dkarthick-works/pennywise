package smspipeline

import (
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

var decimalRE = regexp.MustCompile(`^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$`)
var currencyRE = regexp.MustCompile(`^[A-Z]{3}$`)

func cents(raw string) (int64, bool) {
	if !decimalRE.MatchString(raw) {
		return 0, false
	}
	parts := strings.Split(raw, ".")
	whole, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, false
	}
	fraction := "00"
	if len(parts) == 2 {
		fraction = (parts[1] + "00")[:2]
	}
	f, _ := strconv.ParseInt(fraction, 10, 64)
	value := whole*100 + f
	return value, value > 0
}

// Explicit dates only. Numeric slash/dash dates use the Indian day-first
// convention. Missing years, relative dates and time-only evidence are rejected.
func explicitDate(evidence string) (string, bool) {
	for _, layout := range []string{"2006-01-02", "02/01/2006", "2/1/2006", "02-01-2006", "2-1-2006",
		"02/01/06", "2/1/06", "02-01-06", "2-1-06", "02-Jan-2006", "2-Jan-2006", "02-Jan-06", "2-Jan-06",
		"02 Jan 2006", "2 Jan 2006", "02Jan2006", "2Jan2006", "02Jan06", "2Jan06"} {
		date, err := time.Parse(layout, strings.TrimSpace(evidence))
		if err == nil && date.Year() >= 2000 {
			return date.Format("2006-01-02"), true
		}
	}
	return "", false
}

// Evidence must quote the entire numeric token, not "125" from "125.50"
// or "234" from "1,234". A trailing sentence comma/period is still allowed.
func containsAmount(body, evidence string) bool {
	if evidence == "" {
		return false
	}
	digit := func(c byte) bool { return c >= '0' && c <= '9' }
	for offset := 0; offset < len(body); {
		relative := strings.Index(body[offset:], evidence)
		if relative < 0 {
			return false
		}
		start := offset + relative
		end := start + len(evidence)
		left := start > 0 && (digit(body[start-1]) || ((body[start-1] == '.' || body[start-1] == ',') && start > 1 && digit(body[start-2])))
		right := end < len(body) && (digit(body[end]) || ((body[end] == '.' || body[end] == ',') && end+1 < len(body) && digit(body[end+1])))
		if !left && !right {
			return true
		}
		offset = start + 1
	}
	return false
}

func eventType(value string) bool {
	switch value {
	case "purchase", "income", "refund", "transfer", "settlement", "other":
		return true
	}
	return false
}
func direction(value string) bool         { return value == "debit" || value == "credit" }
func negative(reason string) Verification { return Verification{Eligible: false, Reason: reason} }

// CheckReadiness applies the same policy to every Verifier strategy. A model's
// positive flag alone is never enough to advance the pipeline.
func CheckReadiness(message Message, v Verification) Verification {
	if !v.Eligible {
		switch v.Reason {
		case "not_transaction", "missing_date", "ambiguous_date", "missing_amount", "missing_counterparty", "missing_direction", "missing_event_type", "non_completed":
			return negative(v.Reason)
		}
		return negative("not_transaction")
	}
	if v.DateEvidence == "" || !strings.Contains(message.Body, v.DateEvidence) {
		return negative("missing_date")
	}
	date, ok := explicitDate(v.DateEvidence)
	if !ok || date != v.Date {
		return negative("ambiguous_date")
	}
	parsed, _ := time.Parse("2006-01-02", date)
	if message.ReceivedAt <= 0 || parsed.After(time.UnixMilli(message.ReceivedAt).Add(48*time.Hour)) {
		return negative("ambiguous_date")
	}
	if !containsAmount(message.Body, v.AmountEvidence) {
		return negative("missing_amount")
	}
	if _, ok = cents(strings.ReplaceAll(v.AmountEvidence, ",", "")); !ok {
		return negative("missing_amount")
	}
	if strings.TrimSpace(v.CounterpartyEvidence) == "" || len([]rune(v.CounterpartyEvidence)) > 200 || !strings.Contains(message.Body, v.CounterpartyEvidence) {
		return negative("missing_counterparty")
	}
	if !direction(v.Direction) {
		return negative("missing_direction")
	}
	if !eventType(v.EventType) {
		return negative("missing_event_type")
	}
	if v.PaymentSource != "card" && v.PaymentSource != "non_card" && v.PaymentSource != "unknown" {
		v.PaymentSource = "unknown"
	}
	if v.PaymentSource == "card" && (v.PaymentEvidence == "" || !strings.Contains(message.Body, v.PaymentEvidence)) {
		v.PaymentSource = "unknown"
	}
	v.Reason = "complete"
	return v
}

// ValidateProposal owns accounting defaults, not the provider. There is no
// settlement kind and no reference-date fallback in SMS conversion.
func ValidateProposal(input ExtractionInput, p Proposal) (Draft, error) {
	v := CheckReadiness(input.Message, input.Verification)
	if !v.Eligible || p.Date != v.Date || p.Direction != v.Direction || p.EventType != v.EventType || p.PaymentSource != v.PaymentSource {
		return Draft{}, ErrInvalidResponse
	}
	actual, ok := cents(p.Amount.String())
	evidence, sourceOK := cents(strings.ReplaceAll(v.AmountEvidence, ",", ""))
	if !ok || !sourceOK || actual != evidence {
		return Draft{}, ErrInvalidResponse
	}
	category := strings.TrimSpace(p.Category)
	if category == "" || !utf8.ValidString(category) || len([]rune(category)) > 200 || strings.ContainsRune(category, 0) {
		return Draft{}, ErrInvalidResponse
	}
	// A descriptive name may add context, but must retain the evidenced counterparty.
	if !strings.Contains(strings.ToLower(category), strings.ToLower(strings.TrimSpace(v.CounterpartyEvidence))) {
		return Draft{}, ErrInvalidResponse
	}
	warnings := []string{}
	var section *string
	if p.Section != nil {
		value := *p.Section
		switch value {
		case "daily", "essential", "flexible", "income":
			section = &value
		default:
			return Draft{}, ErrInvalidResponse
		}
	}
	kind := "cash"
	if v.EventType == "settlement" {
		warnings = append(warnings, "possible_settlement_review")
	} else if v.PaymentSource == "card" {
		kind = "credit"
		warnings = append(warnings, "card_mapped_to_credit")
	} else if v.PaymentSource == "unknown" {
		warnings = append(warnings, "cash_defaulted")
	}
	if section != nil && *section == "income" && kind != "cash" {
		section = nil
	}
	if section == nil {
		warnings = append(warnings, "section_required")
	} else {
		warnings = append(warnings, "section_suggested")
	}
	if v.Direction == "credit" {
		warnings = append(warnings, "incoming_credit_review")
	}
	if v.EventType == "refund" || v.EventType == "transfer" {
		warnings = append(warnings, v.EventType+"_review")
	}
	currency := strings.ToUpper(strings.TrimSpace(input.Message.Currency))
	if !currencyRE.MatchString(currency) {
		return Draft{}, ErrInvalidResponse
	}
	if p.Currency == nil || *p.Currency == "" {
		warnings = append(warnings, "currency_defaulted")
	} else if *p.Currency != currency {
		return Draft{}, ErrInvalidResponse
	} // Never silently convert currencies.
	return Draft{Date: p.Date, Category: category, Amount: p.Amount, Section: section, Kind: kind, Currency: currency,
		Direction: v.Direction, EventType: v.EventType, Warnings: warnings}, nil
}
