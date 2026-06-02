// Package seed plants a user's default template rows and (optionally) the demo
// dataset ported from the prototype's data.jsx SAMPLE.
package seed

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ledger/backend/internal/db"
)

// DefaultEssentialTemplate / DefaultFlexibleTemplate match ESSENTIAL_TEMPLATE
// and FLEXIBLE_TEMPLATE in the prototype.
var (
	DefaultEssentialTemplate = []string{"Rent", "SIP / Mutual Funds", "Home Loan EMI", "Electricity", "House Help"}
	DefaultFlexibleTemplate  = []string{"ACT Fibernet", "Netflix", "Spotify", "Claude — Anthropic", "iCloud+", "Adobe Creative Cloud", "Domain Renewal"}
)

func num(f float64) pgtype.Numeric {
	var n pgtype.Numeric
	_ = n.Scan(strconv.FormatFloat(f, 'f', 2, 64))
	return n
}

func date(s string) pgtype.Date {
	t, _ := time.Parse("2006-01-02", s)
	return pgtype.Date{Time: t, Valid: true}
}

// SeedTemplates inserts the default essential + flexible template rows.
func SeedTemplates(ctx context.Context, q *db.Queries, userID uuid.UUID) error {
	for i, label := range DefaultEssentialTemplate {
		if _, err := q.InsertTemplate(ctx, db.InsertTemplateParams{
			UserID: userID, Section: db.SectionEssential, Label: label, Position: int32(i),
		}); err != nil {
			return err
		}
	}
	for i, label := range DefaultFlexibleTemplate {
		if _, err := q.InsertTemplate(ctx, db.InsertTemplateParams{
			UserID: userID, Section: db.SectionFlexible, Label: label, Position: int32(i),
		}); err != nil {
			return err
		}
	}
	return nil
}

// SeedDemoData plants the believable June/May 2026 dataset plus earlier history
// for the yearly chart, including the credit/settlement links.
func SeedDemoData(ctx context.Context, q *db.Queries, userID uuid.UUID) error {
	ins := func(section db.Section, category string, amount float64, d, kind string) (uuid.UUID, error) {
		t, err := q.InsertTransaction(ctx, db.InsertTransactionParams{
			UserID: userID, Section: section, Category: category,
			Amount: num(amount), TxnDate: date(d), Kind: db.TxnKind(kind),
		})
		if err != nil {
			return uuid.Nil, err
		}
		return t.ID, nil
	}
	settle := func(section db.Section, amount float64, d string, creditIDs []uuid.UUID, cats []string) error {
		st, err := q.InsertTransaction(ctx, db.InsertTransactionParams{
			UserID: userID, Section: section, Category: "Settles: " + strings.Join(cats, ", "),
			Amount: num(amount), TxnDate: date(d), Kind: db.TxnKindSettlement,
		})
		if err != nil {
			return err
		}
		for _, cid := range creditIDs {
			if err := q.InsertSettlementLink(ctx, db.InsertSettlementLinkParams{SettlementID: st.ID, CreditID: cid}); err != nil {
				return err
			}
		}
		return nil
	}

	// ---- May 2026 credits that later get settled (captured for linking) ----
	cEleMay, err := ins(db.SectionEssential, "Electricity", 3120, "2026-05-08", "credit")
	if err != nil {
		return err
	}
	cClaudeMay, err := ins(db.SectionFlexible, "Claude — Anthropic", 1850, "2026-05-02", "credit")
	if err != nil {
		return err
	}
	cAdobeMay, err := ins(db.SectionFlexible, "Adobe Creative Cloud", 1675, "2026-05-12", "credit")
	if err != nil {
		return err
	}
	cFlightMay, err := ins(db.SectionDaily, "Flight — IndiGo", 6400, "2026-05-18", "credit")
	if err != nil {
		return err
	}

	// ---- June 2026 — Essential ----
	cashRows := []struct {
		sec     db.Section
		cat     string
		amt     float64
		d, kind string
	}{
		{db.SectionEssential, "Rent", 38000, "2026-06-01", "cash"},
		{db.SectionEssential, "SIP / Mutual Funds", 25000, "2026-06-05", "cash"},
		{db.SectionEssential, "Home Loan EMI", 21400, "2026-06-05", "cash"},
		{db.SectionEssential, "Electricity", 2860, "2026-06-08", "credit"},
		{db.SectionEssential, "House Help", 4500, "2026-06-01", "cash"},

		// June — Subscriptions
		{db.SectionFlexible, "ACT Fibernet", 1199, "2026-06-04", "cash"},
		{db.SectionFlexible, "Netflix", 649, "2026-06-06", "cash"},
		{db.SectionFlexible, "Spotify", 119, "2026-06-09", "credit"},
		{db.SectionFlexible, "Claude — Anthropic", 1850, "2026-06-02", "credit"},
		{db.SectionFlexible, "iCloud+", 75, "2026-06-11", "cash"},
		{db.SectionFlexible, "Adobe Creative Cloud", 1675, "2026-06-12", "credit"},
		{db.SectionFlexible, "Domain Renewal", 999, "2026-06-15", "credit"},

		// June — Daily / Running
		{db.SectionDaily, "Groceries — BigBasket", 2340, "2026-06-02", "cash"},
		{db.SectionDaily, "Coffee", 380, "2026-06-02", "cash"},
		{db.SectionDaily, "Petrol", 2000, "2026-06-03", "cash"},
		{db.SectionDaily, "Dinner — Swiggy", 720, "2026-06-04", "cash"},
		{db.SectionDaily, "Uber", 240, "2026-06-05", "cash"},
		{db.SectionDaily, "Pharmacy", 560, "2026-06-06", "cash"},
		{db.SectionDaily, "Movie — PVR", 900, "2026-06-07", "credit"},
		{db.SectionDaily, "Groceries — DMart", 1880, "2026-06-09", "cash"},
		{db.SectionDaily, "Coffee", 420, "2026-06-10", "cash"},
		{db.SectionDaily, "Auto", 160, "2026-06-11", "cash"},
		{db.SectionDaily, "Books — Amazon", 1240, "2026-06-12", "credit"},
		{db.SectionDaily, "Dinner — Swiggy", 540, "2026-06-13", "cash"},

		// May 2026 — Essential
		{db.SectionEssential, "Rent", 38000, "2026-05-01", "cash"},
		{db.SectionEssential, "SIP / Mutual Funds", 25000, "2026-05-05", "cash"},
		{db.SectionEssential, "Home Loan EMI", 21400, "2026-05-05", "cash"},
		{db.SectionEssential, "House Help", 4500, "2026-05-01", "cash"},
		// May — Subscriptions
		{db.SectionFlexible, "ACT Fibernet", 1199, "2026-05-04", "cash"},
		{db.SectionFlexible, "Netflix", 649, "2026-05-06", "cash"},
		// May — Daily
		{db.SectionDaily, "Groceries — BigBasket", 2640, "2026-05-03", "cash"},
		{db.SectionDaily, "Petrol", 2000, "2026-05-14", "cash"},
		{db.SectionDaily, "Dinner — Zomato", 880, "2026-05-21", "cash"},
	}
	for _, row := range cashRows {
		if _, err := ins(row.sec, row.cat, row.amt, row.d, row.kind); err != nil {
			return err
		}
	}

	// ---- settlements (cash-out clearing earlier credits) ----
	if err := settle(db.SectionEssential, 3120, "2026-06-10", []uuid.UUID{cEleMay}, []string{"Electricity"}); err != nil {
		return err
	}
	if err := settle(db.SectionFlexible, 3525, "2026-06-03", []uuid.UUID{cClaudeMay, cAdobeMay}, []string{"Claude — Anthropic", "Adobe Creative Cloud"}); err != nil {
		return err
	}
	if err := settle(db.SectionDaily, 6400, "2026-06-04", []uuid.UUID{cFlightMay}, []string{"Flight — IndiGo"}); err != nil {
		return err
	}

	// ---- earlier months (all cash) for the yearly chart ----
	if err := seedHistory(ctx, ins); err != nil {
		return err
	}

	// mark May closed + every populated month seeded so templates aren't re-cloned
	for _, mk := range []string{"2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"} {
		if _, err := q.MarkMonthSeeded(ctx, db.MarkMonthSeededParams{UserID: userID, Month: mk}); err != nil {
			return err
		}
	}
	if _, err := q.UpsertMonthClosed(ctx, db.UpsertMonthClosedParams{UserID: userID, Month: "2026-05", Closed: true}); err != nil {
		return err
	}
	return nil
}

