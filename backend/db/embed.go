// Package dbfs embeds the SQL migration files so they ship inside the binary.
package dbfs

import "embed"

//go:embed migrations/*.sql
var Migrations embed.FS
