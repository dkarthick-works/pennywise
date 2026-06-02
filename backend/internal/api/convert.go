package api

import (
	"math/big"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

// numToFloat converts a pgtype.Numeric to a float64 for JSON output.
func numToFloat(n pgtype.Numeric) float64 {
	if !n.Valid || n.NaN {
		return 0
	}
	f := new(big.Float).SetInt(n.Int)
	// apply base-10 exponent
	if n.Exp != 0 {
		scale := new(big.Float).SetFloat64(1)
		ten := big.NewFloat(10)
		exp := n.Exp
		neg := exp < 0
		if neg {
			exp = -exp
		}
		for i := int32(0); i < exp; i++ {
			scale.Mul(scale, ten)
		}
		if neg {
			f.Quo(f, scale)
		} else {
			f.Mul(f, scale)
		}
	}
	out, _ := f.Float64()
	return out
}

// floatToNum converts a float64 (rupees) into a pgtype.Numeric for storage,
// rounded to two decimal places (paise).
func floatToNum(f float64) pgtype.Numeric {
	var n pgtype.Numeric
	// Scan accepts the canonical decimal string and preserves NUMERIC(14,2).
	_ = n.Scan(strconv.FormatFloat(f, 'f', 2, 64))
	return n
}

func dateToString(d pgtype.Date) string {
	if !d.Valid {
		return ""
	}
	return d.Time.Format("2006-01-02")
}

// parseDate turns a "YYYY-MM-DD" string into a pgtype.Date.
func parseDate(s string) (pgtype.Date, error) {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return pgtype.Date{}, err
	}
	return pgtype.Date{Time: t, Valid: true}, nil
}
