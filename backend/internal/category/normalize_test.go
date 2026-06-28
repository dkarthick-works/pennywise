package category

import "testing"

func TestNormalizeLabel(t *testing.T) {
	tests := []struct {
		in, want string
	}{
		{"Swiggy Lunch", "swiggy lunch"},
		{"  Swiggy  Lunch  ", "swiggy lunch"},
		{"FOOD", "food"},
		{"", ""},
	}
	for _, tc := range tests {
		if got := NormalizeLabel(tc.in); got != tc.want {
			t.Errorf("NormalizeLabel(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
