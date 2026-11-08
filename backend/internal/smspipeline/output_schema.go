package smspipeline

import (
	"bytes"
	"encoding/json"

	"github.com/openai/openai-go/v3/shared"
)

// Validate primitive types/enums locally as well as in the provider schema.
// In particular, null must never silently decode to an eligible=false Go bool.
func validOutputTypes(values map[string]json.RawMessage, schema shared.FunctionParameters) bool {
	properties := schema["properties"].(map[string]any)
	for name, raw := range values {
		property, ok := properties[name].(map[string]any)
		if !ok {
			return false
		}
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.UseNumber()
		var value any
		if decoder.Decode(&value) != nil {
			return false
		}
		actual := ""
		switch value.(type) {
		case nil:
			actual = "null"
		case bool:
			actual = "boolean"
		case string:
			actual = "string"
		case json.Number:
			actual = "number"
		default:
			return false
		}
		matches := false
		switch expected := property["type"].(type) {
		case string:
			matches = expected == actual
		case []string:
			for _, t := range expected {
				matches = matches || t == actual
			}
		}
		if !matches {
			return false
		}
		if enum, exists := property["enum"]; exists {
			matches = false
			switch choices := enum.(type) {
			case []string:
				for _, choice := range choices {
					matches = matches || value == choice
				}
			case []any:
				for _, choice := range choices {
					matches = matches || value == choice
				}
			}
			if !matches {
				return false
			}
		}
	}
	return true
}
