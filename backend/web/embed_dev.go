//go:build !prod

package web

import "io/fs"

// FS is nil in non-prod builds; the Vite dev server handles static assets.
var FS fs.FS
