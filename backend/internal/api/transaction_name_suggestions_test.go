package api

import (
	"net/url"
	"strings"
	"testing"
)

func TestParseTransactionNameSuggestionParams(t *testing.T) {
	tests := []struct {
		name        string
		values      url.Values
		wantSection string
		wantSearch  string
		wantLimit   int32
		wantErr     string
	}{
		{
			name: "defaults",
			values: url.Values{
				"section": []string{"daily"},
			},
			wantSection: "daily",
			wantLimit:   defaultTransactionNameSuggestionLimit,
		},
		{
			name: "trimmed values",
			values: url.Values{
				"section": []string{" income "},
				"q":       []string{"  Salary  "},
				"limit":   []string{"20"},
			},
			wantSection: "income",
			wantSearch:  "Salary",
			wantLimit:   20,
		},
		{
			name:    "missing section",
			values:  url.Values{},
			wantErr: invalidTransactionNameSectionMessage,
		},
		{
			name: "invalid section",
			values: url.Values{
				"section": []string{"misc"},
			},
			wantErr: invalidTransactionNameSectionMessage,
		},
		{
			name: "query too long counts unicode code points",
			values: url.Values{
				"section": []string{"daily"},
				"q":       []string{strings.Repeat("界", 101)},
			},
			wantErr: invalidTransactionNameQueryMessage,
		},
		{
			name: "limit is not an integer",
			values: url.Values{
				"section": []string{"daily"},
				"limit":   []string{"ten"},
			},
			wantErr: invalidTransactionNameLimitMessage,
		},
		{
			name: "limit too low",
			values: url.Values{
				"section": []string{"daily"},
				"limit":   []string{"0"},
			},
			wantErr: invalidTransactionNameLimitMessage,
		},
		{
			name: "limit too high",
			values: url.Values{
				"section": []string{"daily"},
				"limit":   []string{"21"},
			},
			wantErr: invalidTransactionNameLimitMessage,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseTransactionNameSuggestionParams(tc.values)
			if tc.wantErr != "" {
				if err == nil || err.Error() != tc.wantErr {
					t.Fatalf("error = %v, want %q", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if string(got.Section) != tc.wantSection || got.Search != tc.wantSearch || got.Limit != tc.wantLimit {
				t.Fatalf("params = %#v, want section=%q search=%q limit=%d", got, tc.wantSection, tc.wantSearch, tc.wantLimit)
			}
		})
	}
}

func TestNormalizedSearchRuneCount(t *testing.T) {
	if got := normalizedSearchRuneCount("  a\t  b  "); got != 3 {
		t.Fatalf("normalizedSearchRuneCount() = %d, want 3", got)
	}
	if got := normalizedSearchRuneCount("   "); got != 0 {
		t.Fatalf("normalizedSearchRuneCount(blank) = %d, want 0", got)
	}
}
