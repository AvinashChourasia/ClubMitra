package users

import (
	"errors"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

// mapUniqueViolation turns a Postgres unique-constraint error (SQLSTATE 23505)
// into a domain error the auth layer can report as a clean 409. We match on the
// constraint/index name so a duplicate email and a duplicate phone produce
// distinct, accurate messages. Anything else passes through unchanged.
func mapUniqueViolation(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		return err
	}
	switch {
	case strings.Contains(pgErr.ConstraintName, "email"):
		return ErrEmailTaken
	case strings.Contains(pgErr.ConstraintName, "phone"):
		return ErrPhoneTaken
	default:
		return err
	}
}
