package smspipeline

import (
	"testing"
	"time"

	"github.com/ledger/backend/internal/money"
)

func fixture() (Message, Verification, Proposal) {
	section := "daily"
	currency := "INR"
	message := Message{Sender: "AD-BANK", Body: "INR 1,234.50 debited on 23-10-2026 at SHOP using card 1234", ReceivedAt: time.Date(2026, 10, 24, 0, 0, 0, 0, time.UTC).UnixMilli(), Currency: "INR"}
	verification := Verification{Eligible: true, Reason: "complete", Date: "2026-10-23", DateEvidence: "23-10-2026", AmountEvidence: "1,234.50", CounterpartyEvidence: "SHOP", Direction: "debit", EventType: "purchase", PaymentSource: "card", PaymentEvidence: "card"}
	proposal := Proposal{Date: verification.Date, Category: "SHOP", Amount: money.Number("1234.50"), Section: &section, Currency: &currency, Direction: "debit", EventType: "purchase", PaymentSource: "card"}
	return message, verification, proposal
}
func TestStrictReadiness(t *testing.T) {
	for _, test := range []struct {
		name, reason string
		change       func(*Message, *Verification)
	}{
		{"absent date", "missing_date", func(m *Message, v *Verification) { v.DateEvidence = "" }},
		{"invented date", "missing_date", func(m *Message, v *Verification) { v.DateEvidence = "22-10-2026" }},
		{"missing year", "ambiguous_date", func(m *Message, v *Verification) { v.DateEvidence = "23-10" }},
		{"wrong date", "ambiguous_date", func(m *Message, v *Verification) { v.Date = "2026-10-22" }},
		{"missing amount", "missing_amount", func(m *Message, v *Verification) { v.AmountEvidence = "" }},
		{"partial amount", "missing_amount", func(m *Message, v *Verification) { v.AmountEvidence = "234.50" }},
		{"invented merchant", "missing_counterparty", func(m *Message, v *Verification) { v.CounterpartyEvidence = "Another shop" }},
		{"missing direction", "missing_direction", func(m *Message, v *Verification) { v.Direction = "" }},
		{"rejected event", "non_completed", func(m *Message, v *Verification) { v.Eligible = false; v.Reason = "non_completed" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			m, v, _ := fixture()
			test.change(&m, &v)
			result := CheckReadiness(m, v)
			if result.Eligible || result.Reason != test.reason {
				t.Fatalf("result %+v", result)
			}
		})
	}
}
func TestDraftAccountingPolicy(t *testing.T) {
	for _, test := range []struct{ name, source, event, kind string }{
		{"card including debit card", "card", "purchase", "credit"},
		{"bank or UPI", "non_card", "purchase", "cash"},
		{"unknown defaults cash", "unknown", "purchase", "cash"},
		{"settlement always proposed as cash", "card", "settlement", "cash"},
	} {
		t.Run(test.name, func(t *testing.T) {
			m, v, p := fixture()
			v.PaymentSource = test.source
			p.PaymentSource = test.source
			v.EventType = test.event
			p.EventType = test.event
			draft, err := ValidateProposal(ExtractionInput{m, v}, p)
			if err != nil || draft.Kind != test.kind {
				t.Fatalf("draft %+v err %v", draft, err)
			}
		})
	}
	t.Run("unproven card defaults cash", func(t *testing.T) {
		m, v, p := fixture()
		v.PaymentEvidence = "invented card"
		v = CheckReadiness(m, v)
		p.PaymentSource = v.PaymentSource
		draft, err := ValidateProposal(ExtractionInput{m, v}, p)
		if err != nil || draft.Kind != "cash" {
			t.Fatalf("%+v %v", draft, err)
		}
	})
	t.Run("uncertain section remains optional", func(t *testing.T) {
		m, v, p := fixture()
		p.Section = nil
		draft, err := ValidateProposal(ExtractionInput{m, v}, p)
		if err != nil || draft.Section != nil {
			t.Fatalf("%+v %v", draft, err)
		}
	})
}
func TestExtractionCannotContradictSourceOrInventAmounts(t *testing.T) {
	for _, change := range []func(*Proposal){
		func(p *Proposal) { p.Amount = "999.00" }, func(p *Proposal) { p.Amount = "1e3" }, func(p *Proposal) { p.Date = "2026-10-24" },
		func(p *Proposal) { p.Category = "<script>invented</script>" }, func(p *Proposal) { p.Direction = "credit" },
		func(p *Proposal) { v := "USD"; p.Currency = &v }, func(p *Proposal) { p.Amount = "0" },
	} {
		m, v, p := fixture()
		change(&p)
		if _, err := ValidateProposal(ExtractionInput{m, v}, p); err == nil {
			t.Fatalf("accepted %+v", p)
		}
	}
}
func TestAmountEvidenceBoundaries(t *testing.T) {
	for _, example := range []struct {
		body, evidence string
		want           bool
	}{
		{"paid Rs.125.50, thanks", "125.50", true},
		{"paid 1,234.50.", "1,234.50", true},
		{"paid 125.50", "125", false},
		{"paid 125.50", "125.5", false},
		{"paid 1,234", "234", false},
	} {
		if got := containsAmount(example.body, example.evidence); got != example.want {
			t.Fatalf("%q evidence %q = %v", example.body, example.evidence, got)
		}
	}
}

func TestExplicitDates(t *testing.T) {
	for _, date := range []string{"23/10/2026", "23-10-26", "2026-10-23", "23-Oct-2026", "23 Oct 2026", "23Oct26"} {
		got, ok := explicitDate(date)
		if !ok || got != "2026-10-23" {
			t.Fatalf("%q -> %q %v", date, got, ok)
		}
	}
	for _, date := range []string{"today", "10:30", "23/10", "31/02/2026", "2026-02-30"} {
		if _, ok := explicitDate(date); ok {
			t.Fatalf("accepted %s", date)
		}
	}
}
