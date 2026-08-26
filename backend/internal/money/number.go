package money

import (
	"bytes"
	"errors"
)

// Number keeps the exact text of a JSON number. JSON strings are rejected so
// public money fields remain numbers on the wire.
type Number string

func (n *Number) UnmarshalJSON(data []byte) error {
	data = bytes.TrimSpace(data)
	if bytes.Equal(data, []byte("null")) {
		*n = ""
		return nil
	}
	if len(data) == 0 || data[0] == '"' || !validJSONNumber(data) {
		return errors.New("money value must be a JSON number")
	}
	*n = Number(string(data))
	return nil
}

func (n Number) MarshalJSON() ([]byte, error) {
	if n == "" {
		return []byte("null"), nil
	}
	data := []byte(n)
	if !validJSONNumber(data) {
		return nil, errors.New("invalid money number")
	}
	return data, nil
}

func (n Number) String() string { return string(n) }

func validJSONNumber(data []byte) bool {
	i := 0
	if i < len(data) && data[i] == '-' {
		i++
	}
	if i >= len(data) {
		return false
	}
	if data[i] == '0' {
		i++
	} else {
		if data[i] < '1' || data[i] > '9' {
			return false
		}
		for i < len(data) && data[i] >= '0' && data[i] <= '9' {
			i++
		}
	}
	if i < len(data) && data[i] == '.' {
		i++
		start := i
		for i < len(data) && data[i] >= '0' && data[i] <= '9' {
			i++
		}
		if i == start {
			return false
		}
	}
	if i < len(data) && (data[i] == 'e' || data[i] == 'E') {
		i++
		if i < len(data) && (data[i] == '+' || data[i] == '-') {
			i++
		}
		start := i
		for i < len(data) && data[i] >= '0' && data[i] <= '9' {
			i++
		}
		if i == start {
			return false
		}
	}
	return i == len(data)
}
