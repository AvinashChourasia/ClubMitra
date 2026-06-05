// Package db embeds the SQL migration files into the compiled binary and exposes
// them for the startup migrator. Embedding (go:embed) means the deployed binary
// is fully self-contained — there are no loose .sql files to ship or path to get
// wrong in production; the migrations travel inside the executable.
package db

import "embed"

// FS holds every file under migrations/. The //go:embed directive bakes them in
// at compile time.
//
//go:embed migrations/*.sql
var FS embed.FS
