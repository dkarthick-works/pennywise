package money

import (
	"encoding/json"
	"testing"
)

func TestNumberJSON(t *testing.T) {
	for _, raw := range []string{"0", "500.25", "-1", "5e2", "1E-2"} {
		var number Number
		if err := json.Unmarshal([]byte(raw), &number); err != nil {
			t.Fatalf("%s rejected: %v", raw, err)
		}
		if number.String() != raw {
			t.Fatalf("number = %q, want %q", number, raw)
		}
		encoded, err := json.Marshal(number)
		if err != nil {
			t.Fatal(err)
		}
		if string(encoded) != raw {
			t.Fatalf("encoded = %s, want %s", encoded, raw)
		}
	}
	for _, raw := range []string{`"500.25"`, `true`, `{}`, `01`, `1.`} {
		var number Number
		if err := json.Unmarshal([]byte(raw), &number); err == nil {
			t.Fatalf("%s should be rejected", raw)
		}
	}
}
