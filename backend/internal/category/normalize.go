package category

import (
	"regexp"
	"strings"
)

var spaceCollapse = regexp.MustCompile(`\s+`)

// NormalizeLabel applies the same rules as PostgreSQL:
// lower(regexp_replace(btrim(value), '\s+', ' ', 'g'))
func NormalizeLabel(s string) string {
	s = strings.TrimSpace(s)
	s = spaceCollapse.ReplaceAllString(s, " ")
	return strings.ToLower(s)
}
