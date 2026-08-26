package api

import (
	"math/big"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ledger/backend/internal/money"
)

const maxTransactionCategoryRunes = 200

var decimalNumberRE = regexp.MustCompile(`^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$`)

type transactionIssue struct {
	Field   string `json:"field"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

type transactionValues struct {
	Section  *string
	Category *string
	Amount   *money.Number
	Date     *string
	Kind     *string
}

func numberOrNil(number money.Number) *money.Number {
	if number == "" {
		return nil
	}
	return &number
}

func validateTransactionValues(values transactionValues, requireComplete, allowSettlement bool) []transactionIssue {
	var issues []transactionIssue

	if values.Section == nil {
		if requireComplete {
			issues = append(issues, issue("section", "missing_section", "Section is required"))
		}
	} else if !validSection(*values.Section) {
		issues = append(issues, issue("section", "invalid_section", "Section must be essential, flexible, daily, or income"))
	}

	if values.Category == nil || strings.TrimSpace(*values.Category) == "" {
		if requireComplete || values.Category != nil {
			issues = append(issues, issue("category", "missing_category", "Category is required"))
		}
	} else if len([]rune(strings.TrimSpace(*values.Category))) > maxTransactionCategoryRunes {
		issues = append(issues, issue("category", "category_too_long", "Category must be 200 characters or fewer"))
	}

	if values.Amount == nil {
		if requireComplete {
			issues = append(issues, issue("amount", "missing_amount", "Amount is required"))
		}
	} else if _, err := decimalToNumeric(*values.Amount); err != nil {
		issues = append(issues, issue("amount", "invalid_amount", err.Error()))
	}

	if values.Date == nil {
		if requireComplete {
			issues = append(issues, issue("date", "missing_date", "Date is required"))
		}
	} else if !dateRe.MatchString(*values.Date) {
		issues = append(issues, issue("date", "invalid_date", "Date must be YYYY-MM-DD"))
	} else if _, err := parseDate(*values.Date); err != nil {
		issues = append(issues, issue("date", "invalid_date", "Date must be a valid calendar date"))
	}

	if values.Kind == nil {
		if requireComplete {
			issues = append(issues, issue("kind", "missing_kind", "Kind is required"))
		}
	} else if !validKind(*values.Kind) {
		issues = append(issues, issue("kind", "invalid_kind", "Kind must be cash, credit, or settlement"))
	} else if !allowSettlement && *values.Kind == "settlement" {
		issues = append(issues, issue("kind", "unsupported_settlement", "Settlement transactions are not supported here"))
	}

	if values.Section != nil && values.Kind != nil && *values.Section == "income" && *values.Kind != "cash" {
		issues = append(issues, issue("kind", "invalid_income_kind", "Income transactions must use cash"))
	}

	return dedupeIssues(issues)
}

func issue(field, code, message string) transactionIssue {
	return transactionIssue{Field: field, Code: code, Message: message}
}

func dedupeIssues(in []transactionIssue) []transactionIssue {
	out := make([]transactionIssue, 0, len(in))
	seen := make(map[string]struct{}, len(in))
	for _, item := range in {
		key := item.Field + "\x00" + item.Code
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, item)
	}
	fieldOrder := map[string]int{"transaction": 0, "section": 1, "category": 2, "amount": 3, "date": 4, "kind": 5}
	sort.SliceStable(out, func(i, j int) bool {
		if fieldOrder[out[i].Field] != fieldOrder[out[j].Field] {
			return fieldOrder[out[i].Field] < fieldOrder[out[j].Field]
		}
		return out[i].Code < out[j].Code
	})
	return out
}

// decimalToNumeric preserves the exact JSON number, rejects values outside
// NUMERIC(14,2), and never rounds extra decimal places.
func decimalToNumeric(number money.Number) (pgtype.Numeric, error) {
	raw := string(number)
	match := decimalNumberRE.FindStringSubmatch(raw)
	if match == nil {
		return pgtype.Numeric{}, &amountError{"Amount must be a valid JSON number"}
	}

	exponent := 0
	if match[4] != "" {
		parsed, err := strconv.Atoi(match[4])
		if err != nil || parsed < -1000 || parsed > 1000 {
			return pgtype.Numeric{}, &amountError{"Amount exceeds the supported maximum"}
		}
		exponent = parsed
	}

	digits := strings.TrimLeft(match[2]+match[3], "0")
	if digits == "" {
		digits = "0"
	}
	exp := exponent - len(match[3])
	for len(digits) > 1 && strings.HasSuffix(digits, "0") {
		digits = strings.TrimSuffix(digits, "0")
		exp++
	}
	if exp < -2 {
		return pgtype.Numeric{}, &amountError{"Amount must have at most two decimal places"}
	}

	centsPower := exp + 2
	centsDigits := digits
	if centsPower > 0 {
		centsDigits += strings.Repeat("0", centsPower)
	}
	centsDigits = strings.TrimLeft(centsDigits, "0")
	if centsDigits == "" {
		centsDigits = "0"
	}
	const maxCents = "99999999999999"
	if len(centsDigits) > len(maxCents) || (len(centsDigits) == len(maxCents) && centsDigits > maxCents) {
		return pgtype.Numeric{}, &amountError{"Amount exceeds the supported maximum"}
	}
	if match[1] == "-" && digits != "0" {
		return pgtype.Numeric{}, &amountError{"Amount must be zero or greater"}
	}

	value := new(big.Int)
	if _, ok := value.SetString(digits, 10); !ok {
		return pgtype.Numeric{}, &amountError{"Amount must be a valid JSON number"}
	}
	return pgtype.Numeric{Int: value, Exp: int32(exp), Valid: true}, nil
}

func numericToJSONNumber(number pgtype.Numeric) money.Number {
	if !number.Valid || number.NaN || number.Int == nil {
		return money.Number("0")
	}
	digits := new(big.Int).Abs(number.Int).String()
	sign := ""
	if number.Int.Sign() < 0 {
		sign = "-"
	}
	exp := int(number.Exp)
	switch {
	case exp >= 0:
		return money.Number(sign + digits + strings.Repeat("0", exp))
	case len(digits)+exp > 0:
		point := len(digits) + exp
		return money.Number(sign + digits[:point] + "." + digits[point:])
	default:
		return money.Number(sign + "0." + strings.Repeat("0", -(len(digits)+exp)) + digits)
	}
}

type amountError struct {
	message string
}

func (e *amountError) Error() string { return e.message }
