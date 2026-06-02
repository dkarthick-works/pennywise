//go:build prod

package web

import (
	"embed"
	"io/fs"
)

//go:embed dist
var embeddedFS embed.FS

var FS fs.FS = mustSub(embeddedFS, "dist")

func mustSub(f embed.FS, dir string) fs.FS {
	sub, err := fs.Sub(f, dir)
	if err != nil {
		panic(err)
	}
	return sub
}