func seedHistory(_ context.Context, ins func(db.Section, string, float64, string, string) (uuid.UUID, error)) error {
	months := []string{"2026-01", "2026-02", "2026-03", "2026-04"}
	ess := []struct {
		cat string
		amt float64
	}{{"Rent", 38000}, {"SIP / Mutual Funds", 25000}, {"Home Loan EMI", 21400}, {"House Help", 4500}, {"Electricity", 2700}}
	flexAmts := []float64{1199, 649, 119, 1850, 75, 1675, 999}
	dailyTotals := map[string]float64{"2026-01": 21500, "2026-02": 19800, "2026-03": 26300, "2026-04": 23100}
	for _, mk := range months {
		for i, e := range ess {
			d := mk + "-0" + strconv.Itoa((i%9)+1)
			if _, err := ins(db.SectionEssential, e.cat, e.amt, d, "cash"); err != nil {
				return err
			}
		}
		for i, cat := range DefaultFlexibleTemplate {
			d := mk + "-" + pad2(i+1)
			if _, err := ins(db.SectionFlexible, cat, flexAmts[i], d, "cash"); err != nil {
				return err
			}
		}
		dt := dailyTotals[mk]
		if _, err := ins(db.SectionDaily, "Groceries", round(dt*0.45), mk+"-05", "cash"); err != nil {
			return err
		}
		if _, err := ins(db.SectionDaily, "Dining", round(dt*0.30), mk+"-15", "cash"); err != nil {
			return err
		}
		if _, err := ins(db.SectionDaily, "Transport", round(dt*0.25), mk+"-22", "cash"); err != nil {
			return err
		}
	}
	return nil
}

func pad2(n int) string {
	if n < 10 {
		return "0" + strconv.Itoa(n)
	}
	return strconv.Itoa(n)
}

func round(f float64) float64 {
	return float64(int64(f + 0.5))
}
